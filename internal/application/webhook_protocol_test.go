package application

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestWebhookPushProviderPayloads(t *testing.T) {
	sha := strings.Repeat("a", 40)
	for _, provider := range []string{"github", "gitea", "gitlab", "gitee"} {
		t.Run(provider, func(t *testing.T) {
			event, extra, repository := "push", `,"deleted":false`, `"repository":{"clone_url":"https://git.example/team/repo.git"}`
			if provider == "gitea" {
				extra = "" // Actual Gitea PushPayload has no deleted field.
			}
			if provider == "gitlab" {
				event, extra, repository = "Push Hook", `,"object_kind":"push"`, `"project":{"git_http_url":"https://git.example/team/repo.git"}`
			}
			if provider == "gitee" {
				event = "Push Hook"
			}
			body := fmt.Sprintf(`{"ref":"refs/heads/main","after":"%s",%s%s}`, sha, repository, extra)
			got, accept, err := webhookPush(provider, event, []byte(body), "https://git.example/team/repo", "main")
			if err != nil || !accept || got != sha {
				t.Fatalf("valid provider push: sha=%q accept=%v err=%v", got, accept, err)
			}
			for _, mutation := range []string{
				strings.Replace(body, "refs/heads/main", "refs/heads/other", 1),
				strings.Replace(body, "refs/heads/main", "refs/tags/main", 1),
				strings.Replace(body, sha, strings.Repeat("0", 40), 1),
				strings.Replace(body, "git.example", "other.example", 1),
			} {
				if _, accept, err := webhookPush(provider, event, []byte(mutation), "https://git.example/team/repo.git", "main"); err != nil || accept {
					t.Fatalf("ignored push: accept=%v err=%v", accept, err)
				}
			}
			for _, mutation := range []string{
				strings.Replace(body, sha, strings.ToUpper(sha), 1),
				strings.Replace(body, `"after":"`+sha+`"`, `"after":null`, 1),
				strings.Replace(body, `"ref":"refs/heads/main"`, `"ref":false`, 1),
				strings.Replace(body, `"ref":`, `"ref":"duplicate","ref":`, 1),
				strings.Replace(body, `"clone_url"`, `"Clone_URL"`, 1),
			} {
				if mutation == body { // GitLab uses project.git_http_url instead.
					continue
				}
				if _, _, err := webhookPush(provider, event, []byte(mutation), "https://git.example/team/repo.git", "main"); err == nil {
					t.Fatal("invalid provider payload accepted")
				}
			}
		})
	}
}

func TestWebhookProviderAuthenticationBoundaries(t *testing.T) {
	now := time.Unix(1795392000, 0)
	secret := []byte("fixture-webhook-secret-01234567890123456789")
	body := []byte(`{"ref":"refs/heads/main"}`)
	mac := func(key, input []byte) []byte {
		h := hmac.New(sha256.New, key)
		_, _ = h.Write(input)
		return h.Sum(nil)
	}
	for _, provider := range []string{"github", "gitea", "gitlab", "gitee"} {
		t.Run(provider, func(t *testing.T) {
			h := http.Header{}
			credential := webhookSecret{Value: secret}
			var signatureHeader, timestampHeader string
			switch provider {
			case "github":
				signatureHeader = "X-Hub-Signature-256"
				h.Set(signatureHeader, "sha256="+hex.EncodeToString(mac(secret, body)))
			case "gitea":
				signatureHeader = "X-Gitea-Signature"
				h.Set(signatureHeader, hex.EncodeToString(mac(secret, body)))
			case "gitlab":
				credential.Value = []byte("whsec_" + base64.StdEncoding.EncodeToString(secret))
				signatureHeader, timestampHeader = "webhook-signature", "webhook-timestamp"
				h.Set("webhook-id", "message-fixture")
				h.Set(timestampHeader, fmt.Sprint(now.Unix()))
				h.Set(signatureHeader, "v2,ignored v1,"+base64.StdEncoding.EncodeToString(mac(secret, append([]byte("message-fixture."+h.Get(timestampHeader)+"."), body...))))
			case "gitee":
				signatureHeader, timestampHeader = "X-Gitee-Token", "X-Gitee-Timestamp"
				h.Set(timestampHeader, fmt.Sprint(now.UnixMilli()))
				h.Set(signatureHeader, url.QueryEscape(base64.StdEncoding.EncodeToString(mac(secret, []byte(h.Get(timestampHeader)+"\n"+string(secret))))))
			}
			e := webhookEnvelope{Provider: provider, Headers: h}
			if err := e.verifyAt(credential, body, now); err != nil {
				t.Fatal("valid signature rejected", err)
			}
			if provider == "gitee" {
				rawSignature, _ := url.QueryUnescape(h.Get(signatureHeader))
				h.Set(signatureHeader, rawSignature)
				if err := e.verifyAt(credential, body, now); err != nil {
					t.Fatal("raw Gitee Base64 signature rejected", err)
				}
			}
			if provider != "gitee" {
				if err := e.verifyAt(credential, append(body, ' '), now); err == nil {
					t.Fatal("body tampering accepted")
				}
			}
			if timestampHeader != "" {
				if err := e.verifyAt(credential, body, now.Add(2*time.Hour)); err == nil {
					t.Fatal("expired signature accepted")
				}
				if err := e.verifyAt(credential, body, now.Add(-2*time.Hour)); err == nil {
					t.Fatal("future signature accepted")
				}
			}
			if provider == "gitlab" {
				h.Set("X-Gitlab-Token", string(credential.Value))
				h.Set("webhook-id", "different-message")
				if err := e.verifyAt(credential, body, now); err == nil {
					t.Fatal("signed id tampering or token downgrade accepted")
				}
			}
			h.Add(signatureHeader, h.Get(signatureHeader))
			if err := e.verifyAt(credential, body, now); err == nil {
				t.Fatal("duplicate authentication header accepted")
			}
		})
	}
	for _, provider := range []string{"gitlab", "gitee"} {
		h := http.Header{}
		key := "X-Gitlab-Token"
		if provider == "gitee" {
			key = "X-Gitee-Token"
		}
		h.Set(key, string(secret))
		e := webhookEnvelope{Provider: provider, Headers: h}
		if err := e.verifyAt(webhookSecret{Value: secret, Mode: "token"}, body, now); err != nil {
			t.Fatal(provider, "explicit token rejected", err)
		}
		h.Set(key, "wrong-secret")
		if err := e.verifyAt(webhookSecret{Value: secret, Mode: "token"}, body, now); err == nil {
			t.Fatal(provider, "wrong token accepted")
		}
	}
}

