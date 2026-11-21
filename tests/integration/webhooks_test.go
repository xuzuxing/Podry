package integration_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/server"
)

const webhookTestSecret = "podry-fixture-signing-secret-0123456789"

type webhookFixture struct {
	*buildFixture
	pipeline, credential string
}

func setupWebhook(t *testing.T) *webhookFixture {
	t.Helper()
	b := setupBuild(t)
	cr := decode[platform.Credential](t, b.c.f.call("POST", "/api/credentials", b.c.admin, map[string]any{"name": "Push signing", "kind": "secret", "teamId": b.c.teamID, "payload": map[string]any{"data": map[string]any{"webhookSecret": webhookTestSecret}}}, 201))
	f := &webhookFixture{buildFixture: b, credential: cr.ID}
	f.save(t, true, true, true, cr.ID, b.c.developer, 200)
	return f
}

func (f *webhookFixture) save(t *testing.T, manual, push, enabled bool, cr, token string, want int) {
	t.Helper()
	w := decode[application.Workflow](t, f.c.f.call("GET", "/api/apps/"+f.app+"/pipelines", token, nil, 200))
	var id any
	if push {
		id = cr
	}
	for i := range w.Items {
		if w.Items[i].Kind == "ci" {
			f.pipeline = w.Items[i].ID
			w.Items[i].Enabled = enabled
			w.Items[i].Definition = map[string]any{"manual": manual, "push": push, "branch": "main", "webhookCredentialId": id}
		}
	}
	items := []map[string]any{}
	for _, p := range w.Items {
		items = append(items, map[string]any{"id": p.ID, "kind": p.Kind, "bindingId": p.BindingID, "enabled": p.Enabled, "definition": p.Definition})
	}
	f.c.f.call("PUT", "/api/apps/"+f.app+"/pipelines", token, map[string]any{"expectedVersion": w.Version, "items": items}, want)
}

func (f *webhookFixture) payload() []byte {
	raw, _ := json.Marshal(map[string]any{"ref": "refs/heads/main", "after": f.sha, "deleted": false, "repository": map[string]any{"clone_url": f.remote.URL()}, "sender": map[string]any{"login": "untrusted-provider-name"}})
	return raw
}

func (f *webhookFixture) deliver(body []byte, id, event, secret string, mutate func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/api/webhooks/git/github/"+f.pipeline, bytes.NewReader(body))
	r.Header = webhookHeaders(body, id, event, secret)
	if mutate != nil {
		mutate(r)
	}
	w := httptest.NewRecorder()
	f.c.f.handler.ServeHTTP(w, r)
	return w
}

