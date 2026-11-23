package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/release"
	"github.com/xuzuxing/podry/internal/resource"
)

// These fixtures use real PostgreSQL and a read-only TLS API. No Helm worker,
// Registry or Git server runs; the execution records are explicit test seeds.
type applicationAPI struct {
	server  *httptest.Server
	mu      sync.Mutex
	objects map[string]map[string]any
	hook    func(*http.Request)
	fail    atomic.Int32
	reads   atomic.Int64
	writes  atomic.Int64
}

func resourceURL(raw map[string]any) string {
	api, kind := raw["apiVersion"].(string), raw["kind"].(string)
	base := "/apis/" + api
	if api == "v1" {
		base = "/api/v1"
	}
	plurals := map[string]string{"Deployment": "deployments", "Job": "jobs", "ReplicaSet": "replicasets", "Pod": "pods", "Secret": "secrets", "ConfigMap": "configmaps", "Service": "services", "Ingress": "ingresses"}
	m := bm(raw["metadata"])
	return base + "/namespaces/" + m["namespace"].(string) + "/" + plurals[kind] + "/" + m["name"].(string)
}

func newApplicationAPI(t *testing.T) *applicationAPI {
	a := &applicationAPI{objects: map[string]map[string]any{}}
	a.server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			a.writes.Add(1)
			http.Error(w, "read only", 405)
			return
		}
		a.reads.Add(1)
		a.mu.Lock()
		hook := a.hook
		a.mu.Unlock()
		if hook != nil {
			hook(r)
		}
		if fail := a.fail.Load(); fail != 0 {
			http.Error(w, "private remote error", int(fail))
			return
		}
		reply := func(v any) { w.Header().Set("Content-Type", "application/json"); _ = json.NewEncoder(w).Encode(v) }
		if !strings.Contains(r.URL.Path, "/namespaces/") {
			version := strings.TrimPrefix(r.URL.Path, "/apis/")
			if r.URL.Path == "/api/v1" {
				version = "v1"
			}
			types := map[string]map[string]string{"v1": {"pods": "Pod", "services": "Service", "secrets": "Secret", "configmaps": "ConfigMap"}, "apps/v1": {"deployments": "Deployment", "replicasets": "ReplicaSet"}, "batch/v1": {"jobs": "Job"}, "networking.k8s.io/v1": {"ingresses": "Ingress"}}
			items := []any{}
			for name, kind := range types[version] {
				items = append(items, map[string]any{"name": name, "kind": kind, "namespaced": true, "verbs": []string{"get", "list"}})
			}
			reply(map[string]any{"groupVersion": version, "resources": items})
			return
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		if raw, ok := a.objects[r.URL.Path]; ok {
			reply(raw)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/pods") || strings.HasSuffix(r.URL.Path, "/replicasets") {
			items := []any{}
			for path, raw := range a.objects {
				if strings.HasPrefix(path, r.URL.Path+"/") {
					b, _ := json.Marshal(raw)
					var copy map[string]any
					_ = json.Unmarshal(b, &copy)
					delete(copy, "apiVersion")
					delete(copy, "kind")
					items = append(items, copy)
				}
			}
			reply(map[string]any{"items": items, "metadata": map[string]any{"resourceVersion": "10"}})
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(a.server.Close)
	return a
}

type applicationResourceFixture struct {
	*releaseFixture
	api        *applicationAPI
	plan       release.Plan
	credential string
	workload   string
}

func setupApplicationResources(t *testing.T, kind string) *applicationResourceFixture {
	return setupApplicationResourcesWithConfigFiles(t, kind, false)
}

func setupApplicationResourcesWithConfigFiles(t *testing.T, kind string, withFiles bool) *applicationResourceFixture {
	t.Helper()
	f := setupRelease(t, kind)
	configVersion := int32(3)
	if withFiles {
		cfg := decode[application.Config](t, f.c.f.call("GET", "/api/apps/"+f.app+"/config", f.c.developer, nil, 200))
		cfg.ChartConfig.ChartVersion = "1.2.0"
		cfg.DeployValues["configFiles"] = map[string]any{"app.yaml": "mode: ordinary-config"}
		f.c.f.call("PUT", "/api/apps/"+f.app+"/config", f.c.developer, map[string]any{"expectedVersion": cfg.Version, "section": "base", "chartConfig": cfg.ChartConfig, "deployValues": cfg.DeployValues, "secretRefs": cfg.SecretRefs}, 200)
		configVersion++
	}
	a := newApplicationAPI(t)
	cred := decode[platform.Credential](t, f.c.f.call("POST", "/api/credentials", f.c.admin, map[string]any{"name": "Resource fixture", "kind": "kubeconfig", "payload": map[string]any{"apiServer": a.server.URL, "token": "fixture", "insecureSkipTLSVerify": true}}, 201))
	cluster := decode[platform.Cluster](t, f.c.f.call("POST", "/api/clusters", f.c.admin, map[string]any{"name": "Resource fixture cluster", "apiServer": a.server.URL, "credentialId": cred.ID}, 201))
	// Bind the isolated fixture to the new cluster before freezing a preview;
	// the public cluster patch correctly keeps apiServer immutable.
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployment_targets SET cluster_id=$2 WHERE id=(SELECT target_id FROM app_environment_bindings WHERE id=$1)", f.binding, cluster.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE resource_grants SET cluster_id=$2 WHERE id=$1", f.grant, cluster.ID); err != nil {
		t.Fatal(err)
	}
	f.c.clusterID = cluster.ID
	f.apps.UseReleases(releaseReady{})
	p := f.preview(t, configVersion)
	r := decode[application.ReleaseRequest](t, f.confirm(t, p, "resources-confirm", 202))
	var raw []byte
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT snapshot FROM release_snapshots WHERE id=$1", r.SnapshotID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	out := &applicationResourceFixture{releaseFixture: f, api: a, credential: cred.ID}
	if err := json.Unmarshal(raw, &out.plan); err != nil {
		t.Fatal(err)
	}
	for _, o := range manifestObjects(t, out.plan.Chart.Manifest) {
		m := bm(o["metadata"])
		uid := o["kind"].(string) + "-fixture"
		m["uid"], m["resourceVersion"], m["generation"] = uid, "10", 1
		if o["kind"] == "Secret" {
			o["data"] = map[string]any{"DATABASE_URL": "cHJpdmF0ZS1saXZlLXNlY3JldA=="}
			m["annotations"] = map[string]any{"private": "secret-annotation-must-disappear"}
		}
		if o["kind"] == kind {
			out.workload = resourceURL(o)
			if kind == "Deployment" {
				o["status"] = map[string]any{"observedGeneration": 1, "replicas": 1, "updatedReplicas": 1, "readyReplicas": 1, "availableReplicas": 1, "conditions": []any{map[string]any{"type": "Available", "status": "True"}}}
			}
			if kind == "Job" {
				o["status"] = map[string]any{"succeeded": 1, "conditions": []any{map[string]any{"type": "Complete", "status": "True"}}}
			}
		}
		a.objects[resourceURL(o)] = o
		if _, err := f.c.f.pool.Exec(context.Background(), "INSERT INTO deployment_resources(deployment_id,api_version,kind,namespace,name,uid) VALUES($1,$2,$3,$4,$5,$6)", out.plan.DeploymentID, o["apiVersion"], o["kind"], m["namespace"], m["name"], uid); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET status='succeeded',helm_revision=1 WHERE id=$1", out.plan.DeploymentID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE app_environment_bindings SET current_deployment_id=$2 WHERE id=$1", out.binding, out.plan.DeploymentID); err != nil {
		t.Fatal(err)
	}
	parentKind, parentVersion, parentName, parentUID := kind, "batch/v1", "release-demo", "Job-fixture"
	parentName = bm(a.objects[out.workload]["metadata"])["name"].(string)
	if kind == "Deployment" {
		parentKind, parentVersion, parentName, parentUID = "ReplicaSet", "apps/v1", "demo-rs", "rs-fixture"
		rs := map[string]any{"apiVersion": "apps/v1", "kind": "ReplicaSet", "metadata": map[string]any{"name": parentName, "namespace": "demo", "uid": parentUID, "resourceVersion": "10", "ownerReferences": []any{map[string]any{"apiVersion": "apps/v1", "kind": "Deployment", "name": "release-demo", "uid": "Deployment-fixture", "controller": true}}}}
		a.objects[resourceURL(rs)] = rs
	}
	labels := bm(bm(a.objects[out.workload]["spec"])["template"])["metadata"].(map[string]any)["labels"]
	pod := map[string]any{"apiVersion": "v1", "kind": "Pod", "metadata": map[string]any{"name": "demo-pod", "namespace": "demo", "uid": "pod-fixture", "resourceVersion": "10", "labels": labels, "ownerReferences": []any{map[string]any{"apiVersion": parentVersion, "kind": parentKind, "name": parentName, "uid": parentUID, "controller": true}}}, "spec": map[string]any{"containers": []any{map[string]any{"name": "app", "image": out.plan.ImageRef}}}, "status": map[string]any{"phase": "Running"}}
	if kind == "Job" {
		pod["status"] = map[string]any{"phase": "Succeeded"}
	}
	a.objects[resourceURL(pod)] = pod
	// Label spoofing and a UID with the wrong owner Kind must both be rejected.
	for _, name := range []string{"foreign-labels", "foreign-owner"} {
		b, _ := json.Marshal(pod)
		var foreign map[string]any
		_ = json.Unmarshal(b, &foreign)
		m := bm(foreign["metadata"])
		m["name"], m["uid"] = name, name
		if name == "foreign-labels" {
			delete(m, "ownerReferences")
		} else {
			bm(m["ownerReferences"].([]any)[0])["kind"] = "Deployment"
		}
		a.objects[resourceURL(foreign)] = foreign
	}
	return out
}