func TestWebhookEnvelopeRejectsAmbiguousIdentityAndMissingAuthentication(t *testing.T) {
	for _, provider := range []string{"github", "gitea", "gitlab", "gitee"} {
		t.Run(provider, func(t *testing.T) {
			h := http.Header{}
			delivery, event := "X-GitHub-Delivery", "X-GitHub-Event"
			switch provider {
			case "gitea":
				delivery, event = "X-Gitea-Delivery", "X-Gitea-Event"
			case "gitlab":
				delivery, event = "Idempotency-Key", "X-Gitlab-Event"
			case "gitee":
				event = "X-Gitee-Event"
			}
			h.Set(event, "push")
			h.Set(delivery, "123e4567-e89b-12d3-a456-426614174000")
			e, err := readWebhookEnvelope(provider, h)
			if err != nil {
				t.Fatal(err)
			}
			if err := e.verify(webhookSecret{Value: []byte("fixture-secret-at-least-32-characters")}, []byte(`{}`)); err == nil {
				t.Fatal("missing authentication accepted")
			}
			h.Add(event, "different")
			if _, err := readWebhookEnvelope(provider, h); err == nil {
				t.Fatal("duplicate event accepted")
			}
			h.Set(event, "push")
			if provider != "gitee" {
				h.Add(delivery, "different")
				if _, err := readWebhookEnvelope(provider, h); err == nil {
					t.Fatal("duplicate delivery accepted")
				}
			}
		})
	}
}

func TestGiteeIdentityExcludesAuthenticationButPreservesNumbers(t *testing.T) {
	e := webhookEnvelope{Provider: "gitee"}
	a, err := e.identityBody([]byte(`{"password":"first","timestamp":"123","sign":"first","id":9007199254740993,"nested":{"z":2,"a":1}}`))
	if err != nil {
		t.Fatal(err)
	}
	b, err := e.identityBody([]byte(`{"nested":{"a":1,"z":2},"id":9007199254740993,"sign":"second","password":"second","timestamp":"456"}`))
	if err != nil || string(a) != string(b) || !strings.Contains(string(a), "9007199254740993") {
		t.Fatal("identity changed after signing or lost numeric precision", err)
	}
	c, _ := e.identityBody([]byte(`{"id":9007199254740992,"nested":{"z":2,"a":1}}`))
	if string(a) == string(c) {
		t.Fatal("different payloads have same identity")
	}
	for _, body := range []string{`{"id":1,"id":2}`, `null`, `[]`, `{}`} {
		_, err := e.identityBody([]byte(body))
		if body != `{}` && err == nil {
			t.Fatal("invalid JSON identity accepted")
		}
	}
}

func TestGitLabDeliveryIdentityPreference(t *testing.T) {
	h := http.Header{}
	h.Set("X-Gitlab-Event", "Push Hook")
	h.Set("X-Gitlab-Event-UUID", "legacy-event-id")
	h.Set("Idempotency-Key", "stable-retry-id")
	h.Set("webhook-id", "signed-message-id")
	for _, want := range []string{"signed-message-id", "stable-retry-id", "legacy-event-id"} {
		e, err := readWebhookEnvelope("gitlab", h)
		if err != nil || e.DeliveryID != want {
			t.Fatal("wrong GitLab identity preference", e.DeliveryID, err)
		}
		if want == "signed-message-id" {
			h.Del("webhook-id")
		} else {
			h.Del("Idempotency-Key")
		}
	}
	h.Set("webhook-id", "")
	if _, err := readWebhookEnvelope("gitlab", h); err == nil {
		t.Fatal("invalid preferred id downgraded to fallback")
	}
}
