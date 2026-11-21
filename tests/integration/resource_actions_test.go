package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/resource"
	"github.com/xuzuxing/podry/internal/server"
)

func (f *resourceWriteFixture) seedAction(t *testing.T, kind, name string) resource.Ref {
	t.Helper()
	group, version, plural, apiVersion := "", "v1", "configmaps", "v1"
	if kind == "Deployment" {
		group, plural, apiVersion = "apps", "deployments", "apps/v1"
	}
	ref := resource.Ref{Group: group, Version: version, Resource: plural, Namespace: "demo", Name: name, UID: uuid.NewString(), ResourceVersion: "100"}
	raw := map[string]any{"apiVersion": apiVersion, "kind": kind, "metadata": map[string]any{"name": name, "namespace": "demo", "uid": ref.UID, "resourceVersion": ref.ResourceVersion}, "data": map[string]any{"value": "private-action-input"}}
	if kind == "Deployment" {
		delete(raw, "data")
		raw["spec"] = map[string]any{"replicas": float64(1), "selector": map[string]any{"matchLabels": map[string]any{"app": name}}, "template": map[string]any{"metadata": map[string]any{"labels": map[string]any{"app": name}}, "spec": map[string]any{"containers": []any{map[string]any{"name": "demo", "image": "example.test/demo@sha256:" + strings.Repeat("a", 64), "env": []any{map[string]any{"name": "PRIVATE_VALUE", "value": "private-action-input"}}}}}}}
	}
	f.api.mu.Lock()
	f.api.objects[actionPath(ref)] = raw
	f.api.mu.Unlock()
	return ref
}
func actionPath(r resource.Ref) string {
	if r.Group == "" {
		return "/api/" + r.Version + "/namespaces/" + r.Namespace + "/" + r.Resource + "/" + r.Name
	}
	return "/apis/" + r.Group + "/" + r.Version + "/namespaces/" + r.Namespace + "/" + r.Resource + "/" + r.Name
}
func actionSetup(t *testing.T) *resourceWriteFixture {
	f := resourceWriteSetup(t)
	f.f.call("POST", f.path("/resource-grants"), f.admin, map[string]any{"principalType": "user", "principalId": f.devID, "namespace": "demo", "resources": []string{"core/configmaps", "apps/deployments"}, "actions": []string{"resource.view", "resource.write", "resource.delete"}}, 201)
	return f
}
func (f *resourceWriteFixture) action(t *testing.T, key string, in resource.ActionInput) resource.Operation {
	t.Helper()
	return decode[resource.Operation](t, f.f.keyed("POST", f.path("/resource-actions"), f.developer, key, in, 202))
}
func actionRequest(f *resourceWriteFixture, token, key string, in any) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(in)
	req := httptest.NewRequest("POST", f.path("/resource-actions"), bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Idempotency-Key", key)
	w := httptest.NewRecorder()
	f.f.handler.ServeHTTP(w, req)
	return w
}