func (f *applicationResourceFixture) resources(t *testing.T, status int) []resource.Object {
	t.Helper()
	raw := f.c.f.call("GET", "/api/apps/"+f.app+"/resources?bindingId="+f.binding, f.c.developer, nil, status)
	if status != 200 {
		return nil
	}
	return decode[[]resource.Object](t, raw)
}
func (f *applicationResourceFixture) diff(t *testing.T, status int) application.Diff {
	t.Helper()
	raw := f.c.f.call("GET", "/api/deployments/"+f.plan.DeploymentID+"/diff", f.c.developer, nil, status)
	if status != 200 {
		return application.Diff{}
	}
	return decode[application.Diff](t, raw)
}
func (f *applicationResourceFixture) health(t *testing.T, want string) {
	t.Helper()
	a := decode[application.Application](t, f.c.f.call("GET", "/api/apps/"+f.app, f.c.developer, nil, 200))
	if a.Health != want {
		t.Fatalf("health=%s, want %s", a.Health, want)
	}
	page := decode[struct {
		Items []application.Application
		Total int
	}](t, f.c.f.call("GET", "/api/apps?health="+want, f.c.developer, nil, 200))
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].Health != want {
		t.Fatal("health filter and response disagree", page)
	}
}

func TestApplicationResourcesOwnershipDiffAndFreshHealth(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	f.health(t, "unknown")
	items := f.resources(t, 200)
	if len(items) != 6 {
		t.Fatalf("expected four roots and two descendants, got %d: %+v", len(items), items)
	}
	for _, o := range items {
		if strings.HasPrefix(o.Ref.Name, "foreign") {
			t.Fatal("adopted spoofed resource")
		}
		if strings.Contains(o.Manifest, "cHJpdmF0ZS") || strings.Contains(o.Manifest, "secret-annotation") {
			t.Fatal("Secret leaked")
		}
	}
	f.health(t, "healthy")
	d := f.diff(t, 200)
	if d.Before != d.After {
		t.Fatalf("normalization introduced drift\nbefore: %s\nafter: %s", d.Before, d.After)
	}
	f.api.mu.Lock()
	bm(f.api.objects[f.workload]["spec"])["replicas"] = 2
	f.api.mu.Unlock()
	d = f.diff(t, 200)
	if d.Before == d.After || !strings.Contains(d.After, `"replicas": 2`) {
		t.Fatal("live drift missing")
	}
	f.resources(t, 200)
	f.health(t, "progressing")
	f.api.mu.Lock()
	bm(f.api.objects[f.workload]["spec"])["replicas"] = 0
	f.api.objects[f.workload]["status"] = map[string]any{"observedGeneration": 1}
	f.api.mu.Unlock()
	f.resources(t, 200)
	f.health(t, "stopped")
	f.api.mu.Lock()
	bm(bm(bm(f.api.objects[f.workload]["spec"])["template"])["spec"])["containers"].([]any)[0].(map[string]any)["image"] = "foreign:latest"
	f.api.mu.Unlock()
	f.resources(t, 200)
	f.health(t, "degraded")
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE binding_observations SET observed_at=now()-interval '61 seconds'"); err != nil {
		t.Fatal(err)
	}
	f.health(t, "unknown")
	if f.api.writes.Load() != 0 {
		t.Fatal("read endpoints wrote to cluster")
	}
}

