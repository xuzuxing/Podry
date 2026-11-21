package application

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/chart"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/idempotency"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/release"
)

type DeploymentPreviewInput struct {
	BindingID             string `json:"bindingId"`
	ArtifactID            string `json:"artifactId"`
	ExpectedConfigVersion int32  `json:"expectedConfigVersion"`
}
type Diff struct {
	Before string `json:"before"`
	After  string `json:"after"`
}
type DeploymentPreview struct {
	PreviewID      string         `json:"previewId"`
	ExpiresAt      time.Time      `json:"expiresAt"`
	ImageRef       string         `json:"imageRef"`
	Target         Target         `json:"target"`
	ValuesRedacted map[string]any `json:"valuesRedacted"`
	Diff           Diff           `json:"diff"`
	Warnings       []string       `json:"warnings"`
}
type PreviewConfirm struct {
	PreviewID string `json:"previewId"`
}
type ReleaseRequest struct {
	RequestID    string    `json:"requestId"`
	Status       string    `json:"status"`
	Kind         string    `json:"kind"`
	BindingID    string    `json:"bindingId"`
	SnapshotID   string    `json:"snapshotId"`
	DeploymentID *string   `json:"deploymentId"`
	CreatedAt    time.Time `json:"createdAt"`
}
type Deployment struct {
	ID                 string     `json:"id"`
	RequestID          string     `json:"requestId"`
	AppID              string     `json:"appId"`
	BindingID          string     `json:"bindingId"`
	ArtifactID         string     `json:"artifactId"`
	ImageRef           string     `json:"imageRef"`
	ConfigVersion      int32      `json:"configVersion"`
	Status             string     `json:"status"`
	Revision           int64      `json:"revision"`
	Kind               string     `json:"kind"`
	SourceDeploymentID *string    `json:"sourceDeploymentId"`
	HelmRevision       *int32     `json:"helmRevision"`
	CreatedAt          time.Time  `json:"createdAt"`
	StartedAt          *time.Time `json:"startedAt"`
	FinishedAt         *time.Time `json:"finishedAt"`
	ErrorCode          *string    `json:"errorCode"`
}

// ReleaseQueue is supplied by the release executor when it can drain durable
// requests. Ready checks local configuration only and must not perform I/O.
// A disabled executor rejects confirmation without consuming the preview.
type ReleaseQueue interface{ Ready(Target) error }

func (s *Service) UseReleases(queue ReleaseQueue) *Service { s.releases = queue; return s }

type frozenCredential = release.CredentialRef
type releasePlan = release.Plan

// Values are captured with the locked binding and are not part of the canonical
// Plan until Chart rendering freezes them. Preserve historical snapshot hashes.
type previewPlan struct {
	releasePlan
	values map[string]any
}

func decodeReleasePlan(raw []byte, hash string) (releasePlan, error) {
	p, err := release.Decode(raw, hash)
	if err != nil {
		return p, httpx.Fail(503, "release_snapshot_invalid", "发布快照完整性校验失败")
	}
	return p, nil
}