func webhookHeaders(body []byte, id, event, secret string) http.Header {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	h := http.Header{}
	h.Set("Content-Type", "application/json")
	h.Set("X-GitHub-Delivery", id)
	h.Set("X-GitHub-Event", event)
	h.Set("X-Hub-Signature-256", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	return h
}

func webhookStatus(t *testing.T, w *httptest.ResponseRecorder, want int) {
	t.Helper()
	if w.Code != want {
		t.Fatalf("webhook status %d wanted %d: %s", w.Code, want, w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("webhook response cacheable")
	}
}

func (f *webhookFixture) counts(t *testing.T, deliveries, builds int) {
	t.Helper()
	var d, b int
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT (SELECT count(*) FROM webhook_deliveries),(SELECT count(*) FROM builds)").Scan(&d, &b); err != nil || d != deliveries || b != builds {
		t.Fatalf("deliveries=%d builds=%d want %d/%d: %v", d, b, deliveries, builds, err)
	}
}

func TestGitWebhookPersistentAdmissionReplayAndExecution(t *testing.T) {
	f := setupWebhook(t)
	id, body := uuid.NewString(), f.payload()
	// Admission does not need the Git server or any live Kubernetes/Registry read.
	f.remote.Server.Close()
	w := f.deliver(body, id, "push", webhookTestSecret, nil)
	webhookStatus(t, w, 202)
	out := decode[application.WebhookResult](t, w.Body.Bytes())
	if out.Status != "accepted" || out.BuildID == nil {
		t.Fatal(out)
	}
	var actor, frozen string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT b.requested_by,a.execution_spec::text FROM builds b JOIN build_attempts a ON a.build_id=b.id WHERE b.id=$1", *out.BuildID).Scan(&actor, &frozen); err != nil || actor != f.c.dev.ID || strings.Contains(frozen, webhookTestSecret) || strings.Contains(frozen, f.credential) {
		t.Fatal("wrong actor or signing secret in runner spec", actor, err)
	}
	// Browser logout does not revoke the explicit workflow delegation.
	f.c.f.call("POST", "/api/auth/logout", f.c.developer, nil, 204)
	f.worker.Settings.Enabled = false
	vault, _ := credential.New(testCredentialKey)
	f.c.f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: f.c.f.auth, Application: application.New(f.c.f.pool, vault, nil, testJWT).UseBuilds(f.worker)})
	again := f.deliver(body, id, "push", webhookTestSecret, nil)
	webhookStatus(t, again, 202)
	if !bytes.Equal(w.Body.Bytes(), again.Body.Bytes()) {
		t.Fatal("durable replay changed after service reconstruction")
	}
	f.counts(t, 1, 1)
	f.worker.Settings.Enabled = true
	for range 3 {
		f.step(t)
	}
	f.kube.complete = true
	f.step(t)
	var status string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT status FROM builds WHERE id=$1", *out.BuildID).Scan(&status); err != nil || status != "succeeded" || f.kube.creates != 1 {
		t.Fatal(status, f.kube.creates, err)
	}
}

func TestGitWebhookSignatureBoundariesAndNoPayloadPersistence(t *testing.T) {
	f := setupWebhook(t)
	body := f.payload()
	for _, tc := range []struct {
		name   string
		body   []byte
		secret string
		mutate func(*http.Request)
		want   int
	}{
		{"wrong secret", body, "wrong-secret", nil, 401},
		{"modified raw bytes", append(body, ' '), webhookTestSecret, func(r *http.Request) { r.Body = ioBody(body) }, 401},
		{"unsigned", body, webhookTestSecret, func(r *http.Request) { r.Header.Del("X-Hub-Signature-256") }, 422},
		{"duplicate signature", body, webhookTestSecret, func(r *http.Request) { r.Header.Add("X-Hub-Signature-256", "sha256=aa") }, 422},
		{"no delivery", body, webhookTestSecret, func(r *http.Request) { r.Header.Del("X-GitHub-Delivery") }, 422},
		{"invalid delivery", body, webhookTestSecret, func(r *http.Request) { r.Header.Set("X-GitHub-Delivery", "not-a-guid") }, 422},
		{"no event", body, webhookTestSecret, func(r *http.Request) { r.Header.Del("X-GitHub-Event") }, 422},
		{"wrong type", body, webhookTestSecret, func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") }, 415},
		{"unsupported provider", body, webhookTestSecret, func(r *http.Request) { r.URL.Path = strings.Replace(r.URL.Path, "/github/", "/gitlab/", 1) }, 422},
		{"invalid JSON", []byte(`{"ref":`), webhookTestSecret, nil, 422},
		{"duplicate JSON key", []byte(`{"ref":"main","ref":"other"}`), webhookTestSecret, nil, 422},
		{"oversize", bytes.Repeat([]byte("x"), (1<<20)+1), webhookTestSecret, nil, 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			webhookStatus(t, f.deliver(tc.body, uuid.NewString(), "push", tc.secret, tc.mutate), tc.want)
		})
	}
	f.counts(t, 0, 0)
	id := uuid.NewString()
	w := f.deliver(body, id, "push", webhookTestSecret, nil)
	webhookStatus(t, w, 202)
	for _, query := range []string{"SELECT row_to_json(w)::text FROM webhook_deliveries w", "SELECT target::text FROM audit_events WHERE action='webhook.accepted'"} {
		var stored string
		if err := f.c.f.pool.QueryRow(context.Background(), query).Scan(&stored); err != nil || strings.Contains(stored, webhookTestSecret) || strings.Contains(stored, f.remote.URL()) || strings.Contains(stored, "untrusted-provider-name") {
			t.Fatal("raw payload or secret persisted", err)
		}
	}
}

