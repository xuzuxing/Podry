package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/audit"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
	"github.com/xuzuxing/podry/internal/resource"
	"github.com/xuzuxing/podry/internal/server"
)

type resourceWriteAPI struct {
	server                 *httptest.Server
	mu                     sync.Mutex
	objects                map[string]map[string]any
	writes, reads, dryRuns int
	failName               string
	drop                   bool
	hook                   func(*http.Request)
	hpas                   []any
	hpaError               bool
	hpaPages               map[string][]any
	hpaNext                map[string]string
	holdDelete             bool
}

func cloneObject(m map[string]any) map[string]any {
	raw, _ := json.Marshal(m)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return out
}
func newResourceWriteAPI(t *testing.T) *resourceWriteAPI {
	api := &resourceWriteAPI{objects: map[string]map[string]any{}, hpas: []any{}}
	api.server = httptest.NewTLSServer(http.HandlerFunc(api.serve))
	t.Cleanup(api.server.Close)
	return api
}
func (api *resourceWriteAPI) serve(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer resource-write-token" {
		http.Error(w, "private authentication message", 401)
		return
	}
	api.mu.Lock()
	hook := api.hook
	api.mu.Unlock()
	if hook != nil {
		hook(r)
	}
	reply := func(code int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(v)
	}
	if r.Method == "GET" && (r.URL.Path == "/api/v1" || r.URL.Path == "/apis/example.test/v1" || r.URL.Path == "/apis/apps/v1") {
		resources := []any{map[string]any{"name": "configmaps", "kind": "ConfigMap", "namespaced": true, "verbs": []string{"get", "create", "update", "delete"}}, map[string]any{"name": "secrets", "kind": "Secret", "namespaced": true, "verbs": []string{"get", "create", "update"}}, map[string]any{"name": "nodes", "kind": "Node", "namespaced": false, "verbs": []string{"get", "create", "update"}}}
		version := "v1"
		if r.URL.Path == "/apis/example.test/v1" {
			version = "example.test/v1"
			resources = []any{map[string]any{"name": "widgets", "kind": "Widget", "namespaced": true, "verbs": []string{"get", "create", "update"}}}
		}
		if r.URL.Path == "/apis/apps/v1" {
			version = "apps/v1"
			resources = []any{map[string]any{"name": "deployments", "kind": "Deployment", "namespaced": true, "verbs": []string{"get", "update", "delete"}}}
		}
		reply(200, map[string]any{"groupVersion": version, "resources": resources})
		return
	}
	if r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/horizontalpodautoscalers") {
		api.mu.Lock()
		hpas := append([]any{}, api.hpas...)
		bad := api.hpaError
		next := ""
		if api.hpaPages != nil {
			token := r.URL.Query().Get("continue")
			hpas = api.hpaPages[token]
			next = api.hpaNext[token]
		}
		api.mu.Unlock()
		if bad {
			http.Error(w, "private HPA forbidden", 403)
			return
		}
		reply(200, map[string]any{"apiVersion": "autoscaling/v2", "kind": "HorizontalPodAutoscalerList", "metadata": map[string]any{"continue": next}, "items": hpas})
		return
	}
	if r.Method == "GET" {
		api.mu.Lock()
		api.reads++
		obj := cloneObject(api.objects[r.URL.Path])
		api.mu.Unlock()
		if obj == nil {
			http.Error(w, "private missing object", 404)
			return
		}
		reply(200, obj)
		return
	}
	var in map[string]any
	if json.NewDecoder(r.Body).Decode(&in) != nil {
		http.Error(w, "private invalid body", 400)
		return
	}
	if r.Method == "DELETE" {
		api.mu.Lock()
		defer api.mu.Unlock()
		api.writes++
		current := api.objects[r.URL.Path]
		if current == nil {
			http.Error(w, "private gone", 404)
			return
		}
		pre, _ := in["preconditions"].(map[string]any)
		meta := current["metadata"].(map[string]any)
		if pre["uid"] != meta["uid"] || pre["resourceVersion"] != meta["resourceVersion"] {
			http.Error(w, "private conditional delete failed", 409)
			return
		}
		if in["kind"] != "DeleteOptions" || in["propagationPolicy"] == nil {
			http.Error(w, "invalid delete options", 422)
			return
		}
		if api.holdDelete {
			meta["deletionTimestamp"] = "2026-11-21T00:00:00Z"
		} else {
			delete(api.objects, r.URL.Path)
		}
		if api.drop {
			conn, _, err := w.(http.Hijacker).Hijack()
			if err == nil {
				_ = conn.Close()
			}
			return
		}
		reply(202, map[string]any{"apiVersion": "v1", "kind": "Status", "status": "Success"})
		return
	}
	meta, _ := in["metadata"].(map[string]any)
	name, _ := meta["name"].(string)
	path := r.URL.Path
	if r.Method == "POST" {
		path += "/" + name
	} else if r.Method != "PUT" {
		http.Error(w, "invalid method", 405)
		return
	}
	dry := r.URL.Query().Get("dryRun") == "All"
	if r.URL.Query().Get("fieldValidation") != "Strict" {
		http.Error(w, "fieldValidation required", 400)
		return
	}
	api.mu.Lock()
	defer api.mu.Unlock()
	if dry {
		api.dryRuns++
	} else {
		api.writes++
	}
	current := api.objects[path]
	if r.Method == "POST" && current != nil {
		http.Error(w, "private existing", 409)
		return
	}
	if r.Method == "PUT" {
		if current == nil {
			http.Error(w, "private gone", 404)
			return
		}
		before := current["metadata"].(map[string]any)
		if meta["uid"] != before["uid"] || meta["resourceVersion"] != before["resourceVersion"] {
			http.Error(w, "private CAS conflict", 409)
			return
		}
	}
	if !dry && name == api.failName {
		http.Error(w, "private-secret-admission-error", 422)
		return
	}
	if r.Method == "POST" {
		meta["uid"] = uuid.NewString()
	}
	meta["resourceVersion"] = fmt.Sprintf("%d", api.writes+100)
	if in["kind"] == "Secret" {
		if text, ok := in["stringData"].(map[string]any); ok {
			in["data"] = text
			delete(in, "stringData")
		}
	}
	if !dry {
		api.objects[path] = cloneObject(in)
	}
	if !dry && api.drop {
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			_ = conn.Close()
		}
		return
	}
	reply(201, in)
}

