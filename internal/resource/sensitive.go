package resource

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/kubernetes"
)

type SecretRevealInput struct {
	Ref    *Ref     `json:"ref"`
	Keys   []string `json:"keys"`
	Reason string   `json:"reason"`
}
type SecretRevealResult struct {
	Values map[string]string `json:"values"`
}

var secretKeyPattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,253}$`)

func sensitiveRef(ref *Ref, resource string, versionRequired bool) (ResourceType, url.Values, error) {
	t := ResourceType{Version: "v1", Resource: resource, Kind: "Pod", Namespaced: true, Verbs: []string{"get"}}
	if resource == "secrets" {
		t.Kind = "Secret"
	}
	if ref == nil || ref.Group != "" || ref.Version != "v1" || ref.Resource != resource || !validSegment(ref.Namespace, 63) || !validName(ref.Name) || ref.UID == "" || versionRequired && ref.ResourceVersion == "" {
		return t, nil, httpx.Invalid("必须提供目标 core/v1 资源的 namespace/name/UID 和有效版本")
	}
	for _, value := range []string{ref.UID, ref.ResourceVersion} {
		if len(value) > 256 || strings.ContainsAny(value, "\x00\r\n") {
			return t, nil, httpx.Invalid("资源身份无效")
		}
	}
	return t, url.Values{"namespace": {ref.Namespace}, "name": {ref.Name}, "uid": {ref.UID}, "resourceVersion": {ref.ResourceVersion}}, nil
}

// Exact namespace authorization precedes credential decryption and network I/O.
func (s *Service) sensitiveClient(ctx context.Context, a auth.Actor, id string, t ResourceType, values url.Values, action string) (snapshot, *kubernetes.Client, error) {
	if err := httpx.UUID(id); err != nil {
		return snapshot{}, nil, err
	}
	x, err := s.snapshot(ctx, a, id, false)
	if err == nil {
		err = scope(x, t, values, action, "get", true)
	}
	if err != nil {
		return x, nil, err
	}
	y, err := s.snapshot(ctx, a, id, true)
	if err == nil {
		err = recheckSnapshot(x, y)
	}
	if err != nil {
		return x, nil, err
	}
	c, err := kubernetes.New(y.payload)
	return y, c, err
}

func (s *Service) sensitiveAudit(ctx context.Context, a auth.Actor, x snapshot, action, requestID string, target any) error {
	_, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		if !a.ExpiresAt.IsZero() && !time.Now().Before(a.ExpiresAt) {
			return false, httpx.Fail(401, "unauthorized", "登录已失效")
		}
		now, e := s.lockedSnapshot(ctx, q, a, x.cluster.ID)
		if e == nil {
			e = recheckSnapshot(x, now)
		}
		if e != nil {
			return false, e
		}
		if !a.ExpiresAt.IsZero() && !time.Now().Before(a.ExpiresAt) {
			return false, httpx.Fail(401, "unauthorized", "登录已失效")
		}
		data, _ := json.Marshal(target)
		return true, q.RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &a.ID, ClusterID: &x.cluster.ID, Action: action, Target: data, Result: "accepted", RequestID: requestID})
	})
	return err
}

func (s *Service) RevealSecret(ctx context.Context, a auth.Actor, id string, in SecretRevealInput, requestID string) (SecretRevealResult, error) {
	out := SecretRevealResult{Values: map[string]string{}}
	t, values, err := sensitiveRef(in.Ref, "secrets", true)
	if err != nil {
		return out, err
	}
	if !utf8.ValidString(in.Reason) || len([]rune(strings.TrimSpace(in.Reason))) < 1 || len([]rune(in.Reason)) > 500 || len(in.Keys) < 1 || len(in.Keys) > 64 {
		return out, httpx.Invalid("需要 1–64 个唯一 key 及 1–500 字理由")
	}
	seen := map[string]bool{}
	for _, key := range in.Keys {
		if !secretKeyPattern.MatchString(key) || seen[key] {
			return out, httpx.Invalid("Secret key 无效或重复")
		}
		seen[key] = true
	}
	x, c, err := s.sensitiveClient(ctx, a, id, t, values, "secret.reveal")
	if err != nil {
		return out, err
	}
	defer c.Close()
	var raw map[string]any
	if err = c.Get(ctx, t.path(in.Ref.Namespace, in.Ref.Name), nil, &raw); err == nil {
		err = validateObject(t, raw, in.Ref.Namespace, in.Ref.Name)
	}
	if err == nil {
		err = checkIdentity(raw, values)
	}
	if err != nil {
		return out, err
	}
	total := 0
	for _, key := range in.Keys {
		value, ok := obj(raw, "data")[key].(string)
		if !ok {
			return SecretRevealResult{}, httpx.Fail(422, "secret_key_unavailable", "部分指定 Secret key 不存在或不可读取")
		}
		total += len(value)
		if total > 2<<20 {
			return SecretRevealResult{}, httpx.Fail(413, "secret_read_limit", "指定 Secret 内容超过读取预算")
		}
		if _, err = base64.StdEncoding.Strict().DecodeString(value); err != nil {
			return SecretRevealResult{}, httpx.Fail(503, "kubernetes_invalid_response", "Secret 内容编码无效")
		}
		out.Values[key] = value
	}
	// No secret value, key name or free-text reason enters storage or replay caches.
	err = s.sensitiveAudit(ctx, a, x, "secret.reveal", requestID, map[string]any{"ref": in.Ref, "keyCount": len(in.Keys), "reasonLength": len([]rune(in.Reason))})
	if err != nil {
		return SecretRevealResult{}, err
	}
	return out, nil
}

func (s *Service) registerSensitiveRoutes(r chi.Router) {
	r.Post("/secrets/reveal", func(w http.ResponseWriter, r *http.Request) {
		var in SecretRevealInput
		err := httpx.Decode(w, r, &in)
		if err == nil {
			_, err = query(r, "")
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := s.RevealSecret(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"), in, middleware.GetReqID(r.Context()))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.JSON(w, 200, out)
	})
	r.Post("/exec-sessions", s.createExecSession)
}