func TestResourceActionDeleteRestartScaleAndAudit(t *testing.T) {
	f := actionSetup(t)
	r := f.seedAction(t, "Deployment", "demo")
	op := f.action(t, "action-restart-key", resource.ActionInput{Action: "restart", Ref: &r})
	f.step(t)
	got := f.operation(t, op.ID)
	if got.Status != "succeeded" {
		t.Fatal(got)
	}
	f.api.mu.Lock()
	current := cloneObject(f.api.objects[actionPath(r)])
	f.api.mu.Unlock()
	ann := bm(bm(bm(bm(current["spec"])["template"])["metadata"])["annotations"])
	if ann["podry.io/restart-operation"] != op.ID || ann["kubectl.kubernetes.io/restartedAt"] == nil {
		t.Fatal("restart omitted template trigger", current)
	}
	r = *got.Items[0].Ref
	n := int32(0)
	scaled := f.action(t, "action-scale-zero", resource.ActionInput{Action: "scale", Ref: &r, Replicas: &n})
	f.step(t)
	got = f.operation(t, scaled.ID)
	if got.Status != "succeeded" {
		t.Fatal(got)
	}
	f.api.mu.Lock()
	current = cloneObject(f.api.objects[actionPath(r)])
	f.api.mu.Unlock()
	if bm(current["spec"])["replicas"] != float64(0) || bm(current["spec"])["selector"] == nil {
		t.Fatal("scale damaged deployment", current)
	}
	r = *got.Items[0].Ref
	deleted := f.action(t, "action-delete-key", resource.ActionInput{Action: "delete", Ref: &r, PropagationPolicy: "Foreground"})
	f.step(t)
	if got = f.operation(t, deleted.ID); got.Status != "succeeded" || got.Items[0].Ref.UID != r.UID || f.api.writes != 3 {
		t.Fatal(got, f.api.writes)
	}
	var audits string
	var count int
	if err := f.f.pool.QueryRow(context.Background(), "SELECT jsonb_agg(target)::text,count(*) FROM audit_events WHERE action IN ('resource.delete','resource.restart','resource.scale')").Scan(&audits, &count); err != nil || count != 3 || strings.Contains(audits, "private-action-input") {
		t.Fatal("unsafe or missing action audit", count, err)
	}
	var cipher []byte
	var redacted string
	if err := f.f.pool.QueryRow(context.Background(), "SELECT encrypted_payload,payload_redacted::text||result_redacted::text FROM resource_operations WHERE id=$1", op.ID).Scan(&cipher, &redacted); err != nil || bytes.Contains(cipher, []byte("private-action-input")) || strings.Contains(redacted, "private-action-input") {
		t.Fatal("plaintext action snapshot", err)
	}
}

func TestResourceActionValidationIdentityAndPermissions(t *testing.T) {
	f := resourceWriteSetup(t)
	r := f.seedAction(t, "ConfigMap", "guarded")
	// Existing view+write cannot delete, even before decryption/discovery.
	reads := f.api.reads
	f.f.keyed("POST", f.path("/resource-actions"), f.developer, "delete-without-permission", resource.ActionInput{Action: "delete", Ref: &r}, 404)
	if f.api.reads != reads {
		t.Fatal("unauthorized delete reached cluster")
	}
	f.f.call("DELETE", f.path("/resource-grants/"+f.grant.ID), f.admin, nil, 204)
	f.f.call("POST", f.path("/resource-grants"), f.admin, map[string]any{"principalType": "user", "principalId": f.devID, "namespace": "demo", "resources": []string{"core/configmaps"}, "actions": []string{"resource.view", "resource.delete"}}, 201)
	cases := []resource.ActionInput{{Action: "unknown", Ref: &r}, {Action: "restart", Ref: &r}, {Action: "delete"}, {Action: "delete", Ref: &r, Replicas: new(int32)}, {Action: "delete", Ref: &r, PropagationPolicy: "invalid"}}
	for _, in := range cases {
		f.f.keyed("POST", f.path("/resource-actions"), f.developer, "invalid-action-key", in, 422)
	}
	old := r
	old.UID = "previous-uid"
	f.f.keyed("POST", f.path("/resource-actions"), f.developer, "stale-action-uid", resource.ActionInput{Action: "delete", Ref: &old}, 409)
	old = r
	old.ResourceVersion = "previous-version"
	f.f.keyed("POST", f.path("/resource-actions"), f.developer, "stale-action-version", resource.ActionInput{Action: "delete", Ref: &old}, 409)
	old = r
	old.UID = ""
	f.f.keyed("POST", f.path("/resource-actions"), f.developer, "missing-action-uid", resource.ActionInput{Action: "delete", Ref: &old}, 422)
	op := f.action(t, "identity-before-worker", resource.ActionInput{Action: "delete", Ref: &r})
	f.api.mu.Lock()
	f.api.objects[actionPath(r)]["metadata"].(map[string]any)["uid"] = uuid.NewString()
	f.api.mu.Unlock()
	f.step(t)
	if got := f.operation(t, op.ID); got.Status != "failed" || f.api.writes != 0 {
		t.Fatal("worker touched replacement", got)
	}
	f.f.call("GET", "/api/resource-operations/"+op.ID, f.admin, nil, 404)
}

