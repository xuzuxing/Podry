package application

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xuzuxing/podry/internal/httpx"
)

var webhookSHA = regexp.MustCompile(`^[0-9a-f]{40}$`)

type webhookSecret struct {
	Value []byte
	Mode  string
}

type webhookEnvelope struct {
	Provider, DeliveryID, Event string
	Headers                     http.Header
}

func supportedWebhookProvider(provider string) bool {
	return provider == "github" || provider == "gitea" || provider == "gitlab" || provider == "gitee"
}

func unsupportedWebhookProvider() error {
	return httpx.Fail(422, "webhook_provider_unsupported", "支持 GitHub、Gitea、GitLab 和 Gitee Webhook")
}

func readWebhookEnvelope(provider string, headers http.Header) (webhookEnvelope, error) {
	e := webhookEnvelope{Provider: provider, Headers: headers}
	var deliveryHeader, eventHeader string
	switch provider {
	case "github":
		deliveryHeader, eventHeader = "X-GitHub-Delivery", "X-GitHub-Event"
	case "gitea":
		deliveryHeader, eventHeader = "X-Gitea-Delivery", "X-Gitea-Event"
	case "gitlab":
		// Prefer the delivery id stable across retries. Event UUID is the
		// compatibility fallback for older GitLab releases, never Webhook-UUID.
		eventHeader = "X-Gitlab-Event"
		for _, key := range []string{"webhook-id", "Idempotency-Key", "X-Gitlab-Event-UUID"} {
			if _, exists := headers[http.CanonicalHeaderKey(key)]; exists {
				deliveryHeader = key
				break
			}
		}
	case "gitee":
		eventHeader = "X-Gitee-Event"
	default:
		return e, unsupportedWebhookProvider()
	}
	var err error
	if e.Event, err = singleHeader(headers, eventHeader); err != nil {
		return e, err
	}
	if provider != "gitee" {
		if e.DeliveryID, err = singleHeader(headers, deliveryHeader); err != nil {
			return e, err
		}
		if provider == "github" || provider == "gitea" {
			if err = httpx.UUID(e.DeliveryID); err != nil {
				return e, err
			}
		}
		if len(e.DeliveryID) > 100 || strings.IndexFunc(e.DeliveryID, func(r rune) bool { return r < 33 || r > 126 || r == ',' }) >= 0 {
			return e, httpx.Invalid("Webhook 投递标识无效")
		}
	}
	return e, nil
}

func webhookAuthHeader(headers http.Header, key string) (string, error) {
	values := headers.Values(key)
	if len(values) != 1 || values[0] == "" || len(values[0]) > 2048 || strings.ContainsAny(values[0], "\x00\r\n") {
		return "", httpx.Invalid("Webhook 认证头缺失或无效")
	}
	return values[0], nil
}

func invalidWebhookSignature() error {
	return httpx.Fail(401, "webhook_signature_invalid", "Webhook 签名或认证无效")
}

func (e webhookEnvelope) verify(secret webhookSecret, body []byte) error {
	return e.verifyAt(secret, body, time.Now())
}

func (e webhookEnvelope) verifyAt(secret webhookSecret, body []byte, now time.Time) error {
	mode := secret.Mode
	if mode == "" {
		mode = "signature"
		if e.Provider == "gitlab" && !bytes.HasPrefix(secret.Value, []byte("whsec_")) {
			mode = "token"
		}
	}
	switch e.Provider {
	case "github", "gitea":
		if mode != "signature" {
			return httpx.Invalid("GitHub/Gitea 需要 signature 凭据")
		}
		key := "X-Hub-Signature-256"
		if e.Provider == "gitea" {
			key = "X-Gitea-Signature"
		}
		signature, err := webhookAuthHeader(e.Headers, key)
		if err != nil {
			return err
		}
		if e.Provider == "github" {
			if !strings.HasPrefix(signature, "sha256=") {
				return invalidWebhookSignature()
			}
			signature = strings.TrimPrefix(signature, "sha256=")
		}
		got, err := hex.DecodeString(signature)
		mac := hmac.New(sha256.New, secret.Value)
		_, _ = mac.Write(body)
		if err != nil || !hmac.Equal(got, mac.Sum(nil)) {
			return invalidWebhookSignature()
		}
	case "gitlab", "gitee":
		if mode == "token" {
			key := "X-Gitlab-Token"
			if e.Provider == "gitee" {
				key = "X-Gitee-Token"
			}
			got, err := webhookAuthHeader(e.Headers, key)
			if err != nil {
				return err
			}
			if !hmac.Equal([]byte(got), secret.Value) {
				return invalidWebhookSignature()
			}
			return nil
		}
		if e.Provider == "gitlab" {
			return e.verifyGitLabSignature(secret.Value, body, now)
		}
		return e.verifyGiteeSignature(secret.Value, now)
	default:
		return unsupportedWebhookProvider()
	}
	return nil
}