func TestGitWebhookIgnoredFiltersAndDeliveryConflicts(t *testing.T) {
	f := setupWebhook(t)
	f.worker.Settings.Enabled = false
	for _, change := range []func(map[string]any){
		func(m map[string]any) { m["ref"] = "refs/heads/other" },
		func(m map[string]any) { m["ref"] = "refs/tags/main" },
		func(m map[string]any) { m["deleted"] = true },
		func(m map[string]any) { m["after"] = strings.Repeat("0", 40) },
		func(m map[string]any) { m["repository"] = map[string]any{"clone_url": "https://other.test/repo.git"} },
	} {
		var payload map[string]any
		_ = json.Unmarshal(f.payload(), &payload)
		change(payload)
		body, _ := json.Marshal(payload)
		w := f.deliver(body, uuid.NewString(), "push", webhookTestSecret, nil)
		webhookStatus(t, w, 202)
		if out := decode[application.WebhookResult](t, w.Body.Bytes()); out.Status != "ignored" || out.BuildID != nil {
			t.Fatal(out)
		}
	}
	id := uuid.NewString()
	webhookStatus(t, f.deliver([]byte(`{"zen":"fixture"}`), id, "ping", webhookTestSecret, nil), 202)
	webhookStatus(t, f.deliver([]byte(`{"zen":"fixture"}`), id, "push", webhookTestSecret, nil), 409)
	webhookStatus(t, f.deliver([]byte(`{"zen":"different"}`), id, "ping", webhookTestSecret, nil), 409)
	f.counts(t, 6, 0)
}

func TestGitWebhookConcurrentDeliveryAndDisabledRetry(t *testing.T) {
	f := setupWebhook(t)
	id, body := uuid.NewString(), f.payload()
	f.worker.Settings.Enabled = false
	webhookStatus(t, f.deliver(body, id, "push", webhookTestSecret, nil), 503)
	f.counts(t, 0, 0)
	f.worker.Settings.Enabled = true
	var wg sync.WaitGroup
	results := make(chan *httptest.ResponseRecorder, 6)
	for range 6 {
		wg.Go(func() { results <- f.deliver(body, id, "push", webhookTestSecret, nil) })
	}
	wg.Wait()
	close(results)
	var first []byte
	for w := range results {
		webhookStatus(t, w, 202)
		if first == nil {
			first = w.Body.Bytes()
		}
		if !bytes.Equal(first, w.Body.Bytes()) {
			t.Fatal("concurrent delivery returned different builds")
		}
	}
	f.counts(t, 1, 1)
	webhookStatus(t, f.deliver(append(body, ' '), id, "push", webhookTestSecret, nil), 409)
	webhookStatus(t, f.deliver(body, id, "push", "wrong-secret", nil), 401)
	// A distinct provider delivery is a distinct trigger, even for the same SHA.
	webhookStatus(t, f.deliver(body, uuid.NewString(), "push", webhookTestSecret, nil), 202)
	f.counts(t, 2, 2)
}

func TestGitWebhookRotationWorkflowDisableAndPushOnly(t *testing.T) {
	f := setupWebhook(t)
	f.save(t, false, true, true, f.credential, f.c.developer, 200)
	setup := decode[application.Setup](t, f.c.f.call("GET", "/api/apps/"+f.app+"/setup", f.c.developer, nil, 200))
	if setup.CanBuild {
		t.Fatal("manual build advertised for push-only CI")
	}
	for _, step := range setup.Steps {
		for _, blocker := range step.Blockers {
			if blocker.Code == "execution_unavailable" {
				t.Fatal("push-only CI incorrectly reports an unavailable execution environment")
			}
		}
	}
	f.trigger(t, "push-only-manual-denied", 422)
	id, body := uuid.NewString(), f.payload()
	newSecret := "rotated-fixture-signing-secret-0123456789"
	f.c.f.call("PUT", "/api/credentials/"+f.credential, f.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"data": map[string]any{"webhookSecret": newSecret}}}, 200)
	webhookStatus(t, f.deliver(body, id, "push", webhookTestSecret, nil), 401)
	webhookStatus(t, f.deliver(body, id, "push", newSecret, nil), 202)
	f.save(t, false, true, false, f.credential, f.c.developer, 200)
	webhookStatus(t, f.deliver(body, id, "push", newSecret, nil), 404)
	f.save(t, true, false, true, "", f.c.developer, 200)
	webhookStatus(t, f.deliver(body, id, "push", newSecret, nil), 404)
	f.counts(t, 1, 1)
}

