package integration_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/server"
)

type providerWebhookFixture struct {
	*webhookFixture
	provider, mode, secret string
}

func setupProviderWebhook(t *testing.T, provider, mode string) *providerWebhookFixture {
	t.Helper()
	f := &providerWebhookFixture{webhookFixture: setupWebhook(t), provider: provider, mode: mode, secret: webhookTestSecret}
	if provider == "gitlab" && mode == "signature" {
		f.secret = "whsec_" + base64.StdEncoding.EncodeToString([]byte(webhookTestSecret))
	}
	if mode != "" {
		f.rotate(t, 1, f.secret)
	}
	return f
}

func (f *providerWebhookFixture) rotate(t *testing.T, version int, secret string) {
	t.Helper()
	data := map[string]any{"webhookSecret": secret}
	if f.mode != "" {
		data["webhookAuthMode"] = f.mode
	}
	f.c.f.call("PUT", "/api/credentials/"+f.credential, f.c.admin, map[string]any{"expectedVersion": version, "payload": map[string]any{"data": data}}, 200)
}

func (f *providerWebhookFixture) providerPayload(t *testing.T) []byte {
	t.Helper()
	var payload map[string]any
	_ = json.Unmarshal(f.payload(), &payload)
	if f.provider == "gitea" {
		delete(payload, "deleted")
	}
	if f.provider == "gitlab" {
		delete(payload, "deleted")
		delete(payload, "repository")
		payload["object_kind"] = "push"
		payload["project"] = map[string]any{"git_http_url": f.remote.URL()}
	}
	if f.provider == "gitee" {
		payload["password"], payload["timestamp"], payload["sign"] = "provider-password-never-persist", "provider-timestamp", "provider-signature"
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func (f *providerWebhookFixture) send(body []byte, id, event, secret string, mutate func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/api/webhooks/git/"+f.provider+"/"+f.pipeline, bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	sum := func(key, input []byte) []byte {
		mac := hmac.New(sha256.New, key)
		_, _ = mac.Write(input)
		return mac.Sum(nil)
	}
	switch f.provider {
	case "gitea":
		r.Header.Set("X-Gitea-Delivery", id)
		r.Header.Set("X-Gitea-Event", event)
		r.Header.Set("X-Gitea-Signature", hex.EncodeToString(sum([]byte(secret), body)))
	case "gitlab":
		r.Header.Set("X-Gitlab-Event", event)
		r.Header.Set("Idempotency-Key", id)
		if f.mode == "signature" {
			r.Header.Set("webhook-id", id)
			r.Header.Set("webhook-timestamp", fmt.Sprint(time.Now().Unix()))
			key, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
			r.Header.Set("webhook-signature", "v1,"+base64.StdEncoding.EncodeToString(sum(key, append([]byte(id+"."+r.Header.Get("webhook-timestamp")+"."), body...))))
		} else {
			r.Header.Set("X-Gitlab-Token", secret)
		}
	case "gitee":
		r.Header.Set("X-Gitee-Event", event)
		if f.mode == "token" {
			r.Header.Set("X-Gitee-Token", secret)
		} else {
			r.Header.Set("X-Gitee-Timestamp", fmt.Sprint(time.Now().UnixMilli()))
			r.Header.Set("X-Gitee-Token", url.QueryEscape(base64.StdEncoding.EncodeToString(sum([]byte(secret), []byte(r.Header.Get("X-Gitee-Timestamp")+"\n"+secret)))))
		}
	}
	if mutate != nil {
		mutate(r)
	}
	w := httptest.NewRecorder()
	f.c.f.handler.ServeHTTP(w, r)
	return w
}

func TestGitWebhookProvidersAdmissionConcurrencyExecutionAndRotation(t *testing.T) {
	for _, tc := range []struct{ provider, mode string }{{"gitea", ""}, {"gitlab", ""}, {"gitlab", "signature"}, {"gitee", ""}, {"gitee", "token"}} {
		t.Run(tc.provider+"-"+tc.mode, func(t *testing.T) {
			f := setupProviderWebhook(t, tc.provider, tc.mode)
			body, id, event := f.providerPayload(t), uuid.NewString(), "Push Hook"
			if tc.provider == "gitea" {
				event = "push"
			}
			wrong := "another-wrong-webhook-secret-0123456789"
			if tc.provider == "gitlab" && tc.mode == "signature" {
				wrong = "whsec_" + base64.StdEncoding.EncodeToString([]byte(wrong))
			}
			webhookStatus(t, f.send(body, id, event, wrong, nil), 401)
			f.worker.Settings.Enabled = false
			webhookStatus(t, f.send(body, id, event, f.secret, nil), 503)
			f.counts(t, 0, 0)
			f.worker.Settings.Enabled = true
			ctx := context.Background()
			if _, err := f.c.f.pool.Exec(ctx, `CREATE FUNCTION provider_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'webhook.%' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER provider_reject_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION provider_reject_audit()`); err != nil {
				t.Fatal(err)
			}
			webhookStatus(t, f.send(body, id, event, f.secret, nil), 500)
			f.counts(t, 0, 0)
			if _, err := f.c.f.pool.Exec(ctx, "DROP TRIGGER provider_reject_audit ON audit_events"); err != nil {
				t.Fatal(err)
			}
			var wg sync.WaitGroup
			responses := make(chan *httptest.ResponseRecorder, 4)
			for range 4 {
				wg.Go(func() { responses <- f.send(body, id, event, f.secret, nil) })
			}
			wg.Wait()
			close(responses)
			var original []byte
			for response := range responses {
				webhookStatus(t, response, 202)
				if original == nil {
					original = append([]byte(nil), response.Body.Bytes()...)
				} else if !bytes.Equal(original, response.Body.Bytes()) {
					t.Fatal("concurrent deliveries admitted different builds")
				}
			}
			out := decode[application.WebhookResult](t, original)
			if out.Status != "accepted" || out.BuildID == nil {
				t.Fatal("no accepted build")
			}
			f.counts(t, 1, 1)
			var provider, frozen, audit string
			if err := f.c.f.pool.QueryRow(ctx, "SELECT w.provider,a.execution_spec::text,e.target::text FROM webhook_deliveries w JOIN build_attempts a ON a.build_id=w.build_id JOIN audit_events e ON e.action='webhook.accepted'").Scan(&provider, &frozen, &audit); err != nil || provider != tc.provider || !strings.Contains(audit, tc.provider) {
				t.Fatal("provider identity or audit missing", err)
			}
			for _, forbidden := range []string{f.secret, "provider-password-never-persist", "provider-signature", "untrusted-provider-name"} {
				if strings.Contains(frozen+audit, forbidden) {
					t.Fatal("webhook authentication or payload leaked")
				}
			}
			for range 3 {
				f.step(t)
			}
			f.kube.complete = true
			f.step(t)
			var status string
			if err := f.c.f.pool.QueryRow(ctx, "SELECT status FROM builds WHERE id=$1", *out.BuildID).Scan(&status); err != nil || status != "succeeded" || f.kube.creates != 1 {
				t.Fatal("provider build did not complete through worker", status, err)
			}
			f.worker.Settings.Enabled = false
			vault, _ := credential.New(testCredentialKey)
			originalHandler := f.c.f.handler
			f.c.f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: f.c.f.auth, Application: application.New(f.c.f.pool, vault, nil, testJWT).UseBuilds(f.worker)})
			if tc.provider == "gitee" {
				body = bytes.ReplaceAll(body, []byte("provider-timestamp"), []byte("new-timestamp"))
				body = bytes.ReplaceAll(body, []byte("provider-signature"), []byte("new-signature"))
			}
			replay := f.send(body, id, event, f.secret, nil)
			webhookStatus(t, replay, 202)
			if !bytes.Equal(original, replay.Body.Bytes()) {
				t.Fatal("reconstruction or re-signing changed replay")
			}
			if tc.provider != "gitee" {
				webhookStatus(t, f.send(append(body, ' '), id, event, f.secret, nil), 409)
			}
			// The reconstruction above deliberately mounts only webhook routes.
			// Restore the complete fixture router before testing management writes.
			f.c.f.handler = originalHandler
			version := 1
			if tc.mode != "" {
				version = 2
			}
			f.rotate(t, version, wrong)
			webhookStatus(t, f.send(body, id, event, f.secret, nil), 401)
			webhookStatus(t, f.send(body, id, event, wrong, nil), 202)
			f.counts(t, 1, 1)
			f.save(t, true, false, true, "", f.c.developer, 200)
			webhookStatus(t, f.send(body, id, event, wrong, nil), 404)
		})
	}
}

