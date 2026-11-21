package resource

import (
	"context"
	"encoding/json"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/idempotency"
	"github.com/xuzuxing/podry/internal/kubernetes"
)

type ActionInput struct {
	Action            string `json:"action"`
	Ref               *Ref   `json:"ref"`
	Replicas          *int32 `json:"replicas,omitempty"`
	PropagationPolicy string `json:"propagationPolicy,omitempty"`
}

func validateAction(in ActionInput) error {
	if !slices.Contains([]string{"delete", "restart", "scale"}, in.Action) || in.Ref == nil {
		return httpx.Invalid("必须提供 action 和完整资源 ref")
	}
	r := *in.Ref
	if !validGroup(r.Group) || !validSegment(r.Version, 63) || !validSegment(r.Resource, 253) || !validName(r.Name) || (r.Namespace != "" && !validSegment(r.Namespace, 63)) {
		return httpx.Invalid("资源 ref 的 GVR、名称或命名空间无效")
	}
	for _, v := range []string{r.UID, r.ResourceVersion} {
		if v == "" || len(v) > 256 || strings.ContainsAny(v, "\x00\r\n") {
			return httpx.Invalid("必须提供有效 UID 和 resourceVersion 以确认影响对象")
		}
	}
	if in.Action == "scale" {
		if in.Replicas == nil || *in.Replicas < 0 {
			return httpx.Invalid("scale 必须提供非负 int32 replicas")
		}
	} else if in.Replicas != nil {
		return httpx.Invalid("仅 scale 可指定 replicas")
	}
	if in.PropagationPolicy != "" && (in.Action != "delete" || !slices.Contains([]string{"Foreground", "Background", "Orphan"}, in.PropagationPolicy)) {
		return httpx.Invalid("仅 delete 可指定有效 propagationPolicy")
	}
	if in.Action != "delete" && (r.Group != "apps" || r.Version != "v1" || r.Resource != "deployments" || r.Namespace == "") {
		return httpx.Invalid("重启与扩缩容仅支持 apps/v1 namespaced Deployment")
	}
	return nil
}

func actionVerb(d writeDocument) string {
	if d.Action == "delete" {
		return "delete"
	}
	if d.Action == "create" {
		return "create"
	}
	return "update"
}
func isAction(d writeDocument) bool {
	return d.Action == "delete" || d.Action == "restart" || d.Action == "scale"
}

// HPA is a server-side safety check. Never return autoscaler names or payloads.
// Failure to list every page is a rejection, never proof that no HPA exists.
func checkHPA(ctx context.Context, c *kubernetes.Client, d writeDocument) error {
	if d.Action != "scale" {
		return nil
	}
	q := url.Values{"limit": {"200"}}
	seen := map[string]bool{}
	for page := 0; page < 10; page++ {
		var list struct {
			Items    []map[string]any `json:"items"`
			Metadata struct {
				Continue string `json:"continue"`
			} `json:"metadata"`
		}
		if err := c.Get(ctx, "/apis/autoscaling/v2/namespaces/"+d.Ref.Namespace+"/horizontalpodautoscalers", q, &list); err != nil {
			return httpx.Fail(409, "resource_hpa_unconfirmed", "无法完整确认 HPA；拒绝手工扩缩容")
		}
		if list.Items == nil || len(list.Items) > 200 {
			return httpx.Fail(409, "resource_hpa_unconfirmed", "无法完整确认 HPA；拒绝手工扩缩容")
		}
		for _, h := range list.Items {
			target := obj(obj(h, "spec"), "scaleTargetRef")
			if target == nil || str(target, "name") == "" || str(target, "kind") == "" || str(target, "apiVersion") == "" {
				return httpx.Fail(409, "resource_hpa_unconfirmed", "无法完整确认 HPA；拒绝手工扩缩容")
			}
			if str(target, "kind") == "Deployment" && str(target, "name") == d.Ref.Name && strings.HasPrefix(str(target, "apiVersion"), "apps/") {
				return httpx.Fail(409, "resource_hpa_managed", "Deployment 受 HPA 管理，拒绝手工扩缩容")
			}
		}
		token := list.Metadata.Continue
		if token == "" {
			return nil
		}
		if seen[token] {
			break
		}
		seen[token] = true
		q.Set("continue", token)
	}
	return httpx.Fail(409, "resource_hpa_unconfirmed", "HPA 查询超过分页预算")
}