func webhookTimestamp(headers http.Header, key string, milliseconds bool, window time.Duration, now time.Time) (string, error) {
	raw, err := singleHeader(headers, key)
	if err != nil {
		return "", err
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 || strconv.FormatInt(n, 10) != raw {
		return "", invalidWebhookSignature()
	}
	clock, tolerance := now.Unix(), int64(window/time.Second)
	if milliseconds {
		clock, tolerance = now.UnixMilli(), int64(window/time.Millisecond)
	}
	// Compare integers before constructing a time to avoid duration overflow.
	if n < clock-tolerance || n > clock+tolerance {
		return "", invalidWebhookSignature()
	}
	return raw, nil
}

func (e webhookEnvelope) verifyGitLabSignature(secret, body []byte, now time.Time) error {
	if !bytes.HasPrefix(secret, []byte("whsec_")) {
		return httpx.Invalid("GitLab signature 凭据需要 whsec_ 签名令牌")
	}
	key, err := base64.StdEncoding.Strict().DecodeString(string(secret[6:]))
	if err != nil || len(key) < 16 {
		return httpx.Invalid("GitLab 签名令牌格式无效")
	}
	id, err := singleHeader(e.Headers, "webhook-id")
	if err != nil {
		return err
	}
	timestamp, err := webhookTimestamp(e.Headers, "webhook-timestamp", false, 5*time.Minute, now)
	if err != nil {
		return err
	}
	signatures, err := webhookAuthHeader(e.Headers, "webhook-signature")
	if err != nil {
		return err
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(id + "." + timestamp + "."))
	_, _ = mac.Write(body)
	expected := mac.Sum(nil)
	valid := false
	for _, signature := range strings.Fields(signatures) {
		if !strings.HasPrefix(signature, "v1,") {
			continue
		}
		got, err := base64.StdEncoding.Strict().DecodeString(strings.TrimPrefix(signature, "v1,"))
		if err == nil && hmac.Equal(got, expected) {
			valid = true
		}
	}
	if !valid {
		return invalidWebhookSignature()
	}
	return nil
}

func (e webhookEnvelope) verifyGiteeSignature(secret []byte, now time.Time) error {
	timestamp, err := webhookTimestamp(e.Headers, "X-Gitee-Timestamp", true, time.Hour, now)
	if err != nil {
		return err
	}
	signature, err := webhookAuthHeader(e.Headers, "X-Gitee-Token")
	if err != nil {
		return err
	}
	// Gitee documents URL-encoded Base64; some deliveries carry raw Base64.
	// Decode escapes only when present, preserving '+' in raw Base64.
	if strings.Contains(signature, "%") {
		signature, err = url.QueryUnescape(signature)
		if err != nil {
			return invalidWebhookSignature()
		}
	}
	got, err := base64.StdEncoding.Strict().DecodeString(signature)
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(timestamp + "\n"))
	_, _ = mac.Write(secret)
	if err != nil || !hmac.Equal(got, mac.Sum(nil)) {
		return invalidWebhookSignature()
	}
	return nil
}

func (e webhookEnvelope) identityBody(body []byte) ([]byte, error) {
	if e.Provider != "gitee" {
		return body, nil
	}
	if err := httpx.ValidateJSONObject(body); err != nil {
		return nil, err
	}
	var payload map[string]any
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return nil, httpx.Invalid("Webhook 请求体无效")
	}
	for _, key := range []string{"password", "sign", "timestamp"} {
		delete(payload, key)
	}
	return json.Marshal(payload)
}