type resourceWriteFixture struct {
	f                       *fixture
	api                     *resourceWriteAPI
	service                 *resource.Service
	admin, developer, devID string
	cluster                 platform.Cluster
	credential              platform.Credential
	grant                   platform.Grant
}

func resourceWriteSetup(t *testing.T) *resourceWriteFixture {
	t.Helper()
	f := setup(t)
	api := newResourceWriteAPI(t)
	vault, err := credential.New(testCredentialKey)
	if err != nil {
		t.Fatal(err)
	}
	svc := resource.New(f.pool, vault, testJWT)
	svc.WritesEnabled = true
	f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: f.auth, Project: project.New(f.pool), Platform: platform.New(f.pool, vault), Resource: svc, Audit: audit.New(f.pool)})
	admin := f.account("admin@resource-write.test", true)
	dev := f.account("dev@resource-write.test", false)
	out := &resourceWriteFixture{f: f, api: api, service: svc, admin: f.login(admin.Email), developer: f.login(dev.Email), devID: dev.ID}
	out.credential = decode[platform.Credential](t, f.call("POST", "/api/credentials", out.admin, map[string]any{"name": "Write fixture", "kind": "kubeconfig", "payload": out.payload()}, 201))
	out.cluster = decode[platform.Cluster](t, f.call("POST", "/api/clusters", out.admin, map[string]any{"name": "Write fixture", "apiServer": api.server.URL, "credentialId": out.credential.ID}, 201))
	out.grant = decode[platform.Grant](t, f.call("POST", out.path("/resource-grants"), out.admin, map[string]any{"principalType": "user", "principalId": dev.ID, "namespace": "demo", "resources": []string{"core/configmaps", "core/secrets", "example.test/widgets"}, "actions": []string{"resource.view", "resource.write"}}, 201))
	return out
}
func (f *resourceWriteFixture) payload() map[string]any {
	return map[string]any{"apiServer": f.api.server.URL, "token": "resource-write-token", "insecureSkipTLSVerify": true}
}
func (f *resourceWriteFixture) path(suffix string) string {
	return "/api/clusters/" + f.cluster.ID + suffix
}
func writeDoc(name string) resource.ManifestDocument {
	return resource.ManifestDocument{Manifest: "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: " + name + "\n  namespace: demo\ndata:\n  value: private-document-content\n"}
}
func (f *resourceWriteFixture) preview(t *testing.T, docs ...resource.ManifestDocument) resource.Preview {
	t.Helper()
	return decode[resource.Preview](t, f.f.call("POST", f.path("/resources/dry-run"), f.developer, resource.DryRunInput{Documents: docs}, 200))
}
func (f *resourceWriteFixture) apply(t *testing.T, p resource.Preview, key string, stop bool) resource.Operation {
	t.Helper()
	return decode[resource.Operation](t, f.f.keyed("POST", f.path("/resources/apply"), f.developer, key, resource.ApplyInput{PreviewID: p.PreviewID, StopOnError: stop}, 202))
}
func (f *resourceWriteFixture) operation(t *testing.T, id string) resource.Operation {
	t.Helper()
	return decode[resource.Operation](t, f.f.call("GET", "/api/resource-operations/"+id, f.developer, nil, 200))
}
func (f *resourceWriteFixture) step(t *testing.T) {
	t.Helper()
	ok, err := f.service.ProcessResourceOperation(context.Background())
	if err != nil || !ok {
		t.Fatal("resource step", ok, err)
	}
}
func (f *resourceWriteFixture) ready(t *testing.T, id string) {
	t.Helper()
	if _, err := f.f.pool.Exec(context.Background(), "UPDATE resource_operations SET retry_at=now(),revision=revision+1 WHERE id=$1", id); err != nil {
		t.Fatal(err)
	}
}