func actionReleaseGuard(ctx context.Context, q *sqlcdb.Queries, cluster string, docs []writeDocument) error {
	for _, d := range docs {
		if !isAction(d) {
			continue
		}
		busy, err := q.ResourceActionReleaseBusy(ctx, sqlcdb.ResourceActionReleaseBusyParams{ClusterID: cluster, Namespace: d.Ref.Namespace})
		if err != nil {
			return err
		}
		if busy {
			return httpx.Fail(409, "resource_release_busy", "目标范围存在未完成的平台发布")
		}
	}
	return nil
}

func (s *Service) actionReplay(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, cluster, key, path string, in ActionInput) (idempotency.Result, bool, error) {
	old, found, err := idempotency.Lookup(ctx, q, a.ID, "actOnResource", key, "POST", path, in)
	if err != nil || !found {
		return old, found, err
	}
	var out Operation
	if json.Unmarshal(old.Body, &out) != nil {
		return old, true, httpx.Fail(503, "resource_snapshot_invalid", "幂等结果无效")
	}
	row, err := s.operationAccess(ctx, q, a, out.ID)
	if err == nil && row.ClusterID != cluster {
		err = httpx.NotFound()
	}
	return old, true, err
}

func (s *Service) Act(ctx context.Context, a auth.Actor, cluster, key string, in ActionInput, requestID string) (idempotency.Result, error) {
	if err := httpx.UUID(cluster); err != nil {
		return idempotency.Result{}, err
	}
	if err := validateAction(in); err != nil {
		return idempotency.Result{}, err
	}
	path := "/api/clusters/" + cluster + "/resource-actions"
	type prepared struct{ replay *idempotency.Result }
	prep, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (prepared, error) {
		x, e := s.lockedSnapshot(ctx, q, a, cluster)
		if e != nil {
			return prepared{}, e
		}
		old, found, e := s.actionReplay(ctx, q, a, cluster, key, path, in)
		if e != nil {
			return prepared{}, e
		}
		if found {
			return prepared{&old}, nil
		}
		t := ResourceType{Group: in.Ref.Group, Resource: in.Ref.Resource, Namespaced: in.Ref.Namespace != ""}
		if !actionAllowed(x, t, *in.Ref, in.Action) {
			return prepared{}, httpx.NotFound()
		}
		if !s.WritesEnabled {
			return prepared{}, httpx.Fail(503, "resource_execution_unavailable", "资源写入执行器尚未启用")
		}
		return prepared{}, nil
	})
	if err != nil {
		return idempotency.Result{}, err
	}
	if prep.replay != nil {
		return *prep.replay, nil
	}
	x, c, err := s.client(ctx, a, cluster, "", actionPermission(in.Action))
	if err != nil {
		return idempotency.Result{}, err
	}
	defer c.Close()
	t, err := resolve(ctx, c, url.Values{"group": {in.Ref.Group}, "version": {in.Ref.Version}, "resource": {in.Ref.Resource}})
	if err != nil {
		return idempotency.Result{}, err
	}
	d := writeDocument{Type: t, Ref: *in.Ref, Action: in.Action}
	if !actionAllowed(x, t, d.Ref, d.Action) {
		return idempotency.Result{}, httpx.NotFound()
	}
	if t.Namespaced != (d.Ref.Namespace != "") || !slices.Contains(t.Verbs, "get") || !slices.Contains(t.Verbs, actionVerb(d)) {
		return idempotency.Result{}, httpx.Invalid("资源作用域或可用动作不匹配")
	}
	if in.Action != "delete" && t.Kind != "Deployment" {
		return idempotency.Result{}, httpx.Invalid("重启和扩缩容仅支持 Deployment")
	}
	current, err := currentObject(ctx, c, d)
	if err != nil {
		return idempotency.Result{}, err
	}
	if str(obj(current, "metadata"), "deletionTimestamp") != "" {
		return idempotency.Result{}, httpx.Fail(409, "resource_deleting", "资源正在删除")
	}
	if err = checkHPA(ctx, c, d); err != nil {
		return idempotency.Result{}, err
	}
	id := uuid.NewString()
	if in.Action == "delete" {
		policy := in.PropagationPolicy
		if policy == "" {
			policy = "Background"
		}
		d.Manifest = map[string]any{"apiVersion": "v1", "kind": "DeleteOptions", "preconditions": map[string]any{"uid": d.Ref.UID, "resourceVersion": d.Ref.ResourceVersion}, "propagationPolicy": policy}
	} else {
		d.Manifest = copyMap(current)
		delete(d.Manifest, "status")
		if in.Action == "scale" {
			spec := obj(d.Manifest, "spec")
			if spec == nil {
				return idempotency.Result{}, httpx.Fail(503, "kubernetes_invalid_response", "Deployment spec 无效")
			}
			spec["replicas"] = json.Number(jsonInt(*in.Replicas))
		} else {
			spec := obj(obj(d.Manifest, "spec"), "template")
			if spec == nil {
				return idempotency.Result{}, httpx.Fail(503, "kubernetes_invalid_response", "Deployment template 无效")
			}
			meta := obj(spec, "metadata")
			if meta == nil {
				meta = map[string]any{}
				spec["metadata"] = meta
			}
			anns := obj(meta, "annotations")
			if anns == nil {
				anns = map[string]any{}
				meta["annotations"] = anns
			}
			anns["kubectl.kubernetes.io/restartedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
			anns["podry.io/restart-operation"] = id
		}
		d.Expected = normalized(d.Manifest)
	}
	plan := writePlan{Stamp: stamp(x, a.TokenVersion), Documents: []writeDocument{d}}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
		now, e := s.lockedSnapshot(ctx, q, a, cluster)
		if e != nil {
			return idempotency.Result{}, e
		}
		old, found, e := s.actionReplay(ctx, q, a, cluster, key, path, in)
		if e != nil || found {
			return old, e
		}
		if e = requireStamp(now, a, plan); e != nil {
			return idempotency.Result{}, e
		}
		if e = actionReleaseGuard(ctx, q, cluster, plan.Documents); e != nil {
			return idempotency.Result{}, e
		}
		return idempotency.Execute(ctx, q, a.ID, "actOnResource", key, "POST", path, in, func() (idempotency.Result, error) {
			encrypted, keyID, e := s.sealPlan("resource-operation", id, plan)
			if e != nil {
				return idempotency.Result{}, e
			}
			redacted, _ := json.Marshal([]writeDocument{{Type: t, Ref: d.Ref, Action: d.Action}})
			states, _ := json.Marshal([]OperationItem{{Index: 0, Status: "pending", Ref: &d.Ref}})
			row, e := q.InsertResourceAction(ctx, sqlcdb.InsertResourceActionParams{ID: id, ClusterID: cluster, RequestedBy: a.ID, Kind: in.Action, EncryptedPayload: encrypted, KeyID: keyID, PayloadRedacted: redacted, ResultRedacted: states})
			if e != nil {
				return idempotency.Result{}, e
			}
			target, _ := json.Marshal(map[string]any{"operationId": id, "ref": d.Ref, "action": in.Action, "replicas": in.Replicas, "propagationPolicy": in.PropagationPolicy})
			if e = q.RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &a.ID, ClusterID: &cluster, Action: "resource." + in.Action, RequestID: requestID, Target: target, Result: "accepted"}); e != nil {
				return idempotency.Result{}, e
			}
			out, _ := operationDTO(row)
			raw, e := json.Marshal(out)
			return idempotency.Result{Status: 202, Body: raw}, e
		})
	})
}

func jsonInt(n int32) string { raw, _ := json.Marshal(n); return string(raw) }

func observeDelete(ctx context.Context, c *kubernetes.Client, d writeDocument) (Ref, error) {
	current, err := readWriteObject(ctx, c, d.Type.path(d.Ref.Namespace, d.Ref.Name))
	if statusCode(err, 404) {
		return d.Ref, nil
	}
	if err != nil {
		return d.Ref, err
	}
	ref := d.Ref
	ref.UID = ""
	if err = responseIdentity(d.Type, ref, current, true); err != nil {
		return d.Ref, err
	}
	if str(obj(current, "metadata"), "uid") != d.Ref.UID {
		return d.Ref, nil
	}
	return d.Ref, httpx.Fail(409, "resource_outcome_unknown", "原对象仍存在或正在终止；不会重复删除")
}