func TestApplicationResourcesGeneratedConfigMapIdentityAndGrants(t *testing.T) {
	f := setupApplicationResourcesWithConfigFiles(t, "Deployment", true)
	var config resource.Object
	for _, item := range f.resources(t, 200) {
		if item.Kind == "ConfigMap" {
			config = item
		}
	}
	if config.Ref.UID == "" || !strings.Contains(config.Manifest, "mode: ordinary-config") {
		t.Fatal("generated ConfigMap missing from application resources")
	}
	f.health(t, "healthy")
	diff := f.diff(t, 200)
	if diff.Before != diff.After || !strings.Contains(diff.After, "mode: ordinary-config") {
		t.Fatal("generated ConfigMap omitted from live diff")
	}
	path := "/api/v1/namespaces/demo/configmaps/" + config.Ref.Name
	f.api.mu.Lock()
	bm(f.api.objects[path]["metadata"])["uid"] = "replacement-config"
	f.api.mu.Unlock()
	f.resources(t, 409)
	f.diff(t, 409)
	f.api.mu.Lock()
	bm(f.api.objects[path]["metadata"])["uid"] = config.Ref.UID
	f.api.mu.Unlock()
	// Filtering a generated file must not read its content upstream.
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE resource_grants SET resources=ARRAY['apps/deployments','apps/replicasets','core/pods','core/secrets','core/services','networking.k8s.io/ingresses'] WHERE id=$1", f.grant); err != nil {
		t.Fatal(err)
	}
	var configReads atomic.Int32
	f.api.mu.Lock()
	f.api.hook = func(r *http.Request) {
		if r.URL.Path == path {
			configReads.Add(1)
		}
	}
	f.api.mu.Unlock()
	for _, item := range f.resources(t, 200) {
		if item.Kind == "ConfigMap" || strings.Contains(item.Manifest, "mode: ordinary-config") {
			t.Fatal("filtered ConfigMap content leaked")
		}
	}
	if configReads.Load() != 0 || f.api.writes.Load() != 0 {
		t.Fatal("resource read crossed grant or read-only boundary")
	}
}