func TestResourceActionHPAAdmissionAndExecutionBoundaries(t *testing.T) {
	f := actionSetup(t)
	r := f.seedAction(t, "Deployment", "hpa-demo")
	n := int32(3)
	in := resource.ActionInput{Action: "scale", Ref: &r, Replicas: &n}
	negative := int32(-1)
	for _, invalid := range []resource.ActionInput{{Action: "scale", Ref: &r}, {Action: "scale", Ref: &r, Replicas: &negative}, {Action: "restart", Ref: &r, PropagationPolicy: "Foreground"}} {
		f.f.keyed("POST", f.path("/resource-actions"), f.developer, "invalid-deployment-action", invalid, 422)
	}
	hpa := map[string]any{"spec": map[string]any{"scaleTargetRef": map[string]any{"apiVersion": "apps/v1", "kind": "Deployment", "name": r.Name}}}
	f.api.hpas = []any{hpa}
	raw := f.f.keyed("POST", f.path("/resource-actions"), f.developer, "hpa-block-admission", in, 409)
	if !strings.Contains(string(raw), "resource_hpa_managed") || strings.Contains(string(raw), "private") {
		t.Fatal(string(raw))
	}
	f.api.hpas = []any{}
	f.api.hpaError = true
	raw = f.f.keyed("POST", f.path("/resource-actions"), f.developer, "hpa-failed-closed", in, 409)
	if !strings.Contains(string(raw), "resource_hpa_unconfirmed") {
		t.Fatal(string(raw))
	}
	f.api.hpaError = false
	// The matching HPA may be on a later page; loops are never treated as empty.
	f.api.hpaPages = map[string][]any{"": {}, "page-2": {hpa}}
	f.api.hpaNext = map[string]string{"": "page-2"}
	raw = f.f.keyed("POST", f.path("/resource-actions"), f.developer, "hpa-second-page", in, 409)
	if !strings.Contains(string(raw), "resource_hpa_managed") {
		t.Fatal(string(raw))
	}
	f.api.hpaPages = map[string][]any{"": {}, "loop": {}}
	f.api.hpaNext = map[string]string{"": "loop", "loop": "loop"}
	raw = f.f.keyed("POST", f.path("/resource-actions"), f.developer, "hpa-pagination-loop", in, 409)
	if !strings.Contains(string(raw), "resource_hpa_unconfirmed") {
		t.Fatal(string(raw))
	}
	f.api.hpaPages, f.api.hpaNext = nil, nil
	op := f.action(t, "hpa-after-admission", in)
	f.api.hpas = []any{hpa}
	f.step(t)
	if got := f.operation(t, op.ID); got.Status != "failed" || f.api.writes != 0 {
		t.Fatal(got)
	}
	// Restart does not change replicas and is allowed with an HPA.
	op = f.action(t, "hpa-restart-allowed", resource.ActionInput{Action: "restart", Ref: &r})
	f.step(t)
	if got := f.operation(t, op.ID); got.Status != "succeeded" {
		t.Fatal(got)
	}
}

func TestResourceActionRemoteVersionCAS(t *testing.T) {
	for _, action := range []string{"delete", "restart", "scale"} {
		t.Run(action, func(t *testing.T) {
			f := actionSetup(t)
			r := f.seedAction(t, "Deployment", "cas-demo")
			n := int32(2)
			in := resource.ActionInput{Action: action, Ref: &r}
			if action == "scale" {
				in.Replicas = &n
			}
			op := f.action(t, "remote-cas-action", in)
			f.api.hook = func(req *http.Request) {
				if req.Method == "PUT" || req.Method == "DELETE" {
					f.api.mu.Lock()
					f.api.objects[actionPath(r)]["metadata"].(map[string]any)["resourceVersion"] = "200"
					f.api.mu.Unlock()
				}
			}
			f.step(t)
			if got := f.operation(t, op.ID); got.Status != "failed" || got.Items[0].Error.Code != "resource_version_changed" || f.api.writes != 1 {
				t.Fatal(got, f.api.writes)
			}
		})
	}
}

