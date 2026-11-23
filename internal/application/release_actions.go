package application

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/chart"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/idempotency"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/release"
)

type PromoteInput struct {
	BindingID             string `json:"bindingId"`
	ExpectedConfigVersion int32  `json:"expectedConfigVersion"`
}
type RollbackInput struct {
	Reason string `json:"reason"`
}

// Admission uses today's binding revision, independently of a rollback's frozen
// historical business revision. Neither admission data nor lineage changes Plan v1.
type actionPlan struct {
	previewPlan
	admissionBindingVersion int32
}

func (s *Service) PromoteDeployment(ctx context.Context, a auth.Actor, id string, in PromoteInput, key, req string) (idempotency.Result, error) {
	if err := httpx.UUID(in.BindingID); err != nil {
		return idempotency.Result{}, err
	}
	if in.ExpectedConfigVersion < 1 {
		return idempotency.Result{}, httpx.Invalid("expectedConfigVersion 必须为正数")
	}
	return s.releaseAction(ctx, a, id, "promote", in, in, "", key, req)
}

func (s *Service) RollbackDeployment(ctx context.Context, a auth.Actor, id string, in RollbackInput, key, req string) (idempotency.Result, error) {
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Reason)); n < 1 || n > 1000 {
		return idempotency.Result{}, httpx.Invalid("reason 必须包含 1–1000 个字符")
	}
	return s.releaseAction(ctx, a, id, "rollback", in, PromoteInput{}, strings.TrimSpace(in.Reason), key, req)
}

func frozenConfig(p releasePlan) Config {
	return Config{ChartConfig: &ChartConfig{WorkloadKind: p.WorkloadKind, ChartVersion: p.Chart.Version}, DeployValues: p.Chart.Values, SecretRefs: p.SecretRefs}
}

// A replay authorizes the stored target and resources, without depending on the
// latest config, execution switch or availability of old decryption keys.
func authorizeActionReplay(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, result idempotency.Result) error {
	var response ReleaseRequest
	if err := json.Unmarshal(result.Body, &response); err != nil {
		return err
	}
	r, err := q.GetReleaseRequest(ctx, response.RequestID)
	if err != nil {
		return err
	}
	snapshot, err := q.GetReleaseSnapshot(ctx, r.SnapshotID)
	if err != nil {
		return err
	}
	p, err := decodeReleasePlan(snapshot.Snapshot, snapshot.SnapshotSha256)
	if err != nil {
		return err
	}
	if p.AppID != app.ID || p.RequestID != r.ID || p.DeploymentID != r.DeploymentID || r.RequestedBy != a.ID {
		return httpx.Fail(503, "release_snapshot_invalid", "发布快照身份校验失败")
	}
	if err = lockTargets(ctx, q, []Target{p.Target}); err != nil {
		return err
	}
	if err = releasePermission(ctx, q, a, app, frozenConfig(p), p.Target); err != nil {
		return err
	}
	if _, err = usableArtifact(ctx, q, a, app, p.ArtifactID); err != nil {
		return err
	}
	if err = authorizePullScope(ctx, q, a, app, p.PullCredential); err != nil {
		return err
	}
	project, err := q.GetProject(ctx, app.ProjectID)
	if err != nil {
		return err
	}
	for _, ref := range p.SecretRefs {
		credential, err := q.GetCredential(ctx, ref.CredentialID)
		if err != nil {
			return err
		}
		if err = platform.CredentialAccess(ctx, q, a, credential, &project.TeamID, false); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) planReleaseAction(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, sourceID, kind string, in PromoteInput) (actionPlan, error) {
	var out actionPlan
	source, err := q.GetDeployment(ctx, sourceID)
	if err != nil {
		return out, err
	}
	app, err := deployAccess(ctx, q, a, source.AppID)
	if err != nil {
		return out, err
	}
	if err = mutable(app); err != nil {
		return out, err
	}
	if source.Status != "succeeded" {
		return out, httpx.Fail(409, "source_deployment_unavailable", "只能复用成功的发布记录")
	}
	snapshot, err := q.GetReleaseSnapshot(ctx, source.SnapshotID)
	if err != nil {
		return out, err
	}
	p, err := decodeReleasePlan(snapshot.Snapshot, snapshot.SnapshotSha256)
	if err != nil {
		return out, err
	}
	if p.AppID != app.ID || p.DeploymentID != source.ID || p.RequestID != source.RequestID || p.BindingID != source.BindingID || p.ArtifactID != source.ArtifactID || p.TargetID != source.TargetID || p.ConfigVersion != snapshot.ConfigVersion || p.BindingVersion != snapshot.BindingVersion {
		return out, httpx.Fail(503, "release_snapshot_invalid", "来源发布快照身份校验失败")
	}
	if p.Removal != nil {
		return out, httpx.Fail(409, "source_deployment_unavailable", "下线记录不能作为晋级或回滚来源")
	}
	if kind == "promote" {
		if in.BindingID == p.BindingID {
			return out, httpx.Invalid("晋级必须选择同一应用的其他环境绑定")
		}
		out.previewPlan, err = s.planRelease(ctx, q, a, app.ID, DeploymentPreviewInput{BindingID: in.BindingID, ArtifactID: p.ArtifactID, ExpectedConfigVersion: in.ExpectedConfigVersion})
		if err != nil {
			return out, err
		}
		// The exact proven digest is reused; a mutable tag is never resolved here.
		if out.ImageRef != p.ImageRef {
			return out, httpx.Fail(409, "artifact_unavailable", "来源产物与发布快照不一致")
		}
		out.admissionBindingVersion = out.BindingVersion
	} else {
		b, err := q.GetReleaseBinding(ctx, sqlcdb.GetReleaseBindingParams{ID: p.BindingID, AppID: app.ID})
		if err != nil {
			return out, err
		}
		if b.TargetID != p.TargetID || (Target{ClusterID: b.ClusterID, Namespace: b.Namespace, ReleaseName: b.ReleaseName}) != p.Target {
			return out, httpx.Fail(409, "revision_conflict", "历史发布的环境目标已变化")
		}
		if err = lockTargets(ctx, q, []Target{p.Target}); err != nil {
			return out, err
		}
		if err = releasePermission(ctx, q, a, app, frozenConfig(p), p.Target); err != nil {
			return out, err
		}
		pipeline, _, err := enabledCD(ctx, q, app.ID, b.ID)
		if err != nil {
			return out, err
		}
		artifact, err := usableArtifact(ctx, q, a, app, p.ArtifactID)
		if err != nil {
			return out, err
		}
		if artifact.ImageRepository+"@"+artifact.Digest != p.ImageRef {
			return out, httpx.Fail(409, "artifact_unavailable", "历史产物已不可用")
		}
		if err = s.authorizePull(ctx, q, a, app, p.PullCredential); err != nil {
			return out, err
		}
		if err = s.releaseSecrets(ctx, q, a, app, p.SecretRefs); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				err = httpx.Fail(409, "secret_version_unavailable", "历史 Secret 版本已不可用")
			}
			return out, err
		}
		p.ClusterCredential, err = s.releaseCluster(ctx, q, p.Target.ClusterID)
		if err != nil {
			return out, err
		}
		p.RequestID, p.DeploymentID = uuid.NewString(), uuid.NewString()
		p.WorkflowVersion, p.PipelineID, p.PipelineVersion = app.WorkflowVersion, pipeline.ID, pipeline.Version
		out = actionPlan{previewPlan: previewPlan{releasePlan: p, values: mergeValues(p.Chart.Values, nil)}, admissionBindingVersion: b.Version}
		delete(out.values, "podry")
	}
	busy, err := q.BindingTargetBusy(ctx, out.TargetID)
	if err != nil {
		return out, err
	}
	if busy {
		return out, httpx.Fail(409, "target_busy", "目标存在排队、执行中或结果未知的发布")
	}
	return out, nil
}

