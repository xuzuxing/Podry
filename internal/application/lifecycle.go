package application

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/idempotency"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/release"
)

type LifecycleInput struct {
	ExpectedVersion int32  `json:"expectedVersion"`
	Reason          string `json:"reason"`
}

func removalPermission(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, p release.Plan) error {
	if err := releasePermission(ctx, q, a, app, frozenConfig(p), p.Target); err != nil {
		return err
	}
	resources, err := release.Objects(p)
	if err != nil {
		return err
	}
	for _, r := range resources {
		resource := ""
		switch r.Kind {
		case "Deployment":
			resource = "apps/deployments"
		case "Job":
			resource = "batch/jobs"
		case "Service":
			resource = "core/services"
		case "Ingress":
			resource = "networking.k8s.io/ingresses"
		case "Secret":
			resource = "core/secrets"
		case "ConfigMap":
			resource = "core/configmaps"
		}
		if err = platform.RequireTarget(ctx, q, a, app.ProjectID, p.Target.ClusterID, p.Target.Namespace, resource, "resource.delete"); err != nil {
			return err
		}
	}
	return platform.RequireTarget(ctx, q, a, app.ProjectID, p.Target.ClusterID, p.Target.Namespace, "core/pods", "resource.view")
}

func (s *Service) BindingLifecycle(ctx context.Context, a auth.Actor, appID, bindingID, action string, in LifecycleInput, key, req string) (idempotency.Result, error) {
	if err := httpx.UUID(bindingID); err != nil {
		return idempotency.Result{}, err
	}
	if in.ExpectedVersion < 1 || utf8.RuneCountInString(strings.TrimSpace(in.Reason)) < 1 || utf8.RuneCountInString(in.Reason) > 1000 || (action != "offline" && action != "detach") {
		return idempotency.Result{}, httpx.Invalid("需要绑定版本与 1–1000 字符的操作理由")
	}
	operation := "binding." + action
	path := "/api/apps/" + appID + "/environments/" + bindingID + "/" + action
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
		app, err := deployAccess(ctx, q, a, appID)
		if err != nil {
			return idempotency.Result{}, err
		}
		if action == "detach" {
			if _, err = access(ctx, q, a, appID, true); err != nil {
				return idempotency.Result{}, err
			}
		}
		b, err := q.GetReleaseBinding(ctx, sqlcdb.GetReleaseBindingParams{ID: bindingID, AppID: appID})
		if err != nil {
			return idempotency.Result{}, err
		}
		target := Target{ClusterID: b.ClusterID, Namespace: b.Namespace, ReleaseName: b.ReleaseName}
		if err = lockTargets(ctx, q, []Target{target}); err != nil {
			return idempotency.Result{}, err
		}
		// Replays reauthorize the exact frozen removal, including after detach.
		if previous, hit, e := idempotency.Lookup(ctx, q, a.ID, operation, key, "POST", path, in); e != nil {
			return previous, e
		} else if hit {
			if action == "offline" {
				var result ReleaseRequest
				if e = json.Unmarshal(previous.Body, &result); e != nil {
					return previous, e
				}
				r, e := q.GetReleaseRequest(ctx, result.RequestID)
				if e != nil {
					return previous, e
				}
				snap, e := q.GetReleaseSnapshot(ctx, r.SnapshotID)
				if e != nil {
					return previous, e
				}
				p, e := decodeReleasePlan(snap.Snapshot, snap.SnapshotSha256)
				if e != nil {
					return previous, e
				}
				if e = removalPermission(ctx, q, a, app, p); e != nil {
					return previous, e
				}
			}
			return previous, nil
		}
		result, err := idempotency.Execute(ctx, q, a.ID, operation, key, "POST", path, in, func() (idempotency.Result, error) {
			if err = mutable(app); err != nil {
				return idempotency.Result{}, err
			}
			if b.DetachedAt != nil {
				return idempotency.Result{}, httpx.Fail(409, "binding_detached", "环境绑定已解除")
			}
			if b.Version != in.ExpectedVersion {
				return idempotency.Result{}, httpx.Fail(409, "revision_conflict", "环境绑定版本已变化")
			}
			busy, err := q.BindingTargetBusy(ctx, b.TargetID)
			if err != nil {
				return idempotency.Result{}, err
			}
			if busy {
				return idempotency.Result{}, httpx.Fail(409, "target_busy", "目标仍有活动或结果未知的发布")
			}
			if err = q.DisableBindingPipelines(ctx, &b.ID); err != nil {
				return idempotency.Result{}, err
			}
			workflowVersion, err := q.NextWorkflowVersion(ctx, app.ID)
			if err != nil {
				return idempotency.Result{}, err
			}
			if action == "detach" {
				history, err := q.BindingHasHistory(ctx, b.ID)
				if err != nil {
					return idempotency.Result{}, err
				}
				if history {
					offline, e := q.BindingSafelyOffline(ctx, b.ID)
					if e != nil {
						return idempotency.Result{}, e
					}
					if !offline {
						return idempotency.Result{}, httpx.Fail(409, "binding_not_offline", "已有发布历史的环境必须先完成下线核对")
					}
				}
				if b.CurrentDeploymentID != nil {
					return idempotency.Result{}, httpx.Fail(409, "binding_not_offline", "环境仍有当前发布")
				}
				if n, e := q.DetachBinding(ctx, b.ID); e != nil {
					return idempotency.Result{}, e
				} else if n != 1 {
					return idempotency.Result{}, httpx.Fail(409, "revision_conflict", "环境绑定已变化")
				}
				if err = record(ctx, q, a, app, "application.binding.detach", req, map[string]any{"bindingId": b.ID, "reasonLength": len(in.Reason)}); err != nil {
					return idempotency.Result{}, err
				}
				body, _ := json.Marshal(map[string]any{"bindingId": b.ID, "detached": true, "version": b.Version + 1})
				return idempotency.Result{Status: 200, Body: body}, nil
			}
			if b.CurrentDeploymentID == nil {
				return idempotency.Result{}, httpx.Fail(409, "binding_not_deployed", "环境没有可下线的当前成功发布")
			}
			d, err := q.GetDeployment(ctx, *b.CurrentDeploymentID)
			if err != nil {
				return idempotency.Result{}, err
			}
			if d.Status != "succeeded" || d.HelmRevision == nil {
				return idempotency.Result{}, httpx.Fail(409, "source_deployment_unavailable", "来源发布缺少成功的 Helm 版本")
			}
			snap, err := q.GetReleaseSnapshot(ctx, d.SnapshotID)
			if err != nil {
				return idempotency.Result{}, err
			}
			p, err := decodeReleasePlan(snap.Snapshot, snap.SnapshotSha256)
			if err != nil {
				return idempotency.Result{}, err
			}
			if p.Removal != nil || p.BindingID != b.ID || p.TargetID != b.TargetID || p.DeploymentID != d.ID {
				return idempotency.Result{}, httpx.Fail(409, "source_deployment_unavailable", "发布身份不一致")
			}
			if err = removalPermission(ctx, q, a, app, p); err != nil {
				return idempotency.Result{}, err
			}
			if s.releases == nil {
				return idempotency.Result{}, httpx.Fail(503, "deployment_execution_unavailable", "发布执行器未开启")
			}
			if err = s.releases.Ready(target); err != nil {
				return idempotency.Result{}, err
			}
			known, err := q.ListDeploymentResources(ctx, d.ID)
			if err != nil {
				return idempotency.Result{}, err
			}
			refs, err := release.Objects(p)
			if err != nil {
				return idempotency.Result{}, err
			}
			if len(refs) != len(known) {
				return idempotency.Result{}, httpx.Fail(409, "release_identity_unavailable", "缺少原资源 UID，需先核对来源发布")
			}
			removal := &release.RemovalPlan{DeploymentID: d.ID, SnapshotSHA256: snap.SnapshotSha256, HelmRevision: *d.HelmRevision}
			for _, r := range known {
				removal.Resources = append(removal.Resources, release.Resource{APIVersion: r.ApiVersion, Kind: r.Kind, Namespace: r.Namespace, Name: r.Name, UID: r.Uid})
			}
			p.Removal = removal
			p.DeploymentID = uuid.NewString()
			p.RequestID = uuid.NewString()
			p.BindingVersion = b.Version + 1
			p.WorkflowVersion = workflowVersion
			p.ClusterCredential, err = s.releaseCluster(ctx, q, target.ClusterID)
			if err != nil {
				return idempotency.Result{}, err
			}
			if err = q.DisableBindingDelivery(ctx, b.ID); err != nil {
				return idempotency.Result{}, err
			}
			return s.persistReleaseAction(ctx, q, a, d.ID, "offline", strings.TrimSpace(in.Reason), req, p)
		})
		if err != nil {
			return result, err
		}
		// Read JSONB on the first call as well so replay bytes match exactly.
		result, _, err = idempotency.Lookup(ctx, q, a.ID, operation, key, "POST", path, in)
		return result, err
	})
}