func TestResourceWritePreviewApplyAndSensitiveStorage(t *testing.T) {
	f := resourceWriteSetup(t)
	secret := resource.ManifestDocument{Manifest: "apiVersion: v1\nkind: Secret\nmetadata:\n  name: private-secret\n  namespace: demo\n  annotations:\n    private-note: private-annotation-content\nstringData:\n  PASSWORD: private-secret-content\n"}
	widget := resource.ManifestDocument{Manifest: strings.ReplaceAll(strings.ReplaceAll(writeDoc("custom").Manifest, "apiVersion: v1", "apiVersion: example.test/v1"), "kind: ConfigMap", "kind: Widget")}
	p := f.preview(t, writeDoc("first"), secret, widget)
	for _, item := range p.Items {
		if !item.Valid || item.Action != "create" {
			t.Fatal(p)
		}
	}
	if f.api.writes != 0 || f.api.dryRuns != 3 {
		t.Fatal("preview persisted cluster objects")
	}
	var encrypted []byte
	var redacted string
	if err := f.f.pool.QueryRow(context.Background(), "SELECT encrypted_documents,items_redacted::text FROM resource_previews WHERE id=$1", p.PreviewID).Scan(&encrypted, &redacted); err != nil {
		t.Fatal(err)
	}
	for _, hidden := range []string{"private-document-content", "private-secret-content", "private-annotation-content"} {
		if bytes.Contains(encrypted, []byte(hidden)) || strings.Contains(redacted, hidden) {
			t.Fatal("plaintext preview storage")
		}
	}
	op := f.apply(t, p, "resource-apply-first", false)
	if op.Status != "queued" || len(op.Items) != 3 || op.Items[0].Status != "pending" {
		t.Fatal(op)
	}
	for range 3 {
		f.step(t)
	}
	got := f.operation(t, op.ID)
	originalUID := got.Items[0].Ref.UID
	if got.Status != "succeeded" || f.api.writes != 3 {
		t.Fatal(got, f.api.writes)
	}
	for _, item := range got.Items {
		if item.Status != "succeeded" || item.Ref.UID == "" || item.Ref.ResourceVersion == "" {
			t.Fatal(got)
		}
	}
	var audits string
	if err := f.f.pool.QueryRow(context.Background(), "SELECT coalesce(jsonb_agg(target)::text,'') FROM audit_events").Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(audits, "private-document-content") || strings.Contains(audits, "private-secret-content") {
		t.Fatal("plaintext audit")
	}
	var missingCluster int
	if err := f.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_events WHERE action LIKE 'resource.%' AND cluster_id IS DISTINCT FROM $1", f.cluster.ID).Scan(&missingCluster); err != nil || missingCluster != 0 {
		t.Fatal("resource audit lost its cluster scope", missingCluster, err)
	}
	// A full replacement uses the exact captured identity, including for ConfigMaps.
	f.api.mu.Lock()
	current := cloneObject(f.api.objects["/api/v1/namespaces/demo/configmaps/first"])
	f.api.mu.Unlock()
	current["data"] = map[string]any{"value": "updated-private-value"}
	raw, _ := json.Marshal(current)
	update := f.preview(t, resource.ManifestDocument{Manifest: string(raw)})
	if !update.Items[0].Valid || update.Items[0].Action != "update" {
		t.Fatal(update)
	}
	changed := f.apply(t, update, "resource-update-first", false)
	f.step(t)
	if got = f.operation(t, changed.ID); got.Status != "succeeded" || got.Items[0].Ref.UID != originalUID {
		t.Fatal(got)
	}
	if _, err := f.f.pool.Exec(context.Background(), "UPDATE resource_previews SET key_id='changed' WHERE id=$1", p.PreviewID); err == nil {
		t.Fatal("mutable preview")
	}
	if _, err := f.f.pool.Exec(context.Background(), "UPDATE resource_operations SET key_id='changed',revision=revision+1 WHERE id=$1", op.ID); err == nil {
		t.Fatal("mutable operation input")
	}
	downgradeHealthSchedule(t, f.f.dsn)
	if err := database.Migrate(f.f.dsn, true); err != nil {
		t.Fatal("v16 to v15 without auto deployment state", err)
	}
	if err := database.Migrate(f.f.dsn, true); err != nil {
		t.Fatal("v15 to v14 without webhook state", err)
	}
	if err := database.Migrate(f.f.dsn, true); err != nil {
		t.Fatal("v14 to v13 without drift history", err)
	}
	if err := database.Migrate(f.f.dsn, true); err != nil {
		t.Fatal("v13 to v12 apply-only history", err)
	}
	if err := database.Migrate(f.f.dsn, true); err == nil {
		t.Fatal("downgrade lost resource history")
	}
}

