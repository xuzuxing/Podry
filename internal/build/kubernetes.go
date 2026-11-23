package build

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strings"

	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/kubernetes"
)

type object map[string]any

func obj(v any) object {
	m, _ := v.(map[string]any)
	if m == nil {
		if o, ok := v.(object); ok {
			return o
		}
		return object{}
	}
	return object(m)
}
func text(v any) string { s, _ := v.(string); return s }
func code(err error) string {
	var api *httpx.Error
	if errors.As(err, &api) {
		return api.Code
	}
	return "execution_unavailable"
}
func (s *Service) client(ctx context.Context, spec ExecutionSpec) (*kubernetes.Client, error) {
	p, e := s.Secret(ctx, spec.ClusterCredential)
	if e != nil {
		return nil, e
	}
	if p["apiServer"] != spec.APIServer {
		return nil, httpx.Fail(409, "execution_integrity_failed", "冻结的集群地址不匹配")
	}
	return kubernetes.New(p)
}
func metadata(spec ExecutionSpec, uid string) object {
	m := object{"name": spec.JobName, "namespace": spec.Namespace, "annotations": object{"podry.io/attempt-id": spec.AttemptID, "podry.io/execution-hash": Hash(spec)}}
	if uid != "" {
		m["ownerReferences"] = []any{object{"apiVersion": "batch/v1", "kind": "Job", "name": spec.JobName, "uid": uid, "controller": true, "blockOwnerDeletion": false}}
	}
	return m
}
func owned(o object, spec ExecutionSpec) bool {
	a := obj(obj(o["metadata"])["annotations"])
	return a["podry.io/attempt-id"] == spec.AttemptID && a["podry.io/execution-hash"] == Hash(spec)
}