func TestResourceActionLostResponseAndFinalizerRecovery(t *testing.T) {
	for _, action := range []string{"delete", "restart", "scale"} {
		t.Run(action, func(t *testing.T) {
			f := actionSetup(t)
			r := f.seedAction(t, "Deployment", "lost")
			n := int32(2)
			in := resource.ActionInput{Action: action, Ref: &r}
			if action == "scale" {
				in.Replicas = &n
			}
			op := f.action(t, "lost-action-response", in)
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
		})
	}
	t.Run("finalizer", func(t *testing.T) {
		f := actionSetup(t)
		r := f.seedAction(t, "ConfigMap", "terminating")
		f.api.holdDelete = true
		op := f.action(t, "delete-finalizer-key", resource.ActionInput{Action: "delete", Ref: &r})
		f.step(t)
		if got := f.operation(t, op.ID); got.Status != "unknown" {
			t.Fatal("reported finalizer as complete", got)
		}
		f.ready(t, op.ID)
		f.step(t)
		if got := f.operation(t, op.ID); got.Status != "unknown" || f.api.writes != 1 {
			t.Fatal(got)
		}
		f.api.mu.Lock()
		f.api.objects[actionPath(r)]["metadata"].(map[string]any)["uid"] = uuid.NewString()
		f.api.mu.Unlock()
		f.ready(t, op.ID)
		f.step(t)
		if got := f.operation(t, op.ID); got.Status != "succeeded" || f.api.writes != 1 {
			t.Fatal("old UID not resolved safely", got)
		}
	})
}

func TestResourceActionNoIntentEvidenceAndLeaseFencing(t *testing.T) {
	f := actionSetup(t)
	r := f.seedAction(t, "Deployment", "lease-demo")
	op := f.action(t, "action-lease-fence", resource.ActionInput{Action: "restart", Ref: &r})
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	f.api.hook = func(req *http.Request) {
		if req.Method == "PUT" {
			once.Do(func() { close(entered) })
			<-release
		}
	}
	done := make(chan error, 1)
	go func() { _, err := f.service.ProcessResourceOperation(context.Background()); done <- err }()
	<-entered
	if ok, err := f.service.ProcessResourceOperation(context.Background()); ok || err != nil {
		close(release)
		t.Fatal(ok, err)
	}
	if _, err := f.f.pool.Exec(context.Background(), "UPDATE resource_operations SET lease_expires_at=now()-interval '1 second',revision=revision+1 WHERE id=$1", op.ID); err != nil {
		close(release)
		t.Fatal(err)
	}
	f.step(t)
	if got := f.operation(t, op.ID); got.Status != "unknown" {
		close(release)
		t.Fatal(got)
	}
	close(release)
	if err := <-done; err == nil {
		t.Fatal("stale action worker committed")
	}
	f.ready(t, op.ID)
	f.step(t)
	if got := f.operation(t, op.ID); got.Status != "succeeded" || f.api.writes != 1 {
		t.Fatal(got)
	}
}

func TestResourceActionConcurrentReplayAndDefaultGate(t *testing.T) {
	f := actionSetup(t)
	r := f.seedAction(t, "ConfigMap", "replay")
	in := resource.ActionInput{Action: "delete", Ref: &r}
	f.service.WritesEnabled = false
	f.f.keyed("POST", f.path("/resource-actions"), f.developer, "disabled-action-key", in, 503)
	if ok, err := f.service.ProcessResourceOperation(context.Background()); ok || err != nil || f.api.writes != 0 {
		t.Fatal(ok, err)
	}
	f.service.WritesEnabled = true
	start := make(chan struct{})
	responses := make(chan *httptest.ResponseRecorder, 6)
	for range 6 {
		go func() { <-start; responses <- actionRequest(f, f.developer, "concurrent-action-key", in) }()
	}
	close(start)
	var id string
	for range 6 {
		w := <-responses
		if w.Code != 202 {
			t.Fatal(w.Code, w.Body.String())
		}
		var op resource.Operation
		_ = json.Unmarshal(w.Body.Bytes(), &op)
		if id != "" && id != op.ID {
			t.Fatal("duplicate actions")
		}
		id = op.ID
	}
	changed := in
	changed.PropagationPolicy = "Orphan"
	f.f.keyed("POST", f.path("/resource-actions"), f.developer, "concurrent-action-key", changed, 409)
	f.step(t)
	vault, _ := credential.New("")
	svc := resource.New(f.f.pool, vault, testJWT)
	f.f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: f.f.auth, Platform: platform.New(f.f.pool, vault), Resource: svc})
	reads := f.api.reads
	replay := f.action(t, "concurrent-action-key", in)
	if replay.ID != id || replay.Status != "queued" || f.api.reads != reads {
		t.Fatal("offline replay changed acceptance", replay)
	}
	if got := f.operation(t, id); got.Status != "succeeded" {
		t.Fatal(got)
	}
}