func TestResourceWritePartialAndStopOnError(t *testing.T) {
	for _, stop := range []bool{false, true} {
		t.Run(fmt.Sprint(stop), func(t *testing.T) {
			f := resourceWriteSetup(t)
			p := f.preview(t, writeDoc("first"), writeDoc("rejected"), writeDoc("last"))
			op := f.apply(t, p, "partial-resource-key", stop)
			f.api.failName = "rejected"
			f.step(t)
			f.step(t)
			if !stop {
				f.step(t)
			}
			got := f.operation(t, op.ID)
			if got.Status != "partial" || got.Items[0].Status != "succeeded" || got.Items[1].Status != "failed" || strings.Contains(got.Items[1].Error.Message, "private-secret") {
				t.Fatal(got)
			}
			want := "succeeded"
			if stop {
				want = "skipped"
			}
			if got.Items[2].Status != want {
				t.Fatal(got)
			}
		})
	}
}

func TestResourceWriteLostResponseRecoveryNeverResubmits(t *testing.T) {
	f := resourceWriteSetup(t)
	p := f.preview(t, writeDoc("response-lost"))
	op := f.apply(t, p, "response-lost-key", false)
	f.api.drop = true
	f.step(t)
	if got := f.operation(t, op.ID); got.Status != "unknown" || f.api.writes != 1 {
		t.Fatal(got)
	}
	vault, _ := credential.New(testCredentialKey)
	f.service = resource.New(f.f.pool, vault, testJWT)
	f.service.WritesEnabled = true
	f.ready(t, op.ID)
	f.step(t)
	if got := f.operation(t, op.ID); got.Status != "succeeded" || f.api.writes != 1 {
		t.Fatal(got, f.api.writes)
	}
}

