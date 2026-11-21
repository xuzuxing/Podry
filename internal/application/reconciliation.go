package application

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/idempotency"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/release"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type ReconcileDeploymentInput struct {
	ExpectedRevision int64  `json:"expectedRevision"`
	Reason           string `json:"reason"`
}

type DeploymentReconciliation struct {
	DeploymentID   string    `json:"deploymentId"`
	Revision       int64     `json:"revision"`
	Status         string    `json:"status"`
	HelmRevision   *int32    `json:"helmRevision"`
	ErrorCode      *string   `json:"errorCode"`
	CheckedAt      time.Time `json:"checkedAt"`
	TargetReleased bool      `json:"targetReleased"`
}

type releaseObserver interface {
	ObserveRelease(context.Context, release.Input) (release.Observation, error)
}

type reconciliationRead struct {
	app        sqlcdb.Application
	meta       sqlcdb.GetDeploymentRow
	plan       release.Plan
	hash       string
	deployment sqlcdb.LockReleaseReconciliationRow
	binding    sqlcdb.GetReleaseBindingRow
	credential release.CredentialRef
	known      []release.Resource
}

// Replays authorize the frozen target without checking current execution state,
// input revisions, key availability or executor readiness. No runtime Secret
// payload is needed to observe an already submitted release.
func reconciliationAccess(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, id string) (reconciliationRead, error) {
	var out reconciliationRead
	var err error
	out.meta, err = q.GetDeployment(ctx, id)
	if err != nil {
		return out, err
	}
	out.app, err = deployAccess(ctx, q, a, out.meta.AppID)
	if err != nil {
		return out, err
	}
	snap, err := q.GetReleaseSnapshot(ctx, out.meta.SnapshotID)
	if err != nil {
		return out, err
	}
	out.plan, err = decodeReleasePlan(snap.Snapshot, snap.SnapshotSha256)
	if err != nil {
		return out, err
	}
	p, d := out.plan, out.meta
	if p.DeploymentID != d.ID || p.RequestID != d.RequestID || p.AppID != d.AppID || p.BindingID != d.BindingID || p.TargetID != d.TargetID || p.ArtifactID != d.ArtifactID || p.ConfigVersion != snap.ConfigVersion || p.BindingVersion != snap.BindingVersion {
		return out, httpx.Fail(503, "release_snapshot_invalid", "发布快照身份校验失败")
	}
	out.hash = snap.SnapshotSha256
	if _, err = q.LockCluster(ctx, p.Target.ClusterID); err != nil {
		return out, err
	}
	if err = releasePermission(ctx, q, a, out.app, frozenConfig(p), p.Target); err != nil {
		return out, err
	}
	resources := append(targetResources(frozenConfig(p)), "core/secrets")
	if p.WorkloadKind == "Job" {
		resources = append(resources, "core/pods")
	}
	for _, name := range resources {
		if err = platform.RequireTarget(ctx, q, a, out.app.ProjectID, p.Target.ClusterID, p.Target.Namespace, name, "resource.view"); err != nil {
			return out, err
		}
	}
	return out, nil
}

func reconciliationConflict() error {
	return httpx.Fail(409, "revision_conflict", "发布、绑定、凭据或资源身份已变化，请重新查询")
}

func reconciliationGuard(ctx context.Context, q *sqlcdb.Queries, in reconciliationRead, expected int64) (reconciliationRead, error) {
	d, err := q.LockReleaseReconciliation(ctx, in.meta.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return in, httpx.Fail(409, "deployment_reconciliation_busy", "发布正被其他执行器核对，请稍后重试")
	}
	if err != nil {
		return in, err
	}
	if d.Revision != expected {
		return in, reconciliationConflict()
	}
	if d.Status != "submitting" && d.Status != "observing" && d.Status != "unknown" {
		return in, httpx.Fail(409, "deployment_not_reconcilable", "只能核对已提交且未确定结果的发布")
	}
	if d.WorkerActive {
		return in, httpx.Fail(409, "deployment_reconciliation_busy", "发布存在有效执行租约，请稍后重试")
	}
	in.deployment = d
	// Take the deployment lock before binding/target locks. A worker holding the
	// deployment is skipped above, so its short claim cannot deadlock this read.
	in.binding, err = q.GetReleaseBinding(ctx, sqlcdb.GetReleaseBindingParams{ID: in.plan.BindingID, AppID: in.app.ID})
	if err != nil {
		return in, err
	}
	b, p := in.binding, in.plan
	if b.TargetID != d.TargetID || (Target{ClusterID: b.ClusterID, Namespace: b.Namespace, ReleaseName: b.ReleaseName}) != p.Target {
		return in, reconciliationConflict()
	}
	owned, err := q.ReleaseReconciliationOwnsTarget(ctx, sqlcdb.ReleaseReconciliationOwnsTargetParams{ID: d.TargetID, ActiveDeploymentID: &d.ID, FencingToken: d.FencingToken})
	if err != nil {
		return in, err
	}
	if !owned {
		return in, reconciliationConflict()
	}
	cluster, err := q.GetCluster(ctx, p.Target.ClusterID)
	if err != nil {
		return in, err
	}
	cr, err := q.GetCredential(ctx, cluster.CredentialID)
	if err != nil {
		return in, err
	}
	in.credential = release.CredentialRef{ID: cr.ID, Version: cr.Version}
	rows, err := q.ListDeploymentResources(ctx, d.ID)
	if err != nil {
		return in, err
	}
	for _, r := range rows {
		var owners []metav1.OwnerReference
		if err = json.Unmarshal(r.OwnerReferences, &owners); err != nil {
			return in, err
		}
		in.known = append(in.known, release.Resource{APIVersion: r.ApiVersion, Kind: r.Kind, Namespace: r.Namespace, Name: r.Name, UID: r.Uid, Owners: owners, Generation: r.ObservedGeneration})
	}
	return in, nil
}