func TestApplicationResourcesMissingReplacementAndUnavailable(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	f.resources(t, 200)
	f.health(t, "healthy")
	f.api.mu.Lock()
	saved := f.api.objects[f.workload]
	delete(f.api.objects, f.workload)
	f.api.mu.Unlock()
	f.resources(t, 200)
	f.health(t, "degraded")
	d := f.diff(t, 200)
	if strings.Contains(d.After, `"kind": "Deployment"`) || !strings.Contains(d.Before, `"kind": "Deployment"`) {
		t.Fatal("missing object hidden in live diff")
	}
	f.api.mu.Lock()
	f.api.objects[f.workload] = saved
	bm(saved["metadata"])["uid"] = "replacement"
	f.api.mu.Unlock()
	f.resources(t, 409)
	f.diff(t, 409)
	f.health(t, "unknown")
	f.api.mu.Lock()
	bm(saved["metadata"])["uid"] = "Deployment-fixture"
	f.api.mu.Unlock()
	f.resources(t, 200)
	f.health(t, "healthy")
	f.api.fail.Store(503)
	f.resources(t, 503)
	f.diff(t, 503)
	f.health(t, "unknown")
	f.api.fail.Store(0)
	if _, err := f.c.f.pool.Exec(context.Background(), "DELETE FROM deployment_resources WHERE deployment_id=$1 AND kind='Secret'", f.plan.DeploymentID); err != nil {
		t.Fatal(err)
	}
	f.diff(t, 409)
}

func TestApplicationResourcesIntersectGrantsAndRejectConcurrentChanges(t *testing.T) {
	for _, change := range []string{"grants", "project", "credential", "binding"} {
		t.Run(change, func(t *testing.T) {
			f := setupApplicationResources(t, "Deployment")
			var once atomic.Bool
			f.api.mu.Lock()
			f.api.hook = func(r *http.Request) {
				if r.URL.Path != f.workload || !once.CompareAndSwap(false, true) {
					return
				}
				var err error
				switch change {
				case "grants":
					_, err = f.c.f.pool.Exec(context.Background(), "DELETE FROM resource_grants WHERE id=$1", f.grant)
				case "project":
					_, err = f.c.f.pool.Exec(context.Background(), "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", f.c.projectID, f.c.dev.ID)
				case "credential":
					f.c.f.call("PUT", "/api/credentials/"+f.credential, f.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"apiServer": f.api.server.URL, "token": "rotated-during-read", "insecureSkipTLSVerify": true}}, 200)
				case "binding":
					_, err = f.c.f.pool.Exec(context.Background(), "UPDATE app_environment_bindings SET version=version+1 WHERE id=$1", f.binding)
				}
				if err != nil {
					t.Error(err)
				}
			}
			f.api.mu.Unlock()
			want := 409
			if change == "grants" || change == "project" {
				want = 404
			}
			f.resources(t, want)
		})
	}
	t.Run("per-resource", func(t *testing.T) {
		f := setupApplicationResources(t, "Deployment")
		f.c.f.call("DELETE", "/api/clusters/"+f.c.clusterID+"/resource-grants/"+f.grant, f.c.admin, nil, 204)
		f.c.f.call("POST", "/api/clusters/"+f.c.clusterID+"/resource-grants", f.c.admin, map[string]any{"principalType": "project", "principalId": f.c.projectID, "namespace": "demo", "resources": []string{"apps/deployments"}, "actions": []string{"resource.view"}}, 201)
		items := f.resources(t, 200)
		if len(items) != 1 || items[0].Kind != "Deployment" {
			t.Fatal("did not intersect per-resource grant", items)
		}
		reads := f.api.reads.Load()
		f.diff(t, 404)
		if reads != f.api.reads.Load() {
			t.Fatal("strict diff contacted cluster without all resource grants")
		}
	})
}