func TestResourceWriteIntentWithoutEvidenceRemainsUnknown(t *testing.T) {
	f := resourceWriteSetup(t)
	p := f.preview(t, writeDoc("no-evidence"), writeDoc("later"))
	op := f.apply(t, p, "intent-without-evidence", false)
	items := op.Items
	items[0].Status = "running"
	raw, _ := json.Marshal(items)
	if _, err := f.f.pool.Exec(context.Background(), "UPDATE resource_operations SET status='running',result_redacted=$2,lease_owner='old-worker',lease_expires_at=now()-interval '1 second',revision=revision+1 WHERE id=$1", op.ID, raw); err != nil {
		t.Fatal(err)
	}
	f.step(t)
	got := f.operation(t, op.ID)
	if got.Status != "unknown" || got.Items[1].Status != "skipped" || f.api.writes != 0 {
		t.Fatal(got)
	}
	// A same-name object without the signed execution identity is never success.
	f.api.mu.Lock()
	f.api.objects["/api/v1/namespaces/demo/configmaps/no-evidence"] = map[string]any{"apiVersion": "v1", "kind": "ConfigMap", "metadata": map[string]any{"name": "no-evidence", "namespace": "demo", "uid": "replacement", "resourceVersion": "1"}, "data": map[string]any{"value": "private-document-content"}}
	f.api.mu.Unlock()
	f.ready(t, op.ID)
	f.step(t)
	if got = f.operation(t, op.ID); got.Status != "unknown" || f.api.writes != 0 {
		t.Fatal(got)
	}
}

func resourceRequest(f *resourceWriteFixture, p resource.Preview, key string) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(resource.ApplyInput{PreviewID: p.PreviewID})
	r := httptest.NewRequest("POST", f.path("/resources/apply"), bytes.NewReader(raw))
	r.Header.Set("Authorization", "Bearer "+f.developer)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Idempotency-Key", key)
	w := httptest.NewRecorder()
	f.f.handler.ServeHTTP(w, r)
	return w
}
func TestResourceWriteConcurrentIdempotencyAndOwnerPermissions(t *testing.T) {
	f := resourceWriteSetup(t)
	var p resource.Preview
	var first resource.Operation
	var key string
	for attempt := range 4 {
		p = f.preview(t, writeDoc(fmt.Sprintf("concurrent-%d", attempt)))
		key = fmt.Sprintf("concurrent-resource-key-%d", attempt)
		results := make(chan *httptest.ResponseRecorder, 2)
		var wg sync.WaitGroup
		for range 2 {
			wg.Go(func() { results <- resourceRequest(f, p, key) })
		}
		wg.Wait()
		close(results)
		first = resource.Operation{}
		for r := range results {
			if r.Code != 202 {
				t.Fatal(r.Code, r.Body.String())
			}
			got := decode[resource.Operation](t, r.Body.Bytes())
			if first.ID != "" && !reflect.DeepEqual(first, got) {
				t.Fatal("different replay")
			}
			first = got
		}
	}
	f.f.keyed("POST", f.path("/resources/apply"), f.developer, key, resource.ApplyInput{PreviewID: p.PreviewID, StopOnError: true}, 409)
	f.f.keyed("POST", f.path("/resources/apply"), f.developer, "another-resource-key", resource.ApplyInput{PreviewID: p.PreviewID}, 409)
	f.f.call("GET", "/api/resource-operations/"+first.ID, f.admin, nil, 404)
	for range 4 {
		f.step(t)
	}
	f.service.WritesEnabled = false
	reads := f.api.reads
	replay := resourceRequest(f, p, key)
	if replay.Code != 202 || f.api.reads != reads {
		t.Fatal(replay.Code, replay.Body.String())
	}
	f.f.call("DELETE", f.path("/resource-grants/"+f.grant.ID), f.admin, nil, 204)
	f.f.call("GET", "/api/resource-operations/"+first.ID, f.developer, nil, 404)
	if r := resourceRequest(f, p, key); r.Code != 404 {
		t.Fatal(r.Code, r.Body.String())
	}
}