func TestGitWebhookAtomicRollbackAndMigrationProtection(t *testing.T) {
	f := setupWebhook(t)
	ctx := context.Background()
	if _, err := f.c.f.pool.Exec(ctx, `CREATE FUNCTION reject_webhook_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'webhook.%' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER reject_webhook_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_webhook_audit()`); err != nil {
		t.Fatal(err)
	}
	id, body := uuid.NewString(), f.payload()
	webhookStatus(t, f.deliver(body, id, "push", webhookTestSecret, nil), 500)
	f.counts(t, 0, 0)
	if _, err := f.c.f.pool.Exec(ctx, "DROP TRIGGER reject_webhook_audit ON audit_events"); err != nil {
		t.Fatal(err)
	}
	webhookStatus(t, f.deliver(body, id, "push", webhookTestSecret, nil), 202)
	f.counts(t, 1, 1)
	f.save(t, true, false, true, "", f.c.developer, 200)
	if _, err := f.c.f.pool.Exec(ctx, "DELETE FROM webhook_deliveries"); err == nil {
		t.Fatal("webhook history mutable")
	}
	downgradeHealthSchedule(t, f.c.f.dsn)
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v16 to v15 without auto deployment state", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err == nil {
		t.Fatal("delivery history lost on downgrade")
	}
}

func TestGitWebhookAuthorizationRepositoryChangeAndWorkerRecheck(t *testing.T) {
	f := setupWebhook(t)
	ctx := context.Background()
	body, id := f.payload(), uuid.NewString()
	f.c.f.call("DELETE", "/api/projects/"+f.c.projectID+"/members/"+f.c.dev.ID, f.c.admin, nil, 204)
	webhookStatus(t, f.deliver(body, id, "push", webhookTestSecret, nil), 404)
	f.counts(t, 0, 0)
	f.c.f.call("POST", "/api/projects/"+f.c.projectID+"/members", f.c.admin, map[string]any{"userId": f.c.dev.ID, "role": "developer"}, 201)
	webhookStatus(t, f.deliver(body, id, "push", webhookTestSecret, nil), 202)
	f.c.f.call("DELETE", "/api/projects/"+f.c.projectID+"/members/"+f.c.dev.ID, f.c.admin, nil, 204)
	f.step(t)
	var state string
	if err := f.c.f.pool.QueryRow(ctx, "SELECT status FROM builds").Scan(&state); err != nil || state != "failed" || f.kube.creates != 0 {
		t.Fatal("worker ignored revoked delegation", state, err)
	}
	f.c.f.call("POST", "/api/projects/"+f.c.projectID+"/members", f.c.admin, map[string]any{"userId": f.c.dev.ID, "role": "developer"}, 201)
	saveGit(t, f.c, f.app, "https://changed.test/project.git", 2, nil)
	webhookStatus(t, f.deliver(body, uuid.NewString(), "push", webhookTestSecret, nil), 409)
	f.counts(t, 1, 1)
	if _, err := f.c.f.pool.Exec(ctx, "UPDATE users SET disabled_at=now() WHERE id=$1", f.c.dev.ID); err != nil {
		t.Fatal(err)
	}
	webhookStatus(t, f.deliver(body, id, "push", webhookTestSecret, nil), 404)
}