func TestGitWebhookProvidersIgnoredFiltersAndInvalidPayloads(t *testing.T) {
	for _, provider := range []string{"gitea", "gitlab", "gitee"} {
		t.Run(provider, func(t *testing.T) {
			f := setupProviderWebhook(t, provider, "")
			f.worker.Settings.Enabled = false
			body, event := f.providerPayload(t), "Push Hook"
			if provider == "gitea" {
				event = "push"
			}
			for _, ignored := range [][]byte{
				bytes.ReplaceAll(body, []byte("refs/heads/main"), []byte("refs/heads/other")),
				bytes.ReplaceAll(body, []byte("refs/heads/main"), []byte("refs/tags/main")),
				bytes.ReplaceAll(body, []byte(f.sha), []byte(strings.Repeat("0", 40))),
				bytes.ReplaceAll(body, []byte(f.remote.URL()), []byte("https://another.example/repo.git")),
			} {
				w := f.send(ignored, uuid.NewString(), event, f.secret, nil)
				webhookStatus(t, w, 202)
				if out := decode[application.WebhookResult](t, w.Body.Bytes()); out.Status != "ignored" || out.BuildID != nil {
					t.Fatal("ignored event created a build")
				}
			}
			for _, invalid := range [][]byte{[]byte(`{"ref":"first","ref":"second"}`), []byte(`null`), []byte(`{"ref":`), bytes.ReplaceAll(body, []byte(f.sha), []byte("short"))} {
				webhookStatus(t, f.send(invalid, uuid.NewString(), event, f.secret, nil), 422)
			}
			webhookStatus(t, f.send([]byte(`{"ping":true}`), uuid.NewString(), "unhandled", f.secret, nil), 202)
			f.counts(t, 5, 0)
		})
	}
}