func TestResourceActionRevocationAndCredentialRotation(t *testing.T) {
	for _, change := range []string{"revoked", "rotated"} {
		t.Run(change, func(t *testing.T) {
			f := actionSetup(t)
			r := f.seedAction(t, "Deployment", change)
			in := resource.ActionInput{Action: "restart", Ref: &r}
			op := f.action(t, "change-before-action", in)
			if change == "revoked" {
				if _, err := f.f.pool.Exec(context.Background(), "DELETE FROM resource_grants WHERE cluster_id=$1 AND user_id=$2", f.cluster.ID, f.devID); err != nil {
					t.Fatal(err)
				}
			} else {
				f.f.keyed("PUT", "/api/credentials/"+f.credential.ID, f.admin, "action-rotate-key", map[string]any{"expectedVersion": 1, "payload": f.payload()}, 200)
			}
			f.step(t)
			var state string
			if err := f.f.pool.QueryRow(context.Background(), "SELECT status FROM resource_operations WHERE id=$1", op.ID).Scan(&state); err != nil || state != "failed" || f.api.writes != 0 {
				t.Fatal(state, err)
			}
			if change == "revoked" {
				f.f.keyed("POST", f.path("/resource-actions"), f.developer, "change-before-action", in, 404)
			}
		})
	}
}

func TestResourceActionMigrationAndReleaseMutualExclusion(t *testing.T) {
	// Reuse the actual release service on an isolated database to test both directions.
	rel := setupRelease(t, "Deployment")
	c := rel.c
	vault, _ := credential.New(testCredentialKey)
	api := newResourceWriteAPI(t)

	cred := decode[platform.Credential](t, c.f.call("POST", "/api/credentials", c.admin, map[string]any{"name": "Release/action fixture", "kind": "kubeconfig", "payload": map[string]any{"apiServer": api.server.URL, "token": "resource-write-token", "insecureSkipTLSVerify": true}}, 201))
	// Isolated fixture rewires the existing target's cluster before taking a preview.
	if _, err := c.f.pool.Exec(context.Background(), "UPDATE clusters SET api_server=$2,credential_id=$3 WHERE id=$1", c.clusterID, api.server.URL, cred.ID); err != nil {
		t.Fatal(err)
	}
	svc := resource.New(c.f.pool, vault, testJWT)
	svc.WritesEnabled = true
	rel.apps.UseReleases(releaseReady{})
	c.f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: c.f.auth, Platform: platform.New(c.f.pool, vault), Application: rel.apps, Resource: svc})
	f := &resourceWriteFixture{f: c.f, api: api, service: svc, admin: c.admin, developer: c.developer, cluster: platform.Cluster{ID: c.clusterID}}
	r := f.seedAction(t, "Deployment", "release-demo")
	p := rel.preview(t, 3)
	op := f.action(t, "action-blocks-release", resource.ActionInput{Action: "restart", Ref: &r})
	if raw := rel.confirm(t, p, "busy-action-release-key", 409); !strings.Contains(string(raw), "resource_action_busy") {
		t.Fatal(string(raw))
	}
	f.step(t)
	if got := f.operation(t, op.ID); got.Status != "succeeded" {
		t.Fatal(got)
	}
	p = rel.preview(t, 3)
	rel.confirm(t, p, "release-blocks-action", 202)
	current := f.operation(t, op.ID)
	r = *current.Items[0].Ref
	if raw := f.f.keyed("POST", f.path("/resource-actions"), f.developer, "busy-release-action-key", resource.ActionInput{Action: "restart", Ref: &r}, 409); !strings.Contains(string(raw), "resource_release_busy") {
		t.Fatal(string(raw))
	}
	downgradeHealthSchedule(t, c.f.dsn)
	if err := database.Migrate(c.f.dsn, true); err != nil {
		t.Fatal("v16 to v15 without auto deployment state", err)
	}
	if err := database.Migrate(c.f.dsn, true); err != nil {
		t.Fatal("v15 to v14 without webhook state", err)
	}
	if err := database.Migrate(c.f.dsn, true); err != nil {
		t.Fatal("v14 to v13 without drift history", err)
	}
	if err := database.Migrate(c.f.dsn, true); err == nil {
		t.Fatal("downgrade lost action history")
	}
}