func TestResourceWriteValidationAndExecutionGate(t *testing.T) {
	f := resourceWriteSetup(t)
	f.f.call("POST", f.path("/resources/dry-run"), f.developer, resource.DryRunInput{}, 422)
	f.f.call("POST", f.path("/resources/dry-run?force=true"), f.developer, resource.DryRunInput{Documents: []resource.ManifestDocument{writeDoc("x")}}, 422)
	invalid := []resource.ManifestDocument{
		{Manifest: writeDoc("x").Manifest + "---\n" + writeDoc("y").Manifest},
		{Manifest: strings.Replace(writeDoc("x").Manifest, "namespace: demo", "namespace: other", 1)},
		{Manifest: strings.Replace(writeDoc("x").Manifest, "  namespace: demo\n", "", 1)},
		{Manifest: "apiVersion: v1\nkind: Node\nmetadata:\n  name: node-one\n"},
	}
	p := f.preview(t, invalid...)
	for _, item := range p.Items {
		if item.Valid || item.Error == nil {
			t.Fatal(p)
		}
	}
	if f.api.reads != 0 || f.api.dryRuns != 0 {
		t.Fatal("unauthorized object access", f.api.reads, f.api.dryRuns)
	}
	f.f.keyed("POST", f.path("/resources/apply"), f.developer, "invalid-preview-key", resource.ApplyInput{PreviewID: p.PreviewID}, 422)
	duplicate := f.preview(t, writeDoc("duplicate"), writeDoc("duplicate"))
	if !duplicate.Items[0].Valid || duplicate.Items[1].Valid {
		t.Fatal(duplicate)
	}
	p = f.preview(t, writeDoc("gated"))
	f.f.keyed("POST", f.path("/resources/apply"), f.developer, "", resource.ApplyInput{PreviewID: p.PreviewID}, 422)
	f.service.WritesEnabled = false
	assertCode(t, f.f.keyed("POST", f.path("/resources/apply"), f.developer, "disabled-resource-key", resource.ApplyInput{PreviewID: p.PreviewID}, 503), "resource_execution_unavailable")
	var consumed bool
	if err := f.f.pool.QueryRow(context.Background(), "SELECT consumed_at IS NOT NULL FROM resource_previews WHERE id=$1", p.PreviewID).Scan(&consumed); err != nil || consumed {
		t.Fatal("disabled worker consumed preview", err)
	}
	f.service.WritesEnabled = true
	op := f.apply(t, p, "disabled-resource-key", false)
	f.step(t)
	if got := f.operation(t, op.ID); got.Status != "succeeded" {
		t.Fatal(got)
	}
}