// Rendering is outside both transactions. Replanning verifies all locked inputs
// before any durable task is written; IDs and Chart output are not input revisions.
func sameActionInputs(a, b actionPlan) bool {
	a.RequestID, a.DeploymentID, b.RequestID, b.DeploymentID = "", "", "", ""
	a.Chart, b.Chart = chart.Result{}, chart.Result{}
	return reflect.DeepEqual(a, b)
}

func (s *Service) releaseAction(ctx context.Context, a auth.Actor, id, kind string, input any, promotion PromoteInput, reason, key, req string) (idempotency.Result, error) {
	if err := httpx.UUID(id); err != nil {
		return idempotency.Result{}, err
	}
	operation := "promoteDeployment"
	if kind == "rollback" {
		operation = "rollbackDeployment"
	}
	path := "/api/deployments/" + id + "/" + kind
	var candidate actionPlan
	// Shared by both phases so a concurrent winner is replayed before validating
	// today's revisions or target occupancy introduced by that same request.
	lookup := func(q *sqlcdb.Queries) (idempotency.Result, bool, error) {
		source, err := q.GetDeployment(ctx, id)
		if err != nil {
			return idempotency.Result{}, false, err
		}
		app, err := deployAccess(ctx, q, a, source.AppID)
		if err != nil {
			return idempotency.Result{}, false, err
		}
		result, found, err := idempotency.Lookup(ctx, q, a.ID, operation, key, "POST", path, input)
		if err == nil && found {
			err = authorizeActionReplay(ctx, q, a, app, result)
		}
		return result, found, err
	}
	var found bool
	result, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
		result, hit, err := lookup(q)
		found = hit
		if err != nil || hit {
			return result, err
		}
		candidate, err = s.planReleaseAction(ctx, q, a, id, kind, promotion)
		return result, err
	})
	if err != nil || found {
		return result, err
	}
	keys := make([]string, 0, len(candidate.SecretRefs))
	for _, ref := range candidate.SecretRefs {
		keys = append(keys, ref.TargetKey)
	}
	renderInput := chart.Input{Version: candidate.chartVersion, AppID: candidate.AppID, BindingID: candidate.BindingID, DeploymentID: candidate.DeploymentID, Namespace: candidate.Target.Namespace, ReleaseName: candidate.Target.ReleaseName, WorkloadKind: candidate.WorkloadKind, ImageRef: candidate.ImageRef, Values: candidate.values, SecretKeys: keys, PullRegistry: pullRegistry(candidate.PullCredential)}
	var rendered chart.Result
	if kind == "rollback" {
		rendered, err = chart.RenderArchived(renderInput, candidate.Chart)
	} else {
		rendered, err = chart.Render(renderInput)
	}
	if err != nil {
		return idempotency.Result{}, httpx.Fail(409, "chart_unavailable", "发布 Chart 无法渲染或历史版本不可用")
	}
	candidate.Chart = rendered
	if _, err = release.Objects(candidate.releasePlan); err != nil {
		return idempotency.Result{}, httpx.Fail(503, "release_snapshot_invalid", "发布资源身份校验失败")
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
		result, hit, err := lookup(q)
		if err != nil || hit {
			return result, err
		}
		current, err := s.planReleaseAction(ctx, q, a, id, kind, promotion)
		if err != nil {
			return idempotency.Result{}, err
		}
		if !sameActionInputs(candidate, current) {
			return idempotency.Result{}, httpx.Fail(409, "revision_conflict", "发布输入已变化，请重新发起")
		}
		return idempotency.Execute(ctx, q, a.ID, operation, key, "POST", path, input, func() (idempotency.Result, error) {
			if s.releases == nil {
				return idempotency.Result{}, httpx.Fail(503, "deployment_execution_unavailable", "发布执行器尚未接入，未创建发布任务")
			}
			if err := s.releases.Ready(candidate.Target); err != nil {
				return idempotency.Result{}, err
			}
			return s.persistReleaseAction(ctx, q, a, id, kind, reason, req, candidate.releasePlan)
		})
	})
}

