package application

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/chart"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
)

func validateAutoEnvironment(ctx context.Context, q *sqlcdb.Queries, id string, enabled bool) error {
	e, err := q.GetEnvironment(ctx, id)
	if err != nil {
		return err
	}
	if enabled && (e.Production || !e.AutoDeployAllowed) {
		return httpx.Invalid("自动部署仅允许显式开启策略的非生产环境")
	}
	return nil
}

// Delegation is explicit and independent from browser sessions. A CI requester
// never implicitly gains the deploy permissions of a workflow editor.
func saveDeployAuthorization(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, c Config, p sqlcdb.Pipeline, cd CD) error {
	if cd.TriggerMode != "on_ci_success" {
		return q.DeleteDeployAuthorization(ctx, p.ID)
	}
	if _, err := lockProject(ctx, q, a, app.ProjectID, "deploy"); err != nil {
		return err
	}
	b, err := q.GetReleaseBinding(ctx, sqlcdb.GetReleaseBindingParams{ID: *p.BindingID, AppID: app.ID})
	if err != nil {
		return err
	}
	if !b.AutoDeploy {
		return httpx.Invalid("自动 CD 需要环境绑定 autoDeploy=true")
	}
	if err = validateAutoEnvironment(ctx, q, b.EnvironmentID, true); err != nil {
		return err
	}
	if !p.Enabled {
		return q.DeleteDeployAuthorization(ctx, p.ID)
	}
	c, err = bindingConfig(c, b.OverrideValues)
	if err != nil {
		return err
	}
	if err = releasePermission(ctx, q, a, app, c, Target{ClusterID: b.ClusterID, Namespace: b.Namespace, ReleaseName: b.ReleaseName}); err != nil {
		return err
	}
	return q.SaveDeployAuthorization(ctx, sqlcdb.SaveDeployAuthorizationParams{PipelineID: p.ID, AuthorizedBy: a.ID, PipelineVersion: p.Version})
}

func autoActor(ctx context.Context, q *sqlcdb.Queries, id string) (auth.Actor, error) {
	u, err := q.LockUser(ctx, id)
	if err != nil {
		return auth.Actor{}, err
	}
	if u.DisabledAt != nil {
		return auth.Actor{}, httpx.Forbidden()
	}
	return auth.Actor{User: auth.Public(u), TokenVersion: u.TokenVersion}, nil
}

func validateAutoIntent(ctx context.Context, q *sqlcdb.Queries, i sqlcdb.AutoDeployIntent, app sqlcdb.Application) error {
	stale := func() error {
		return httpx.Fail(409, "auto_deploy_stale", "自动部署授权或冻结版本已变化")
	}
	b, err := q.GetBuild(ctx, i.BuildID)
	if err != nil {
		return err
	}
	ci, err := q.GetPipeline(ctx, b.PipelineID)
	if errors.Is(err, pgx.ErrNoRows) {
		return stale()
	}
	if err != nil {
		return err
	}
	p, err := q.GetPipeline(ctx, i.PipelineID)
	if errors.Is(err, pgx.ErrNoRows) {
		return stale()
	}
	if err != nil {
		return err
	}
	d, err := q.GetDeployAuthorization(ctx, i.PipelineID)
	if errors.Is(err, pgx.ErrNoRows) {
		return stale()
	}
	if err != nil {
		return err
	}
	binding, err := q.GetReleaseBinding(ctx, sqlcdb.GetReleaseBindingParams{ID: i.BindingID, AppID: app.ID})
	if err != nil {
		return err
	}
	var cd CD
	if json.Unmarshal(p.Definition, &cd) != nil {
		return stale()
	}
	c, err := readConfig(ctx, q, app.ID, 0)
	if err != nil {
		return err
	}
	if !ci.Enabled || ci.Version != i.CiVersion || !p.Enabled || p.Version != i.PipelineVersion ||
		d.PipelineVersion != i.PipelineVersion || d.AuthorizedBy != i.AuthorizedBy ||
		binding.Version != i.BindingVersion || !binding.AutoDeploy ||
		app.WorkflowVersion != i.WorkflowVersion || c.Version != i.ConfigVersion ||
		cd.TriggerMode != "on_ci_success" || cd.UpstreamPipelineID == nil || *cd.UpstreamPipelineID != ci.ID {
		return stale()
	}
	return validateAutoEnvironment(ctx, q, binding.EnvironmentID, true)
}