func TestResourceWriteUpdateCASAndCreateRaces(t *testing.T) {
	f := resourceWriteSetup(t)
	path := "/api/v1/namespaces/demo/configmaps/existing"
	f.api.objects[path] = map[string]any{"apiVersion": "v1", "kind": "ConfigMap", "metadata": map[string]any{"name": "existing", "namespace": "demo", "uid": "original", "resourceVersion": "10"}, "data": map[string]any{"value": "old"}}
	for _, doc := range []resource.ManifestDocument{writeDoc("existing"), {Manifest: writeDoc("existing").Manifest, ExpectedUID: "replacement", ExpectedResourceVersion: "10"}, {Manifest: writeDoc("existing").Manifest, ExpectedUID: "original", ExpectedResourceVersion: "9"}} {
		if p := f.preview(t, doc); p.Items[0].Valid {
			t.Fatal("accepted missing/stale CAS", p)
		}
	}
	p := f.preview(t, resource.ManifestDocument{Manifest: writeDoc("existing").Manifest, ExpectedUID: "original", ExpectedResourceVersion: "10"})
	f.api.mu.Lock()
	f.api.objects[path]["metadata"].(map[string]any)["resourceVersion"] = "11"
	f.api.mu.Unlock()
	assertCode(t, f.f.keyed("POST", f.path("/resources/apply"), f.developer, "stale-update-key", resource.ApplyInput{PreviewID: p.PreviewID}, 409), "resource_version_changed")
	f.api.mu.Lock()
	f.api.objects[path]["metadata"].(map[string]any)["resourceVersion"] = "10"
	f.api.mu.Unlock()
	op := f.apply(t, p, "stale-update-key", false)
	// Change after the worker's preflight GET. The frozen PUT must still fail.
	f.api.hook = func(r *http.Request) {
		if r.Method == "PUT" && r.URL.Query().Get("dryRun") == "" {
			f.api.mu.Lock()
			f.api.objects[path]["metadata"].(map[string]any)["resourceVersion"] = "11"
			f.api.mu.Unlock()
		}
	}
	f.step(t)
	if got := f.operation(t, op.ID); got.Status != "failed" || got.Items[0].Error.Code != "resource_version_changed" {
		t.Fatal(got)
	}
	f.api.hook = nil
	p = f.preview(t, writeDoc("appears"))
	op = f.apply(t, p, "create-race-key", false)
	f.api.hook = func(r *http.Request) {
		if r.Method == "POST" && r.URL.Query().Get("dryRun") == "" {
			f.api.mu.Lock()
			f.api.objects["/api/v1/namespaces/demo/configmaps/appears"] = map[string]any{"metadata": map[string]any{"uid": "someone-else"}}
			f.api.mu.Unlock()
		}
	}
	f.step(t)
	if got := f.operation(t, op.ID); got.Status != "failed" || got.Items[0].Error.Code != "resource_version_changed" {
		t.Fatal(got)
	}
	if f.api.writes != 2 || f.api.objects[path]["data"].(map[string]any)["value"] != "old" {
		t.Fatal("CAS overwrote current objects")
	}
}

func TestResourceWriteAuthorizationAndCredentialChanges(t *testing.T) {
	for _, phase := range []string{"preview-revoke", "enqueue-rotate", "worker-revoke", "worker-rotate"} {
		t.Run(phase, func(t *testing.T) {
			f := resourceWriteSetup(t)
			mutate := func() {
				if strings.HasSuffix(phase, "revoke") {
					f.f.call("DELETE", f.path("/resource-grants/"+f.grant.ID), f.admin, nil, 204)
				} else {
					f.f.call("PUT", "/api/credentials/"+f.credential.ID, f.admin, map[string]any{"expectedVersion": 1, "payload": f.payload()}, 200)
				}
			}
			if phase == "preview-revoke" {
				var once sync.Once
				f.api.hook = func(r *http.Request) {
					if r.URL.Query().Get("dryRun") == "All" {
						once.Do(mutate)
					}
				}
				f.f.call("POST", f.path("/resources/dry-run"), f.developer, resource.DryRunInput{Documents: []resource.ManifestDocument{writeDoc("revoke")}}, 404)
				return
			}
			p := f.preview(t, writeDoc("first"), writeDoc("last"))
			if phase == "enqueue-rotate" {
				var once sync.Once
				f.api.hook = func(r *http.Request) { once.Do(mutate) }
				assertCode(t, f.f.keyed("POST", f.path("/resources/apply"), f.developer, "rotated-enqueue-key", resource.ApplyInput{PreviewID: p.PreviewID}, 409), "revision_conflict")
				return
			}
			op := f.apply(t, p, "worker-change-key", false)
			mutate()
			reads := f.api.reads
			f.step(t)
			row, err := sqlcdb.New(f.f.pool).GetResourceOperation(context.Background(), op.ID)
			if err != nil || row.Status != "failed" || f.api.writes != 0 || f.api.reads != reads {
				t.Fatal("changed permission/credential executed", row.Status, err)
			}
		})
	}
}