func releasePermission(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, c Config, t Target) error {
	if err := targetPermission(ctx, q, a, app, c, t); err != nil {
		return err
	}
	// Helm's storage requirement belongs to release admission; saving a workflow
	// remains independent of whether the operator can access Helm revision Secrets.
	return platform.RequireTarget(ctx, q, a, app.ProjectID, t.ClusterID, t.Namespace, "core/secrets", "resource.write")
}
func deployAccess(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, id string) (sqlcdb.Application, error) {
	app, e := q.GetApplication(ctx, id)
	if e != nil {
		return app, e
	}
	if e = auth.LockActor(ctx, q, a); e != nil {
		return app, e
	}
	if _, e = lockProject(ctx, q, a, app.ProjectID, "deploy"); e != nil {
		return app, e
	}
	return q.LockApplication(ctx, id)
}
func enabledCD(ctx context.Context, q *sqlcdb.Queries, id, binding string) (sqlcdb.Pipeline, CD, error) {
	rows, e := q.ListPipelines(ctx, id)
	if e != nil {
		return sqlcdb.Pipeline{}, CD{}, e
	}
	var ciID *string
	for _, p := range rows {
		if p.Kind == "ci" {
			id := p.ID
			ciID = &id
		}
	}
	for _, p := range rows {
		if p.Kind == "cd" && p.Enabled && p.BindingID != nil && *p.BindingID == binding {
			var cd CD
			if e = json.Unmarshal(p.Definition, &cd); e != nil {
				return p, cd, e
			}
			return p, cd, validateCD(cd, ciID)
		}
	}
	return sqlcdb.Pipeline{}, CD{}, httpx.Fail(422, "prerequisite_missing", "请先保存并启用目标环境的 CD 流水线")
}
func (s *Service) releaseSecrets(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, refs []SecretRef) error {
	p, e := q.GetProject(ctx, app.ProjectID)
	if e != nil {
		return e
	}
	for _, ref := range refs {
		cr, e := q.GetCredential(ctx, ref.CredentialID)
		if e != nil {
			return e
		}
		if cr.Kind != "secret" {
			return httpx.Invalid("发布 Secret 引用的类型无效")
		}
		if e = platform.CredentialAccess(ctx, q, a, cr, &p.TeamID, false); e != nil {
			return e
		}
		v, e := q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: ref.CredentialID, Version: ref.Version})
		if e != nil {
			return e
		}
		data, e := s.vault.Open(ref.CredentialID, ref.Version, v.KeyID, v.EncryptedPayload)
		if e != nil {
			return e
		}
		values, ok := data["data"].(map[string]any)
		if !ok {
			return httpx.Invalid("Secret 凭据 data 无效")
		}
		// targetKey names both the source data key and the container environment key.
		if _, ok = values[ref.TargetKey].(string); !ok {
			return httpx.Invalid("Secret 版本缺少 targetKey 对应的数据键")
		}
	}
	return nil
}
func (s *Service) releaseCluster(ctx context.Context, q *sqlcdb.Queries, id string) (frozenCredential, error) {
	cluster, e := q.GetCluster(ctx, id)
	if e != nil {
		return frozenCredential{}, e
	}
	cr, e := q.GetCredential(ctx, cluster.CredentialID)
	if e != nil {
		return frozenCredential{}, e
	}
	v, e := q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: cr.ID, Version: cr.Version})
	if e != nil {
		return frozenCredential{}, e
	}
	if _, e = s.vault.Open(cr.ID, cr.Version, v.KeyID, v.EncryptedPayload); e != nil {
		return frozenCredential{}, e
	}
	return frozenCredential{ID: cr.ID, Version: cr.Version}, nil
}
func (s *Service) CreateDeploymentPreview(ctx context.Context, a auth.Actor, id string, in DeploymentPreviewInput, req string) (DeploymentPreview, error) {
	if e := httpx.UUID(in.BindingID); e != nil {
		return DeploymentPreview{}, e
	}
	if e := httpx.UUID(in.ArtifactID); e != nil {
		return DeploymentPreview{}, e
	}
	if in.ExpectedConfigVersion < 1 {
		return DeploymentPreview{}, httpx.Invalid("expectedConfigVersion 必须为正数")
	}
	// Rendering uses a read snapshot obtained under a short transaction. No network
	// I/O or template rendering runs while the application/target locks are held.
	planned, e := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (previewPlan, error) { return s.planRelease(ctx, q, a, id, in) })
	if e != nil {
		return DeploymentPreview{}, e
	}
	// Config versions are immutable; render exactly the selected version.
	plan := planned.releasePlan
	keys := make([]string, 0, len(plan.SecretRefs))
	for _, ref := range plan.SecretRefs {
		keys = append(keys, ref.TargetKey)
	}
	plan.Chart, e = chart.Render(chart.Input{AppID: id, BindingID: plan.BindingID, DeploymentID: plan.DeploymentID, Namespace: plan.Target.Namespace, ReleaseName: plan.Target.ReleaseName, WorkloadKind: plan.WorkloadKind, ImageRef: plan.ImageRef, Values: planned.values, SecretKeys: keys})
	if e != nil {
		return DeploymentPreview{}, httpx.Fail(422, "chart_render_failed", "内置 Chart 无法渲染，请检查基础配置")
	}
	raw, e := json.Marshal(plan)
	if e != nil {
		return DeploymentPreview{}, e
	}
	hash := chart.Hash(raw)
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (DeploymentPreview, error) {
		app, e := s.revalidateRelease(ctx, q, a, id, plan)
		if e != nil {
			return DeploymentPreview{}, e
		}
		before := ""
		binding, e := q.GetReleaseBinding(ctx, sqlcdb.GetReleaseBindingParams{ID: in.BindingID, AppID: id})
		if e != nil {
			return DeploymentPreview{}, e
		}
		if binding.CurrentDeploymentID != nil {
			d, e := q.GetDeployment(ctx, *binding.CurrentDeploymentID)
			if e != nil {
				return DeploymentPreview{}, e
			}
			previous, e := q.GetReleaseSnapshot(ctx, d.SnapshotID)
			if e != nil {
				return DeploymentPreview{}, e
			}
			p, e := decodeReleasePlan(previous.Snapshot, previous.SnapshotSha256)
			if e != nil {
				return DeploymentPreview{}, e
			}
			before = p.Chart.Manifest
		}
		expires := time.Now().UTC().Add(10 * time.Minute)
		preview, e := q.CreateDeploymentPreview(ctx, sqlcdb.CreateDeploymentPreviewParams{ID: uuid.NewString(), AppID: id, BindingID: in.BindingID, ArtifactID: in.ArtifactID, ConfigVersion: plan.ConfigVersion, BindingVersion: plan.BindingVersion, Snapshot: raw, SnapshotSha256: hash, CreatedBy: a.ID, ExpiresAt: expires})
		if e != nil {
			return DeploymentPreview{}, e
		}
		if e = record(ctx, q, a, app, "deployment.preview.create", req, map[string]any{"appId": id, "previewId": preview.ID, "bindingId": in.BindingID, "artifactId": in.ArtifactID}); e != nil {
			return DeploymentPreview{}, e
		}
		return DeploymentPreview{PreviewID: preview.ID, ExpiresAt: preview.ExpiresAt, ImageRef: plan.ImageRef, Target: plan.Target, ValuesRedacted: plan.Chart.Values, Diff: Diff{Before: before, After: plan.Chart.Manifest}, Warnings: []string{"差异基于平台上次成功发布的快照，未查询集群实时资源。", "预览不执行构建或发布；确认发布受执行器开关控制。"}}, nil
	})
}
func (s *Service) planRelease(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, id string, in DeploymentPreviewInput) (previewPlan, error) {
	var out previewPlan
	app, e := deployAccess(ctx, q, a, id)
	if e != nil {
		return out, e
	}
	if e = mutable(app); e != nil {
		return out, e
	}
	c, e := readConfig(ctx, q, id, 0)
	if e != nil {
		return out, e
	}
	if c.Version != in.ExpectedConfigVersion {
		return out, httpx.Fail(409, "revision_conflict", "应用配置版本已变化")
	}
	b, e := q.GetReleaseBinding(ctx, sqlcdb.GetReleaseBindingParams{ID: in.BindingID, AppID: id})
	if e != nil {
		return out, e
	}
	c, e = bindingConfig(c, b.OverrideValues)
	if e != nil {
		return out, e
	}
	target := Target{ClusterID: b.ClusterID, Namespace: b.Namespace, ReleaseName: b.ReleaseName}
	if e = lockTargets(ctx, q, []Target{target}); e != nil {
		return out, e
	}
	if e = releasePermission(ctx, q, a, app, c, target); e != nil {
		return out, e
	}
	pipeline, cd, e := enabledCD(ctx, q, id, b.ID)
	if e != nil {
		return out, e
	}
	artifact, e := usableArtifact(ctx, q, a, app, in.ArtifactID)
	if e != nil {
		return out, e
	}
	if e = s.releaseSecrets(ctx, q, a, app, c.SecretRefs); e != nil {
		return out, e
	}
	cr, e := s.releaseCluster(ctx, q, b.ClusterID)
	if e != nil {
		return out, e
	}
	return previewPlan{releasePlan: releasePlan{SchemaVersion: 1, DeploymentID: uuid.NewString(), RequestID: uuid.NewString(), AppID: id, BindingID: b.ID, BindingVersion: b.Version, TargetID: b.TargetID, Target: target, ArtifactID: artifact.ID, ImageRef: artifact.ImageRepository + "@" + artifact.Digest, ConfigVersion: c.Version, WorkflowVersion: app.WorkflowVersion, PipelineID: pipeline.ID, PipelineVersion: pipeline.Version, TimeoutSeconds: cd.DeployTimeoutSeconds, ClusterCredential: cr, WorkloadKind: c.ChartConfig.WorkloadKind, SecretRefs: c.SecretRefs}, values: c.DeployValues}, nil
}
func (s *Service) revalidateRelease(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, id string, p releasePlan) (sqlcdb.Application, error) {
	app, e := deployAccess(ctx, q, a, id)
	if e != nil {
		return app, e
	}
	if e = mutable(app); e != nil {
		return app, e
	}
	b, e := q.GetReleaseBinding(ctx, sqlcdb.GetReleaseBindingParams{ID: p.BindingID, AppID: id})
	if e != nil {
		return app, e
	}
	if e = lockTargets(ctx, q, []Target{p.Target}); e != nil {
		return app, e
	}
	c, e := readConfig(ctx, q, id, 0)
	if e != nil {
		return app, e
	}
	c, e = bindingConfig(c, b.OverrideValues)
	if e != nil {
		return app, e
	}
	if e = releasePermission(ctx, q, a, app, c, p.Target); e != nil {
		return app, e
	}
	if c.Version != p.ConfigVersion || app.WorkflowVersion != p.WorkflowVersion || b.Version != p.BindingVersion || b.TargetID != p.TargetID || (Target{ClusterID: b.ClusterID, Namespace: b.Namespace, ReleaseName: b.ReleaseName}) != p.Target {
		return app, httpx.Fail(409, "revision_conflict", "配置、绑定或 CD 已变化，请重新预览")
	}
	pipeline, _, e := enabledCD(ctx, q, id, p.BindingID)
	if e != nil {
		return app, e
	}
	cr, e := s.releaseCluster(ctx, q, p.Target.ClusterID)
	if e != nil {
		return app, e
	}
	if c.Version != p.ConfigVersion || app.WorkflowVersion != p.WorkflowVersion || b.Version != p.BindingVersion || b.TargetID != p.TargetID || (Target{ClusterID: b.ClusterID, Namespace: b.Namespace, ReleaseName: b.ReleaseName}) != p.Target || pipeline.ID != p.PipelineID || pipeline.Version != p.PipelineVersion || cr != p.ClusterCredential {
		return app, httpx.Fail(409, "revision_conflict", "配置、绑定、CD 或集群凭据已变化，请重新预览")
	}
	artifact, e := usableArtifact(ctx, q, a, app, p.ArtifactID)
	if e != nil {
		return app, e
	}
	if artifact.ImageRepository+"@"+artifact.Digest != p.ImageRef {
		return app, httpx.Fail(409, "artifact_unavailable", "产物与快照不一致")
	}
	return app, s.releaseSecrets(ctx, q, a, app, p.SecretRefs)
}
func (s *Service) ConfirmRelease(ctx context.Context, a auth.Actor, id string, in PreviewConfirm, key, req string) (idempotency.Result, error) {
	if e := httpx.UUID(in.PreviewID); e != nil {
		return idempotency.Result{}, e
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
		app, e := deployAccess(ctx, q, a, id)
		if e != nil {
			return idempotency.Result{}, e
		}
		preview, e := q.LockDeploymentPreview(ctx, sqlcdb.LockDeploymentPreviewParams{ID: in.PreviewID, AppID: id})
		if e != nil {
			return idempotency.Result{}, e
		}
		if preview.CreatedBy != a.ID {
			return idempotency.Result{}, httpx.Forbidden()
		}
		plan, e := decodeReleasePlan(preview.Snapshot, preview.SnapshotSha256)
		if e != nil {
			return idempotency.Result{}, e
		}
		if e = lockTargets(ctx, q, []Target{plan.Target}); e != nil {
			return idempotency.Result{}, e
		}
		// Replays still require current application and target permissions, but can
		// return the stored result after expiry, configuration changes or shutdown.
		c, e := readConfig(ctx, q, id, plan.ConfigVersion)
		if e != nil {
			return idempotency.Result{}, e
		}
		// Replay permissions cover the exact frozen resources, including resources
		// enabled only by an environment override.
		c.DeployValues = plan.Chart.Values
		if e = releasePermission(ctx, q, a, app, c, plan.Target); e != nil {
			return idempotency.Result{}, e
		}
		if _, e = usableArtifact(ctx, q, a, app, plan.ArtifactID); e != nil {
			return idempotency.Result{}, e
		}
		return idempotency.Execute(ctx, q, a.ID, "createReleaseRequest", key, "POST", "/api/apps/"+id+"/deployments", in, func() (idempotency.Result, error) {
			if preview.ConsumedAt != nil {
				return idempotency.Result{}, httpx.Fail(409, "preview_consumed", "预览已被消费")
			}
			if !time.Now().UTC().Before(preview.ExpiresAt) {
				return idempotency.Result{}, httpx.Fail(410, "preview_expired", "预览已过期，请重新生成")
			}
			app, e = s.revalidateRelease(ctx, q, a, id, plan)
			if e != nil {
				return idempotency.Result{}, e
			}
			if s.releases == nil {
				return idempotency.Result{}, httpx.Fail(503, "deployment_execution_unavailable", "发布执行器尚未接入；预览已保留，未创建发布任务")
			}
			if e = s.releases.Ready(plan.Target); e != nil {
				return idempotency.Result{}, e
			}
			n, e := q.ConsumeDeploymentPreview(ctx, preview.ID)
			if e != nil {
				return idempotency.Result{}, e
			}
			if n != 1 {
				return idempotency.Result{}, httpx.Fail(410, "preview_expired", "预览已过期，请重新生成")
			}
			snapshot, e := q.CreateReleaseSnapshot(ctx, sqlcdb.CreateReleaseSnapshotParams{ID: uuid.NewString(), PreviewID: preview.ID, AppID: id, BindingID: plan.BindingID, ArtifactID: plan.ArtifactID, ConfigVersion: plan.ConfigVersion, BindingVersion: plan.BindingVersion, Snapshot: preview.Snapshot, SnapshotSha256: preview.SnapshotSha256})
			if e != nil {
				return idempotency.Result{}, e
			}
			r, e := q.CreateReleaseRequest(ctx, sqlcdb.CreateReleaseRequestParams{ID: plan.RequestID, SnapshotID: snapshot.ID, RequestedBy: a.ID})
			if e != nil {
				return idempotency.Result{}, e
			}
			d, e := q.CreateDeployment(ctx, sqlcdb.CreateDeploymentParams{ID: plan.DeploymentID, RequestID: r.ID, TargetID: plan.TargetID})
			if e != nil {
				return idempotency.Result{}, e
			}
			if e = record(ctx, q, a, app, "deployment.request.create", req, map[string]any{"appId": id, "requestId": r.ID, "deploymentId": d.ID, "snapshotId": snapshot.ID}); e != nil {
				return idempotency.Result{}, e
			}
			body, e := json.Marshal(ReleaseRequest{RequestID: r.ID, Status: r.Status, Kind: r.Kind, BindingID: plan.BindingID, SnapshotID: r.SnapshotID, DeploymentID: &d.ID, CreatedAt: r.CreatedAt})
			return idempotency.Result{Status: 202, Body: body}, e
		})
	})
}
func (s *Service) GetReleaseRequest(ctx context.Context, a auth.Actor, id string) (ReleaseRequest, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (ReleaseRequest, error) {
		r, e := q.GetReleaseRequest(ctx, id)
		if e != nil {
			return ReleaseRequest{}, e
		}
		if _, e = view(ctx, q, a, r.AppID); e != nil {
			return ReleaseRequest{}, e
		}
		return ReleaseRequest{RequestID: r.ID, Status: r.Status, Kind: r.Kind, BindingID: r.BindingID, SnapshotID: r.SnapshotID, DeploymentID: &r.DeploymentID, CreatedAt: r.CreatedAt}, nil
	})
}
func deploymentDTO(id, request, app, binding, artifact string, version int32, status, kind string, helm *int32, created time.Time, raw []byte) (Deployment, error) {
	var p releasePlan
	if e := json.Unmarshal(raw, &p); e != nil {
		return Deployment{}, e
	}
	return Deployment{ID: id, RequestID: request, AppID: app, BindingID: binding, ArtifactID: artifact, ImageRef: p.ImageRef, ConfigVersion: version, Status: status, Kind: kind, HelmRevision: helm, CreatedAt: created}, nil
}
func (s *Service) GetDeployment(ctx context.Context, a auth.Actor, id string) (Deployment, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Deployment, error) {
		r, e := q.GetDeployment(ctx, id)
		if e != nil {
			return Deployment{}, e
		}
		if _, e = view(ctx, q, a, r.AppID); e != nil {
			return Deployment{}, e
		}
		d, e := deploymentDTO(r.ID, r.RequestID, r.AppID, r.BindingID, r.ArtifactID, r.ConfigVersion, r.Status, r.Kind, r.HelmRevision, r.CreatedAt, r.Snapshot)
		d.StartedAt, d.FinishedAt, d.ErrorCode, d.SourceDeploymentID = r.StartedAt, r.FinishedAt, r.ErrorCode, r.SourceDeploymentID
		d.Revision = r.Revision
		return d, e
	})
}
func (s *Service) ListDeployments(ctx context.Context, a auth.Actor, id string, binding *string, page httpx.Pagination) (httpx.PageResult[Deployment], error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (httpx.PageResult[Deployment], error) {
		out := httpx.PageResult[Deployment]{Items: []Deployment{}, Page: page.Page, PageSize: page.PageSize}
		if _, e := view(ctx, q, a, id); e != nil {
			return out, e
		}
		var e error
		if binding != nil {
			if _, e = q.GetReleaseBinding(ctx, sqlcdb.GetReleaseBindingParams{ID: *binding, AppID: id}); e != nil {
				return out, e
			}
		}
		out.Total, e = q.CountDeployments(ctx, sqlcdb.CountDeploymentsParams{AppID: id, BindingID: binding})
		if e != nil {
			return out, e
		}
		rows, e := q.ListDeployments(ctx, sqlcdb.ListDeploymentsParams{AppID: id, BindingID: binding, PageLimit: int32(page.PageSize), PageOffset: page.Offset()})
		if e != nil {
			return out, e
		}
		for _, r := range rows {
			d, e := deploymentDTO(r.ID, r.RequestID, r.AppID, r.BindingID, r.ArtifactID, r.ConfigVersion, r.Status, r.Kind, r.HelmRevision, r.CreatedAt, r.Snapshot)
			if e != nil {
				return out, e
			}
			d.StartedAt, d.FinishedAt, d.ErrorCode, d.SourceDeploymentID = r.StartedAt, r.FinishedAt, r.ErrorCode, r.SourceDeploymentID
			d.Revision = r.Revision
			out.Items = append(out.Items, d)
		}
		return out, nil
	})
}