// No external effects occur before the final transaction. Concurrent workers
// may render the same candidate; only one can commit its preview/request/intent.
// A crash before commit simply leaves the original durable intent claimable.
func (s *Service) ProcessAutoDeployOne(ctx context.Context) (bool, error) {
	i, err := s.q.NextAutoDeployIntent(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var a auth.Actor
	planned, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (previewPlan, error) {
		var e error
		a, e = autoActor(ctx, q, i.AuthorizedBy)
		if e != nil {
			return previewPlan{}, e
		}
		b, e := q.GetBuild(ctx, i.BuildID)
		if e != nil {
			return previewPlan{}, e
		}
		app, e := deployAccess(ctx, q, a, b.AppID)
		if e != nil {
			return previewPlan{}, e
		}
		if e = validateAutoIntent(ctx, q, i, app); e != nil {
			return previewPlan{}, e
		}
		return s.planRelease(ctx, q, a, app.ID, DeploymentPreviewInput{BindingID: i.BindingID, ArtifactID: *b.ArtifactID, ExpectedConfigVersion: i.ConfigVersion})
	})
	if err != nil {
		return true, s.autoDeployFailure(ctx, i, err)
	}
	p := planned.releasePlan
	keys := []string{}
	for _, r := range p.SecretRefs {
		keys = append(keys, r.TargetKey)
	}
	p.Chart, err = chart.Render(chart.Input{Version: planned.chartVersion, AppID: p.AppID, BindingID: p.BindingID, DeploymentID: p.DeploymentID, Namespace: p.Target.Namespace, ReleaseName: p.Target.ReleaseName, WorkloadKind: p.WorkloadKind, ImageRef: p.ImageRef, Values: planned.values, SecretKeys: keys})
	if err != nil {
		return true, s.autoDeployFailure(ctx, i, httpx.Fail(422, "chart_render_failed", "自动发布渲染失败"))
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return true, err
	}
	_, err = database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		var e error
		a, e = autoActor(ctx, q, i.AuthorizedBy)
		if e != nil {
			return false, e
		}
		app, e := deployAccess(ctx, q, a, p.AppID)
		if e != nil {
			return false, e
		}
		current, e := q.LockAutoDeployIntent(ctx, i.ID)
		if e != nil {
			return false, e
		}
		if current.Status == "dispatched" || current.Status == "skipped" {
			return false, nil
		}
		if e = validateAutoIntent(ctx, q, current, app); e != nil {
			return false, e
		}
		app, e = s.revalidateRelease(ctx, q, a, p.AppID, p)
		if e != nil {
			return false, e
		}
		busy, e := q.BindingTargetBusy(ctx, p.TargetID)
		if e != nil {
			return false, e
		}
		if busy {
			return false, httpx.Fail(409, "target_busy", "目标被排队、执行中或未知发布占用")
		}
		if s.releases == nil {
			return false, httpx.Fail(503, "deployment_execution_unavailable", "发布执行器尚未启用")
		}
		if e = s.releases.Ready(p.Target); e != nil {
			return false, e
		}
		hash := chart.Hash(raw)
		preview, e := q.CreateDeploymentPreview(ctx, sqlcdb.CreateDeploymentPreviewParams{ID: uuid.NewString(), AppID: p.AppID, BindingID: p.BindingID, ArtifactID: p.ArtifactID, ConfigVersion: p.ConfigVersion, BindingVersion: p.BindingVersion, Snapshot: raw, SnapshotSha256: hash, CreatedBy: a.ID, ExpiresAt: time.Now().UTC().Add(10 * time.Minute)})
		if e != nil {
			return false, e
		}
		n, e := q.ConsumeDeploymentPreview(ctx, preview.ID)
		if e != nil {
			return false, e
		}
		if n != 1 {
			return false, httpx.Fail(409, "preview_consumed", "自动预览已失效")
		}
		snap, e := q.CreateReleaseSnapshot(ctx, sqlcdb.CreateReleaseSnapshotParams{ID: uuid.NewString(), PreviewID: preview.ID, AppID: p.AppID, BindingID: p.BindingID, ArtifactID: p.ArtifactID, ConfigVersion: p.ConfigVersion, BindingVersion: p.BindingVersion, Snapshot: raw, SnapshotSha256: hash})
		if e != nil {
			return false, e
		}
		r, e := q.CreateReleaseRequest(ctx, sqlcdb.CreateReleaseRequestParams{ID: p.RequestID, SnapshotID: snap.ID, RequestedBy: a.ID})
		if e != nil {
			return false, e
		}
		if _, e = q.CreateDeployment(ctx, sqlcdb.CreateDeploymentParams{ID: p.DeploymentID, RequestID: r.ID, TargetID: p.TargetID}); e != nil {
			return false, e
		}
		if _, e = q.FinishAutoDeployIntent(ctx, sqlcdb.FinishAutoDeployIntentParams{ID: i.ID, Status: "dispatched", RequestID: &r.ID}); e != nil {
			return false, e
		}
		return true, record(ctx, q, a, app, "deployment.auto.dispatched", "auto-deploy", map[string]any{"intentId": i.ID, "buildId": i.BuildID, "requestId": r.ID, "deploymentId": p.DeploymentID})
	})
	if err != nil {
		return true, s.autoDeployFailure(ctx, i, err)
	}
	return true, nil
}

