// Package credential validates and encrypts write-only, versioned credential payloads.
package credential

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/xuzuxing/podry/internal/httpx"
)

type Vault struct {
	aead  cipher.AEAD
	keyID string
}

// An absent key keeps the non-secret APIs usable; secret writes fail closed.
func New(encoded string) (*Vault, error) {
	if encoded == "" {
		return &Vault{}, nil
	}
	key, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(key) != 32 {
		return nil, errors.New("PODRY_CREDENTIAL_KEY must be base64 encoding of 32 random bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(key)
	return &Vault{aead, hex.EncodeToString(sum[:8])}, nil
}
func (v *Vault) Seal(id string, version int32, payload map[string]any) ([]byte, string, error) {
	if v == nil || v.aead == nil {
		return nil, "", httpx.Fail(503, "credential_key_unavailable", "尚未配置凭据加密密钥")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, "", err
	}
	nonce := make([]byte, v.aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, "", err
	}
	aad := []byte(fmt.Sprintf("podry/credential/v1/%s/%d/%s", id, version, v.keyID))
	return v.aead.Seal(nonce, nonce, raw, aad), v.keyID, nil
}
func (v *Vault) Open(id string, version int32, keyID string, encrypted []byte) (map[string]any, error) {
	if v == nil || v.aead == nil || keyID != v.keyID || len(encrypted) < v.aead.NonceSize() {
		return nil, httpx.Fail(503, "credential_key_unavailable", "凭据版本的密钥不可用")
	}
	n := v.aead.NonceSize()
	aad := []byte(fmt.Sprintf("podry/credential/v1/%s/%d/%s", id, version, keyID))
	raw, err := v.aead.Open(nil, encrypted[:n], encrypted[n:], aad)
	if err != nil {
		return nil, httpx.Fail(503, "credential_integrity_failed", "凭据认证校验失败")
	}
	var out map[string]any
	err = json.Unmarshal(raw, &out)
	return out, err
}

// HTTPSURL accepts no embedded authentication, query, fragment or opaque URL.
func HTTPSURL(raw string, rootOnly bool) error {
	return WebURL(raw, rootOnly, false)
}

// URLPolicy permits plain HTTP only for explicitly configured host:port pairs.
// It never changes Kubernetes TLS validation or follows redirects.
type URLPolicy struct{ AllowedHTTPHosts []string }

func (p URLPolicy) AllowsHTTP(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" {
		return false
	}
	for _, host := range p.AllowedHTTPHosts {
		if strings.EqualFold(u.Host, host) {
			return true
		}
	}
	return false
}

func (p URLPolicy) Validate(raw string, rootOnly bool) error {
	return WebURL(raw, rootOnly, p.AllowsHTTP(raw))
}

// WebURL validates frozen endpoint policy without accepting executable transports.
func WebURL(raw string, rootOnly, allowHTTP bool) error {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && !(allowHTTP && u.Scheme == "http")) || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || strings.ContainsAny(raw, "\r\n\t ") || (rootOnly && u.Path != "" && u.Path != "/") {
		return httpx.Invalid("地址必须是无内嵌凭据的 HTTPS URL，HTTP 仅允许管理员显式放行的地址")
	}
	return nil
}
func Validate(kind string, p map[string]any) error {
	invalid := httpx.Invalid("凭据 payload 不符合对应 kind 的受限结构")
	text := func(k string) string { s, _ := p[k].(string); return s }
	exact := func(keys ...string) bool {
		if len(p) != len(keys) {
			return false
		}
		for _, k := range keys {
			if _, ok := p[k]; !ok {
				return false
			}
		}
		return true
	}
	switch kind {
	case "git":
		if !exact("username", "token") || text("username") == "" || text("token") == "" {
			return invalid
		}
	case "registry":
		if !exact("username", "password") || text("username") == "" || text("password") == "" {
			return invalid
		}
	case "kubeconfig":
		// A structured token+CA subset avoids executable auth plugins and all local file references.
		// Also accept inline mTLS and an explicit per-credential insecure TLS option.
		_, err := ParseKubernetes(p)
		return err
	case "secret":
		data, ok := p["data"].(map[string]any)
		if !exact("data") || !ok || len(data) == 0 || len(data) > 100 {
			return invalid
		}
		for k, v := range data {
			if k == "" || len(k) > 253 || strings.ContainsAny(k, "/\\\x00") {
				return invalid
			}
			if _, ok := v.(string); !ok {
				return invalid
			}
		}
	default:
		return invalid
	}
	for k, v := range p {
		if s, ok := v.(string); ok && (len(s) > 65536 || strings.ContainsRune(s, '\x00') || (k != "certificateAuthorityData" && strings.ContainsAny(s, "\r\n"))) {
			return invalid
		}
	}
	return nil
}