func TestApplicationHealthJobCompletionAndInvalidation(t *testing.T) {
	f := setupApplicationResources(t, "Job")
	f.resources(t, 200)
	f.health(t, "completed")
	f.api.mu.Lock()
	bm(bm(f.api.objects["/api/v1/namespaces/demo/pods/demo-pod"]["spec"])["containers"].([]any)[0])["image"] = "foreign:latest"
	f.api.mu.Unlock()
	f.resources(t, 200)
	f.health(t, "unknown")
	f.api.mu.Lock()
	f.api.objects[f.workload]["status"] = map[string]any{"conditions": []any{map[string]any{"type": "Failed", "status": "True"}}}
	f.api.mu.Unlock()
	f.resources(t, 200)
	f.health(t, "degraded")
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET revision=revision+1 WHERE id=$1", f.plan.DeploymentID); err != nil {
		t.Fatal(err)
	}
	f.health(t, "unknown")
	f.resources(t, 200)
	f.health(t, "degraded")
	f.c.f.call("PUT", "/api/credentials/"+f.credential, f.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"apiServer": f.api.server.URL, "token": "rotated", "insecureSkipTLSVerify": true}}, 200)
	f.health(t, "unknown")
}

func TestApplicationSetupDeploymentCandidatesAreLocalAndGated(t *testing.T) {
	f := setupRelease(t, "Deployment")
	setup := func() application.Setup {
		return decode[application.Setup](t, f.c.f.call("GET", "/api/apps/"+f.app+"/setup", f.c.developer, nil, 200))
	}
	if len(setup().DeployableBindingIDs) != 0 {
		t.Fatal("disabled executor offered deployment")
	}
	f.apps.UseReleases(releaseReady{})
	if ids := setup().DeployableBindingIDs; len(ids) != 1 || ids[0] != f.binding {
		t.Fatal("eligible local binding missing", ids)
	}
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE builds SET status='failed' WHERE artifact_id=$1", f.artifact); err != nil {
		t.Fatal(err)
	}
	if len(setup().DeployableBindingIDs) != 0 {
		t.Fatal("unverified artifact offered deployment")
	}
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE builds SET status='succeeded' WHERE artifact_id=$1", f.artifact); err != nil {
		t.Fatal(err)
	}
	f.c.f.call("DELETE", "/api/clusters/"+f.c.clusterID+"/resource-grants/"+f.grant, f.c.admin, nil, 204)
	if len(setup().DeployableBindingIDs) != 0 {
		t.Fatal("revoked target still deployable")
	}
}

func TestApplicationResourcesIncludeFailedAndInflightExecutions(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	for _, status := range []string{"failed", "submitting", "observing", "unknown"} {
		if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET status=$2,revision=revision+1 WHERE id=$1", f.plan.DeploymentID, status); err != nil {
			t.Fatal(err)
		}
		if items := f.resources(t, 200); len(items) != 6 {
			t.Fatal("hid known resources of execution", status)
		}
	}
	f.health(t, "unknown")
}

func TestApplicationHealthIncludesEveryBinding(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	f.resources(t, 200)
	f.health(t, "healthy")
	environment := decode[platform.Environment](t, f.c.f.call("POST", "/api/environments", f.c.admin, map[string]any{"name": "Second environment", "production": false}, 201))
	var target string
	if err := f.c.f.pool.QueryRow(context.Background(), "INSERT INTO deployment_targets(cluster_id,namespace,release_name) VALUES($1,'demo','second-release') RETURNING id", f.c.clusterID).Scan(&target); err != nil {
		t.Fatal(err)
	}
	if _, err := f.c.f.pool.Exec(context.Background(), "INSERT INTO app_environment_bindings(app_id,environment_id,target_id) VALUES($1,$2,$3)", f.app, environment.ID, target); err != nil {
		t.Fatal(err)
	}
	f.health(t, "unknown")
}