func (s *Service) autoDeployFailure(ctx context.Context, i sqlcdb.AutoDeployIntent, cause error) error {
	status, code := "blocked", "auto_deploy_unavailable"
	var api *httpx.Error
	if errors.As(cause, &api) {
		code = api.Code
		if api.Status < 500 && code != "target_busy" && code != "resource_action_busy" {
			status = "skipped"
		}
	} else if errors.Is(cause, pgx.ErrNoRows) {
		status, code = "skipped", "auto_deploy_stale"
	}
	// Canceled work and DB failures remain retryable, without storing raw errors.
	if ctx.Err() != nil {
		return ctx.Err()
	}
	_, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		current, e := q.LockAutoDeployIntent(ctx, i.ID)
		if e != nil {
			return false, e
		}
		if current.Status == "dispatched" || current.Status == "skipped" {
			return false, nil
		}
		if _, e = q.FinishAutoDeployIntent(ctx, sqlcdb.FinishAutoDeployIntentParams{ID: i.ID, Status: status, ErrorCode: &code}); e != nil {
			return false, e
		}
		if current.Status == status && current.ErrorCode != nil && *current.ErrorCode == code {
			return true, nil
		}
		b, e := q.GetBuild(ctx, i.BuildID)
		if e != nil {
			return false, e
		}
		app, e := q.GetApplication(ctx, b.AppID)
		if e != nil {
			return false, e
		}
		return true, record(ctx, q, auth.Actor{User: auth.User{ID: i.AuthorizedBy}}, app, "deployment.auto."+status, "auto-deploy", map[string]any{"intentId": i.ID, "buildId": i.BuildID, "errorCode": code})
	})
	return err
}

func (s *Service) RunAutoDeployDraining(drain, work context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		if drain.Err() != nil {
			return
		}
		step, cancel := context.WithTimeout(work, 15*time.Second)
		_, err := s.ProcessAutoDeployOne(step)
		cancel()
		if err != nil && work.Err() == nil {
			slog.Error("automatic deployment admission persistence failed")
		}
		select {
		case <-drain.Done():
			return
		case <-ticker.C:
		}
	}
}