func (s *Service) persistReleaseAction(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, sourceID, kind, reason, req string, p releasePlan) (idempotency.Result, error) {
	raw, err := json.Marshal(p)
	if err != nil {
		return idempotency.Result{}, err
	}
	hash := chart.Hash(raw)
	// The existing snapshot schema requires a consumed preview. Derived actions
	// create this internal provenance row atomically; no separate confirmation.
	preview, err := q.CreateDeploymentPreview(ctx, sqlcdb.CreateDeploymentPreviewParams{ID: uuid.NewString(), AppID: p.AppID, BindingID: p.BindingID, ArtifactID: p.ArtifactID, ConfigVersion: p.ConfigVersion, BindingVersion: p.BindingVersion, Snapshot: raw, SnapshotSha256: hash, CreatedBy: a.ID, ExpiresAt: time.Now().UTC().Add(10 * time.Minute)})
	if err != nil {
		return idempotency.Result{}, err
	}
	if n, err := q.ConsumeDeploymentPreview(ctx, preview.ID); err != nil || n != 1 {
		if err == nil {
			err = httpx.Fail(409, "preview_expired", "内部发布快照已过期")
		}
		return idempotency.Result{}, err
	}
	snapshot, err := q.CreateReleaseSnapshot(ctx, sqlcdb.CreateReleaseSnapshotParams{ID: uuid.NewString(), PreviewID: preview.ID, AppID: p.AppID, BindingID: p.BindingID, ArtifactID: p.ArtifactID, ConfigVersion: p.ConfigVersion, BindingVersion: p.BindingVersion, Snapshot: raw, SnapshotSha256: hash})
	if err != nil {
		return idempotency.Result{}, err
	}
	r, err := q.CreateDerivedReleaseRequest(ctx, sqlcdb.CreateDerivedReleaseRequestParams{ID: p.RequestID, SnapshotID: snapshot.ID, RequestedBy: a.ID, Kind: kind, SourceDeploymentID: &sourceID, Reason: reason})
	if err != nil {
		return idempotency.Result{}, err
	}
	d, err := q.CreateDeployment(ctx, sqlcdb.CreateDeploymentParams{ID: p.DeploymentID, RequestID: r.ID, TargetID: p.TargetID})
	if err != nil {
		return idempotency.Result{}, err
	}
	app, err := q.GetApplication(ctx, p.AppID)
	if err != nil {
		return idempotency.Result{}, err
	}
	if err = record(ctx, q, a, app, "deployment."+kind+".create", req, map[string]any{"appId": p.AppID, "requestId": r.ID, "deploymentId": d.ID, "snapshotId": snapshot.ID, "sourceDeploymentId": sourceID}); err != nil {
		return idempotency.Result{}, err
	}
	body, err := json.Marshal(ReleaseRequest{RequestID: r.ID, Status: r.Status, Kind: r.Kind, BindingID: p.BindingID, SnapshotID: snapshot.ID, DeploymentID: &d.ID, CreatedAt: r.CreatedAt})
	return idempotency.Result{Status: 202, Body: body}, err
}