// ReconcileDeployment performs only external reads between two short database
// transactions. It takes no lease: a worker or another reconciliation can win,
// in which case the final revision CAS discards this observation in its entirety.
func (s *Service) ReconcileDeployment(ctx context.Context, a auth.Actor, id string, input ReconcileDeploymentInput, key, req string) (idempotency.Result, error) {
	if err := httpx.UUID(id); err != nil {
		return idempotency.Result{}, err
	}
	if input.ExpectedRevision < 1 {
		return idempotency.Result{}, httpx.Invalid("expectedRevision 必须为正数")
	}
	if n := utf8.RuneCountInString(strings.TrimSpace(input.Reason)); n < 1 || n > 1000 {
		return idempotency.Result{}, httpx.Invalid("reason 必须包含 1–1000 个字符")
	}
	path := "/api/deployments/" + id + "/reconcile"
	const operation = "reconcileDeployment"
	var before reconciliationRead
	var replay bool
	load := func(q *sqlcdb.Queries) (reconciliationRead, idempotency.Result, bool, error) {
		state, err := reconciliationAccess(ctx, q, a, id)
		if err != nil {
			return state, idempotency.Result{}, false, err
		}
		result, found, err := idempotency.Lookup(ctx, q, a.ID, operation, key, "POST", path, input)
		if err != nil || found {
			return state, result, found, err
		}
		if err = mutable(state.app); err != nil {
			return state, result, false, err
		}
		state, err = reconciliationGuard(ctx, q, state, input.ExpectedRevision)
		return state, result, false, err
	}
	result, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
		var result idempotency.Result
		var err error
		before, result, replay, err = load(q)
		return result, err
	})
	if err != nil || replay {
		return result, err
	}
	observer, ok := s.releases.(releaseObserver)
	if !ok {
		return idempotency.Result{}, httpx.Fail(503, "deployment_observation_unavailable", "发布核对器尚未接入")
	}
	if s.vault == nil {
		return idempotency.Result{}, httpx.Fail(503, "release_credentials_unavailable", "集群凭据暂不可用")
	}
	cr := before.credential
	v, err := s.q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: cr.ID, Version: cr.Version})
	if err != nil {
		return idempotency.Result{}, httpx.Fail(503, "release_credentials_unavailable", "集群凭据暂不可用")
	}
	cluster, err := s.vault.Open(cr.ID, cr.Version, v.KeyID, v.EncryptedPayload)
	if err != nil {
		return idempotency.Result{}, httpx.Fail(503, "release_credentials_unavailable", "集群凭据暂不可用")
	}
	stepCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	o, readErr := observer.ObserveRelease(stepCtx, release.Input{Plan: before.plan, Hash: before.hash, Cluster: cluster, Known: before.known, Revision: before.deployment.HelmRevision})
	if ctx.Err() != nil {
		return idempotency.Result{}, ctx.Err()
	}
	var api *httpx.Error
	if errors.As(readErr, &api) && api.Code == "deployment_observation_unavailable" {
		return idempotency.Result{}, readErr
	}
	o = release.NormalizeObservation(o, readErr, before.deployment.StartedAt, before.plan.TimeoutSeconds)
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
		now, result, found, err := load(q)
		if err != nil || found {
			return result, err
		}
		if before.binding.Version != now.binding.Version || before.credential != now.credential || before.deployment.FencingToken != now.deployment.FencingToken || !reflect.DeepEqual(before.known, now.known) {
			return result, reconciliationConflict()
		}
		_, err = idempotency.Execute(ctx, q, a.ID, operation, key, "POST", path, input, func() (idempotency.Result, error) {
			var code *string
			if o.Code != "" {
				code = &o.Code
			}
			d, err := q.ReconcileRelease(ctx, sqlcdb.ReconcileReleaseParams{ID: id, ExpectedRevision: input.ExpectedRevision, Status: o.State, HelmRevision: o.Revision, ErrorCode: code})
			if errors.Is(err, pgx.ErrNoRows) {
				return result, reconciliationConflict()
			}
			if err != nil {
				return result, err
			}
			if err = release.PersistObservation(ctx, q, d, before.binding.ID, o); err != nil {
				return result, err
			}
			out := DeploymentReconciliation{DeploymentID: id, Revision: d.Revision, Status: d.Status, HelmRevision: d.HelmRevision, ErrorCode: d.ErrorCode, CheckedAt: now.deployment.CheckedAt, TargetReleased: d.Status == "succeeded" || d.Status == "failed"}
			if err = record(ctx, q, a, now.app, "deployment.reconcile", req, map[string]any{"deploymentId": id, "requestId": d.RequestID, "previousStatus": before.deployment.Status, "status": d.Status, "revision": d.Revision, "errorCode": d.ErrorCode, "reasonLength": utf8.RuneCountInString(strings.TrimSpace(input.Reason)), "targetReleased": out.TargetReleased}); err != nil {
				return result, err
			}
			raw, err := json.Marshal(out)
			return idempotency.Result{Status: 200, Body: raw}, err
		})
		if err != nil {
			return result, err
		}
		// JSONB canonicalizes key order. Return the stored representation on the
		// first call too, so the exact response bytes match subsequent replays.
		result, _, err = idempotency.Lookup(ctx, q, a.ID, operation, key, "POST", path, input)
		return result, err
	})
}