func TestGitWebhookAdmissionWaitsForCurrentAuthorization(t *testing.T) {
	f := setupWebhook(t)
	ctx := context.Background()
	tx, err := f.c.f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	// Use the real project lock shared by membership mutations and admission.
	if _, err = tx.Exec(ctx, "SELECT id FROM projects WHERE id=$1 FOR UPDATE", f.c.projectID); err != nil {
		t.Fatal(err)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- f.deliver(f.payload(), uuid.NewString(), "push", webhookTestSecret, nil) }()
	deadline := time.Now().Add(5 * time.Second)
	waiting := false
	for time.Now().Before(deadline) {
		if err = f.c.f.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM projects WHERE id=%FOR UPDATE%')").Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !waiting {
		t.Fatal("webhook did not reach authorization lock")
	}
	if _, err = tx.Exec(ctx, "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", f.c.projectID, f.c.dev.ID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case w := <-done:
		webhookStatus(t, w, 404)
	case <-time.After(5 * time.Second):
		t.Fatal("webhook admission stuck")
	}
	f.counts(t, 0, 0)
}

func ioBody(body []byte) io.ReadCloser { return io.NopCloser(bytes.NewReader(body)) }

func TestGitWebhookConfigurationBlocksDowngrade(t *testing.T) {
	f := setupWebhook(t)
	f.counts(t, 0, 0)
	downgradeHealthSchedule(t, f.c.f.dsn)
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v16 to v15 without auto deployment state", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err == nil {
		t.Fatal("push configuration lost on downgrade")
	}
}

func TestGitWebhookScopedSecretAndTemplateAuthorization(t *testing.T) {
	f := setupWebhook(t)
	foreignTeam := decode[map[string]string](t, f.c.f.call("POST", "/api/teams", f.c.admin, map[string]any{"name": "Foreign signing team"}, 201))["id"]
	for _, tc := range []struct {
		name, kind string
		team       any
		payload    map[string]any
		want       int
	}{
		{"foreign", "secret", foreignTeam, map[string]any{"data": map[string]any{"webhookSecret": webhookTestSecret}}, 404},
		{"git-kind", "git", f.c.teamID, map[string]any{"username": "fixture", "token": webhookTestSecret}, 422},
		{"short", "secret", f.c.teamID, map[string]any{"data": map[string]any{"webhookSecret": "short"}}, 422},
		{"extra-data", "secret", f.c.teamID, map[string]any{"data": map[string]any{"webhookSecret": webhookTestSecret, "extra": "unrelated"}}, 422},
	} {
		cr := decode[platform.Credential](t, f.c.f.call("POST", "/api/credentials", f.c.admin, map[string]any{"name": tc.name, "kind": tc.kind, "teamId": tc.team, "payload": tc.payload}, 201))
		f.save(t, true, true, true, cr.ID, f.c.developer, tc.want)
	}
	f.save(t, false, false, true, "", f.c.developer, 422)
	// The template path must create the same explicit delegation as workflow PUT.
	id := f.c.app(t, "push-template")
	saveGit(t, f.c, id, f.remote.URL(), 0, nil)
	config := decode[application.Config](t, f.c.f.call("GET", "/api/apps/"+f.app+"/config", f.c.developer, nil, 200))
	f.c.f.call("PUT", "/api/apps/"+id+"/config", f.c.developer, map[string]any{"expectedVersion": 1, "section": "build", "buildConfig": config.BuildConfig}, 200)
	out := decode[application.TemplateResult](t, f.c.f.keyed("POST", "/api/apps/"+id+"/workflow-templates", f.c.developer, "push-template-idempotent", map[string]any{"template": "build_only", "expectedConfigVersion": 2, "expectedWorkflowVersion": 0, "ci": map[string]any{"manual": false, "push": true, "branch": "main", "webhookCredentialId": f.credential}}, 201))
	f.pipeline = out.Workflow.Items[0].ID
	f.worker.Settings.Enabled = false
	webhookStatus(t, f.deliver([]byte(`{"zen":"template"}`), uuid.NewString(), "ping", webhookTestSecret, nil), 202)
	var actor string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT authorized_by FROM pipeline_push_authorizations WHERE pipeline_id=$1", f.pipeline).Scan(&actor); err != nil || actor != f.c.dev.ID {
		t.Fatal(actor, err)
	}
}