func TestResourceWriteLeaseFencesStaleWorkerAndObserves(t *testing.T) {
	f := resourceWriteSetup(t)
	p := f.preview(t, writeDoc("lease-race"), writeDoc("later"))
	op := f.apply(t, p, "lease-race-key", false)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	f.api.hook = func(r *http.Request) {
		if r.Method == "POST" && r.URL.Query().Get("dryRun") == "" {
			once.Do(func() { close(entered) })
			<-release
		}
	}
	done := make(chan error, 1)
	go func() { _, err := f.service.ProcessResourceOperation(context.Background()); done <- err }()
	<-entered
	if claimed, err := f.service.ProcessResourceOperation(context.Background()); claimed || err != nil {
		close(release)
		t.Fatal("second worker claimed a live lease", claimed, err)
	}
	if _, err := f.f.pool.Exec(context.Background(), "UPDATE resource_operations SET lease_expires_at=now()-interval '1 second',revision=revision+1 WHERE id=$1", op.ID); err != nil {
		close(release)
		t.Fatal(err)
	}
	f.step(t)
	close(release)
	if err := <-done; err == nil {
		t.Fatal("stale lease owner committed a result")
	}
	if got := f.operation(t, op.ID); got.Status != "unknown" || got.Items[1].Status != "skipped" {
		t.Fatal(got)
	}
	f.ready(t, op.ID)
	f.step(t)
	if got := f.operation(t, op.ID); got.Status != "partial" || got.Items[0].Status != "succeeded" || f.api.writes != 1 {
		t.Fatal(got, f.api.writes)
	}
}

func TestResourceWriteMigrationAndReplayWithoutEncryptionKey(t *testing.T) {
	f := resourceWriteSetup(t)
	ctx := context.Background()
	downgradeHealthSchedule(t, f.f.dsn)
	if err := database.Migrate(f.f.dsn, true); err != nil {
		t.Fatal("v16 to v15 without auto deployment state", err)
	}
	if err := database.Migrate(f.f.dsn, true); err != nil {
		t.Fatal("v15 to v14 without webhook state", err)
	}
	if err := database.Migrate(f.f.dsn, true); err != nil {
		t.Fatal("v14 to v13 without drift history", err)
	}
	if err := database.Migrate(f.f.dsn, true); err != nil {
		t.Fatal("empty v13 downgrade", err)
	}
	if err := database.Migrate(f.f.dsn, true); err != nil {
		t.Fatal("empty v12 downgrade", err)
	}
	if database.CheckSchema(ctx, f.f.pool) == nil {
		t.Fatal("accepted old schema")
	}
	if err := database.Migrate(f.f.dsn, false); err != nil {
		t.Fatal("v11 upgrade", err)
	}
	p := f.preview(t, writeDoc("key-independent-replay"))
	op := f.apply(t, p, "replay-without-key", false)
	var cipher []byte
	var safe string
	if err := f.f.pool.QueryRow(ctx, "SELECT encrypted_payload,payload_redacted::text||result_redacted::text FROM resource_operations WHERE id=$1", op.ID).Scan(&cipher, &safe); err != nil || bytes.Contains(cipher, []byte("private-document-content")) || strings.Contains(safe, "private-document-content") {
		t.Fatal("operation snapshot leaked plaintext", err)
	}
	if _, err := f.f.pool.Exec(ctx, "UPDATE resource_operations SET result_redacted='[]' WHERE id=$1", op.ID); err == nil {
		t.Fatal("unfenced operation update accepted")
	}
	vault, _ := credential.New("")
	service := resource.New(f.f.pool, vault, testJWT)
	f.f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: f.f.auth, Platform: platform.New(f.f.pool, vault), Resource: service})
	reads := f.api.reads
	if replay := resourceRequest(f, p, "replay-without-key"); replay.Code != 202 || f.api.reads != reads {
		t.Fatal("replay required keys/network", replay.Code, replay.Body.String())
	}
	if got := f.operation(t, op.ID); got.ID != op.ID {
		t.Fatal(got)
	}
}