func TestGitWebhookProviderMigrationHistoryProtection(t *testing.T) {
	f := setupProviderWebhook(t, "gitea", "")
	webhookStatus(t, f.send([]byte(`{"ping":true}`), uuid.NewString(), "ping", f.secret, nil), 202)
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v20 lifecycle downgrade", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v19 cleanup metadata downgrade", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err == nil {
		t.Fatal("non-GitHub delivery history allowed downgrade to GitHub-only schema")
	}
	f.counts(t, 1, 0)
	if err := database.CheckSchema(context.Background(), f.c.f.pool); err == nil {
		t.Fatal("failed migration dirty state accepted")
	}
}

func TestGitWebhookProviderIdentityIsolation(t *testing.T) {
	f := setupProviderWebhook(t, "gitea", "")
	id := uuid.NewString()
	webhookStatus(t, f.send(f.providerPayload(t), id, "push", f.secret, nil), 202)
	f.provider = "gitlab"
	webhookStatus(t, f.send(f.providerPayload(t), id, "Push Hook", f.secret, nil), 202)
	f.provider = "gitee"
	webhookStatus(t, f.send(f.providerPayload(t), id, "Push Hook", f.secret, nil), 202)
	f.counts(t, 3, 3)
}

func TestGitWebhookProviderSchemaUpgradeAndGitHubHistory(t *testing.T) {
	f := setupWebhook(t)
	webhookStatus(t, f.deliver([]byte(`{"ping":true}`), uuid.NewString(), "ping", webhookTestSecret, nil), 202)
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v20 lifecycle downgrade", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v19 cleanup metadata downgrade", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("GitHub-only history should permit v18 to v17", err)
	}
	if err := database.CheckSchema(context.Background(), f.c.f.pool); err == nil {
		t.Fatal("new binary accepted v17 schema")
	}
	if err := database.Migrate(f.c.f.dsn, false); err != nil {
		t.Fatal("v17 to v18 with GitHub history", err)
	}
	if err := database.CheckSchema(context.Background(), f.c.f.pool); err != nil {
		t.Fatal("upgraded schema rejected", err)
	}
	f.counts(t, 1, 0)
}