func job(spec ExecutionSpec) object {
	volumes := []any{object{"name": "workspace", "emptyDir": object{"sizeLimit": "2Gi"}}, object{"name": "tmp", "emptyDir": object{"sizeLimit": "512Mi"}}, object{"name": "spec", "configMap": object{"name": spec.JobName + "-spec"}}, object{"name": "auth", "secret": object{"secretName": spec.JobName + "-auth", "defaultMode": int32(256)}}}
	mounts := []any{object{"name": "workspace", "mountPath": "/workspace"}, object{"name": "tmp", "mountPath": "/tmp"}, object{"name": "spec", "mountPath": "/run/podry", "readOnly": true}, object{"name": "auth", "mountPath": "/run/podry-auth", "readOnly": true}}
	container := func(name, mode string) object {
		return object{"name": name, "image": spec.RunnerImage, "imagePullPolicy": "IfNotPresent", "command": []string{"/usr/local/bin/podry-build-runner", mode}, "volumeMounts": mounts, "resources": object{"requests": object{"cpu": "100m", "memory": "128Mi"}, "limits": object{"cpu": spec.CPU, "memory": spec.Memory}}, "securityContext": object{"allowPrivilegeEscalation": false, "readOnlyRootFilesystem": true, "capabilities": object{"drop": []string{"ALL"}}}, "terminationMessagePath": "/dev/termination-log", "terminationMessagePolicy": "File"}
	}
	init := []any{container("source", "source")}
	if spec.CheckScript != nil {
		check := container("check", "check")
		check["volumeMounts"] = []any{object{"name": "workspace", "mountPath": "/workspace"}, object{"name": "check-tmp", "mountPath": "/tmp"}, object{"name": "spec", "mountPath": "/run/podry", "readOnly": true}}
		volumes = append(volumes, object{"name": "check-tmp", "emptyDir": object{"sizeLimit": "512Mi"}})
		init = append(init, check)
	}
	return object{"apiVersion": "batch/v1", "kind": "Job", "metadata": metadata(spec, ""), "spec": object{"suspend": true, "backoffLimit": 0, "activeDeadlineSeconds": spec.TimeoutSeconds, "template": object{"metadata": object{"annotations": object{"podry.io/attempt-id": spec.AttemptID, "podry.io/execution-hash": Hash(spec)}}, "spec": object{"restartPolicy": "Never", "automountServiceAccountToken": false, "enableServiceLinks": false, "nodeSelector": object{"kubernetes.io/os": "linux", "kubernetes.io/arch": strings.TrimPrefix(spec.Platform, "linux/")}, "securityContext": object{"seccompProfile": object{"type": "RuntimeDefault"}}, "initContainers": init, "containers": []any{container("build", "build")}, "volumes": volumes}}}}
}
func (s *Service) step(ctx context.Context, spec ExecutionSpec, row sqlcdb.BuildAttempt, create bool) stepResult {
	r := stepResult{stage: row.Stage, status: row.Status, availability: row.LogAvailability}
	if r.status == "unknown" {
		r.status = "queued"
	}
	fail := func(c string) stepResult { r.stage = "finished"; r.status = "failed"; r.code = c; return r }
	unknown := func(c string) stepResult { r.status = "unknown"; r.code = c; return r }
	c, e := s.client(ctx, spec)
	if e != nil {
		return unknown(code(e))
	}
	defer c.Close()
	base := "/apis/batch/v1/namespaces/" + spec.Namespace + "/jobs"
	path := base + "/" + spec.JobName
	var j object
	e = c.Get(ctx, path, nil, &j)
	if e != nil {
		if code(e) != "resource_not_found" {
			return unknown(code(e))
		}
		if !create {
			return unknown("job_outcome_unknown")
		}
		// The durable creating stage was committed before this first POST.
		e = c.Write(ctx, "POST", base, job(spec), &j)
		if e != nil {
			return unknown(code(e))
		}
	}
	uid := text(obj(j["metadata"])["uid"])
	if !owned(j, spec) || uid == "" || (row.JobUid != nil && *row.JobUid != uid) {
		return unknown("job_identity_conflict")
	}
	r.uid = uid
	if row.Stage == "creating" || row.Stage == "planned" {
		r.stage = "preparing"
		r.status = "queued"
		return r
	}
	if row.Stage == "preparing" {
		// Before starting user code, recheck current authorization, but retain the
		// suspended Job identity if authorization was revoked during preparation.
		if e = s.authorize(ctx, spec); e != nil {
			a := authorizationFailure(e, row.Stage)
			a.uid = uid
			return a
		}
		if e = s.prepare(ctx, c, spec, uid); e != nil {
			return unknown(code(e))
		}
		r.stage = "starting"
		r.status = "queued"
		return r
	}
	if row.Stage == "starting" {
		if obj(j["spec"])["suspend"] == true {
			if e = s.authorize(ctx, spec); e != nil {
				a := authorizationFailure(e, row.Stage)
				a.uid = uid
				return a
			}
			patch := object{"metadata": object{"uid": uid, "resourceVersion": obj(j["metadata"])["resourceVersion"]}, "spec": object{"suspend": false}}
			if e = c.Write(ctx, "PATCH", path, patch, &j); e != nil {
				return unknown(code(e))
			}
		}
		r.stage = "observing"
		r.status = "running"
		r.availability = "runtime"
		return r
	}
	r.stage = "observing"
	r.status = "running"
	r.availability = "runtime"
	conditions, _ := obj(j["status"])["conditions"].([]any)
	complete := false
	failed := false
	for _, v := range conditions {
		cond := obj(v)
		if cond["status"] == "True" {
			if cond["type"] == "Failed" {
				failed = true
			}
			if cond["type"] == "Complete" {
				complete = true
			}
		}
	}
	if !complete && !failed {
		return r
	}
	pods, e := readPods(ctx, c, spec, uid)
	if e != nil {
		return unknown(code(e))
	}
	if !jobStopped(j) || !podsStopped(pods) {
		return r
	}
	if failed {
		return fail("build_job_failed")
	}
	var result RunnerResult
	found := false
	for _, p := range pods {
		statuses, _ := obj(p["status"])["containerStatuses"].([]any)
		for _, v := range statuses {
			st := obj(v)
			term := obj(obj(st["state"])["terminated"])
			if st["name"] == "build" && term["exitCode"] == float64(0) {
				msg := text(term["message"])
				if len(msg) > 1024 || json.Unmarshal([]byte(msg), &result) != nil {
					return fail("build_result_invalid")
				}
				found = true
			}
		}
	}
	if !found || result.Version != 1 || result.AttemptID != spec.AttemptID || result.ImageRepository != registryRepository(spec) || !regexp.MustCompile(`^sha256:[0-9a-f]{64}$`).MatchString(result.Digest) {
		return fail("build_result_invalid")
	}
	r.stage = "verifying"
	if e = s.verifyDigest(ctx, spec, result.Digest); e != nil {
		r.status = "unknown"
		r.code = code(e)
		return r
	}
	r.stage = "finished"
	r.status = "succeeded"
	r.digest = result.Digest
	return r
}
func (s *Service) prepare(ctx context.Context, c *kubernetes.Client, spec ExecutionSpec, uid string) error {
	raw, _ := json.Marshal(spec)
	cm := object{"apiVersion": "v1", "kind": "ConfigMap", "metadata": metadata(spec, uid), "immutable": true, "data": object{"input.json": string(raw)}}
	obj(cm["metadata"])["name"] = spec.JobName + "-spec"
	auth := object{"git.json": "{}", "config.json": "{\"auths\":{}}"}
	if spec.GitCredential != nil {
		p, e := s.Secret(ctx, *spec.GitCredential)
		if e != nil {
			return e
		}
		b, _ := json.Marshal(p)
		auth["git.json"] = string(b)
	}
	if spec.RegistryCredential != nil {
		p, e := s.Secret(ctx, *spec.RegistryCredential)
		if e != nil {
			return e
		}
		u, _ := url.Parse(spec.RegistryEndpoint)
		user, _ := p["username"].(string)
		password, _ := p["password"].(string)
		b, _ := json.Marshal(object{"auths": object{u.Host: object{"auth": base64.StdEncoding.EncodeToString([]byte(user + ":" + password))}}})
		auth["config.json"] = string(b)
	}
	secret := object{"apiVersion": "v1", "kind": "Secret", "metadata": metadata(spec, uid), "immutable": true, "type": "Opaque", "stringData": auth}
	obj(secret["metadata"])["name"] = spec.JobName + "-auth"
	for _, item := range []struct {
		plural string
		value  object
	}{{"configmaps", cm}, {"secrets", secret}} {
		base := "/api/v1/namespaces/" + spec.Namespace + "/" + item.plural
		name := text(obj(item.value["metadata"])["name"])
		var old object
		e := c.Get(ctx, base+"/"+name, nil, &old)
		if code(e) == "resource_not_found" {
			e = c.Write(ctx, "POST", base, item.value, &old)
		}
		if e != nil {
			return e
		}
		if !owned(old, spec) || !hasOwner(old, uid) {
			return httpx.Fail(409, "job_identity_conflict", "任务依赖对象身份冲突")
		}
	}
	return nil
}
func hasOwner(p object, uid string) bool {
	refs, _ := obj(p["metadata"])["ownerReferences"].([]any)
	for _, r := range refs {
		if obj(r)["uid"] == uid && obj(r)["kind"] == "Job" && obj(r)["controller"] == true {
			return true
		}
	}
	return false
}
func readPods(ctx context.Context, c *kubernetes.Client, spec ExecutionSpec, uid string) ([]object, error) {
	var list struct {
		Items    []map[string]any `json:"items"`
		Metadata struct {
			Continue string `json:"continue"`
		} `json:"metadata"`
	}
	e := c.Get(ctx, "/api/v1/namespaces/"+spec.Namespace+"/pods", url.Values{"labelSelector": {"controller-uid=" + uid}, "limit": {"20"}}, &list)
	if e != nil {
		return nil, e
	}
	if list.Metadata.Continue != "" {
		return nil, httpx.Fail(503, "build_pod_limit", "构建 Pod 数量超过读取预算")
	}
	out := []object{}
	for _, p := range list.Items {
		if hasOwner(object(p), uid) {
			out = append(out, object(p))
		}
	}
	return out, nil
}
