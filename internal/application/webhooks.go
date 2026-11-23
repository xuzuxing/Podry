package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
)

type WebhookResult struct {
	DeliveryID string  `json:"deliveryId"`
	Status     string  `json:"status"`
	BuildID    *string `json:"buildId"`
}

// A Push delegation is independent of browser token expiry/logout. Account disable
// and current project/credential permissions are checked for every admission.
func savePushAuthorization(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, id string, version int32, ci CI, c Config) error {
	if !ci.Push {
		return q.DeletePushAuthorization(ctx, id)
	}
	return q.SavePushAuthorization(ctx, sqlcdb.SavePushAuthorizationParams{PipelineID: id, AuthorizedBy: a.ID, PipelineVersion: version, RepositoryUrl: c.GitConfig.RepositoryURL})
}

func (s *Service) validatePushCI(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, ci CI, c Config) error {
	if err := validateCI(ci, c); err != nil || !ci.Push {
		return err
	}
	if err := httpx.UUID(*ci.WebhookCredentialID); err != nil {
		return err
	}
	role, err := project.ProjectRole(ctx, q, a, app.ProjectID)
	if err != nil {
		return err
	}
	if err = project.RequireRole(role, "build"); err != nil {
		return err
	}
	_, _, err = s.pushSecret(ctx, q, a, app, *ci.WebhookCredentialID)
	return err
}

// Webhook signing uses a dedicated, scoped Secret with data.webhookSecret.
// It is never a Git credential and is never included in the runner execution spec.
func (s *Service) pushSecret(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, id string) (sqlcdb.Credential, webhookSecret, error) {
	var empty webhookSecret
	c, err := q.GetCredential(ctx, id)
	if err != nil {
		return c, empty, err
	}
	p, err := q.GetProject(ctx, app.ProjectID)
	if err != nil {
		return c, empty, err
	}
	if c.Kind != "secret" {
		return c, empty, httpx.Invalid("Webhook 需要独立 secret 凭据")
	}
	if err = platform.CredentialAccess(ctx, q, a, c, &p.TeamID, false); err != nil {
		return c, empty, err
	}
	v, err := q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: c.ID, Version: c.Version})
	if err != nil {
		return c, empty, err
	}
	payload, err := s.vault.Open(c.ID, c.Version, v.KeyID, v.EncryptedPayload)
	if err != nil {
		return c, empty, err
	}
	data, _ := payload["data"].(map[string]any)
	secret, _ := data["webhookSecret"].(string)
	mode, hasMode := data["webhookAuthMode"]
	modeString, validMode := mode.(string)
	fields := 1
	if hasMode {
		fields++
	}
	if len(payload) != 1 || len(data) != fields || len(secret) < 32 || len(secret) > 256 || strings.ContainsAny(secret, "\x00\r\n") ||
		hasMode && (!validMode || modeString != "signature" && modeString != "token") {
		return c, empty, httpx.Invalid("Webhook Secret 需要 data.webhookSecret（32–256 字节单行字符串），可选 webhookAuthMode=signature/token")
	}
	return c, webhookSecret{Value: []byte(secret), Mode: modeString}, nil
}

func (s *Service) RegisterWebhooks(r chi.Router) {
	r.Post("/webhooks/git/{provider}/{pipelineId}", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "pipelineId")
		provider := chi.URLParam(r, "provider")
		if !supportedWebhookProvider(provider) {
			httpx.WriteError(w, r, unsupportedWebhookProvider())
			return
		}
		if err := httpx.UUID(id); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || media != "application/json" {
			httpx.WriteError(w, r, httpx.Fail(415, "unsupported_media_type", "Webhook 必须使用 application/json"))
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
		if err != nil {
			var large *http.MaxBytesError
			if errors.As(err, &large) {
				err = httpx.Fail(413, "payload_too_large", "Webhook 请求体过大")
			} else {
				err = httpx.Invalid("无法读取 Webhook 请求体")
			}
			httpx.WriteError(w, r, err)
			return
		}
		out, err := s.ReceiveGitWebhook(r.Context(), provider, id, r.Header, body, middleware.GetReqID(r.Context()))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.JSON(w, http.StatusAccepted, out)
	})
}

func singleHeader(h http.Header, key string) (string, error) {
	v := h.Values(key)
	if len(v) != 1 || v[0] == "" || len(v[0]) > 128 {
		return "", httpx.Invalid("Webhook 身份、事件或签名头无效")
	}
	return v[0], nil
}

func (s *Service) ReceiveGitHubWebhook(ctx context.Context, pipelineID string, headers http.Header, body []byte, req string) (WebhookResult, error) {
	return s.ReceiveGitWebhook(ctx, "github", pipelineID, headers, body, req)
}

func (s *Service) ReceiveGitWebhook(ctx context.Context, provider, pipelineID string, headers http.Header, body []byte, req string) (WebhookResult, error) {
	var empty WebhookResult
	if len(body) > 1<<20 {
		return empty, httpx.Fail(413, "payload_too_large", "Webhook 请求体过大")
	}
	envelope, err := readWebhookEnvelope(provider, headers)
	if err != nil {
		return empty, err
	}
	// Lookup only routes the request; the authorization and pipeline are reread
	// after taking the same user/team/project/application locks as manual builds.
	before, err := s.q.GetPushAuthorization(ctx, pipelineID)
	if err != nil {
		return empty, err
	}
	pipeline, err := s.q.GetPipeline(ctx, pipelineID)
	if err != nil {
		return empty, err
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (WebhookResult, error) {
		u, err := q.LockUser(ctx, before.AuthorizedBy)
		if err != nil {
			return empty, err
		}
		if u.DisabledAt != nil {
			return empty, httpx.NotFound()
		}
		a := auth.Actor{User: auth.Public(u), TokenVersion: u.TokenVersion}
		app, err := buildAccess(ctx, q, a, pipeline.AppID)
		if err != nil {
			return empty, err
		}
		delegation, err := q.GetPushAuthorization(ctx, pipelineID)
		if err != nil {
			return empty, err
		}
		p, err := q.GetPipeline(ctx, pipelineID)
		if err != nil {
			return empty, err
		}
		if delegation.AuthorizedBy != before.AuthorizedBy || delegation.PipelineVersion != p.Version {
			return empty, httpx.Fail(409, "revision_conflict", "Webhook 授权已变化，请重新投递")
		}
		var ci CI
		if p.Kind != "ci" || !p.Enabled || json.Unmarshal(p.Definition, &ci) != nil || !ci.Push || ci.WebhookCredentialID == nil {
			return empty, httpx.NotFound()
		}
		cr, secret, err := s.pushSecret(ctx, q, a, app, *ci.WebhookCredentialID)
		if err != nil {
			return empty, err
		}
		if err = envelope.verify(secret, body); err != nil {
			return empty, err
		}
		// Include the event header: GitHub signs the body, not the delivery/event
		// headers. Reusing a delivery with a different event must also conflict.
		// Gitee has no stable delivery header. Its identity excludes rotating
		// authentication fields, so retries remain idempotent after re-signing.
		hashBody, err := envelope.identityBody(body)
		if err != nil {
			return empty, err
		}
		sum := sha256.Sum256(append([]byte(envelope.Event+"\x00"), hashBody...))
		hash := hex.EncodeToString(sum[:])
		deliveryID := envelope.DeliveryID
		if provider == "gitee" {
			deliveryID = "sha256:" + hash
		}
		old, err := q.GetWebhookDelivery(ctx, sqlcdb.GetWebhookDeliveryParams{Provider: provider, PipelineID: pipelineID, DeliveryID: deliveryID})
		if err == nil {
			if old.RequestHash != hash {
				return empty, httpx.Fail(409, "webhook_delivery_conflict", "同一投递标识不能用于不同请求")
			}
			locked, err := q.LockCredential(ctx, cr.ID)
			if err != nil {
				return empty, err
			}
			if locked.Version != cr.Version {
				return empty, httpx.Fail(409, "revision_conflict", "Webhook 凭据已轮换，请重新投递")
			}
			return WebhookResult{old.DeliveryID, old.Status, old.BuildID}, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return empty, err
		}
		if err = mutable(app); err != nil {
			return empty, err
		}
		current, err := readConfig(ctx, q, app.ID, 0)
		if err != nil {
			return empty, err
		}
		if err = validateCI(ci, current); err != nil {
			return empty, httpx.Fail(409, "revision_conflict", "CI 与当前 Git 配置不一致，请重新保存工作流")
		}
		if current.GitConfig.RepositoryURL != delegation.RepositoryUrl {
			return empty, httpx.Fail(409, "revision_conflict", "仓库已变化，请重新保存工作流授权")
		}
		sha, accept, err := webhookPush(provider, envelope.Event, body, current.GitConfig.RepositoryURL, ci.Branch)
		if err != nil {
			return empty, err
		}
		out := WebhookResult{DeliveryID: deliveryID, Status: "ignored"}
		if accept {
			if err = s.builds.Ready(); err != nil {
				return empty, err
			}
			if current.BuildConfig == nil {
				return empty, httpx.Fail(422, "prerequisite_missing", "请先保存构建配置")
			}
			gitVersion := int32(0)
			if current.GitConfig.CredentialID != nil {
				gitCredential, err := q.GetCredential(ctx, *current.GitConfig.CredentialID)
				if err != nil {
					return empty, err
				}
				gitVersion = gitCredential.Version
			}
			spec, err := s.planBuild(ctx, q, a, app, current, gitVersion, sha)
			if err != nil {
				return empty, err
			}
			b, err := q.CreateBuild(ctx, sqlcdb.CreateBuildParams{ID: spec.BuildID, AppID: app.ID, PipelineID: p.ID, ConfigVersion: current.Version, CommitSha: sha, RequestedBy: a.ID})
			if err != nil {
				return empty, err
			}
			raw, err := json.Marshal(spec)
			if err != nil {
				return empty, err
			}
			if _, err = q.CreateBuildAttempt(ctx, sqlcdb.CreateBuildAttemptParams{ID: spec.AttemptID, BuildID: b.ID, BuildClusterID: spec.ClusterID, Namespace: spec.Namespace, JobName: spec.JobName, ExecutionSpec: raw, ExecutionHash: build.Hash(spec)}); err != nil {
				return empty, err
			}
			out.Status, out.BuildID = "accepted", &b.ID
		}
		// Rotation may have happened after verification. Lock and compare before
		// committing either the delivery or the build, so old signatures cannot win.
		locked, err := q.LockCredential(ctx, cr.ID)
		if err != nil {
			return empty, err
		}
		if locked.Version != cr.Version {
			return empty, httpx.Fail(409, "revision_conflict", "Webhook 凭据已轮换，请重新投递")
		}
		if _, err = q.CreateWebhookDelivery(ctx, sqlcdb.CreateWebhookDeliveryParams{ID: uuid.NewString(), Provider: provider, PipelineID: p.ID, DeliveryID: deliveryID, RequestHash: hash, BuildID: out.BuildID, Status: out.Status}); err != nil {
			return empty, err
		}
		if err = record(ctx, q, a, app, "webhook."+out.Status, req, map[string]any{"pipelineId": p.ID, "deliveryId": deliveryID, "buildId": out.BuildID, "provider": provider}); err != nil {
			return empty, err
		}
		return out, nil
	})
}

// Read selected keys by exact name. Provider payloads may add fields, but JSON
// duplicate keys, alias fields and invalid scalar types cannot change admission.
func webhookPush(provider, event string, body []byte, repository, branch string) (string, bool, error) {
	if err := httpx.ValidateJSONObject(body); err != nil {
		return "", false, err
	}
	pushEvent := "push"
	if provider == "gitlab" || provider == "gitee" {
		pushEvent = "Push Hook"
	}
	if event != pushEvent {
		return "", false, nil
	}
	var payload map[string]json.RawMessage
	_ = json.Unmarshal(body, &payload)
	var ref, sha string
	var deleted bool
	var repo map[string]json.RawMessage
	var cloneURL string
	repoField, urlField := "repository", "clone_url"
	if provider == "gitlab" {
		repoField, urlField = "project", "git_http_url"
		var kind string
		if json.Unmarshal(payload["object_kind"], &kind) != nil || kind != "push" {
			return "", false, httpx.Invalid("GitLab Push object_kind 必须为 push")
		}
	} else if _, present := payload["deleted"]; provider != "gitea" || present {
		if string(payload["deleted"]) == "null" || json.Unmarshal(payload["deleted"], &deleted) != nil {
			return "", false, httpx.Invalid("Push 需要 boolean deleted")
		}
	}
	if json.Unmarshal(payload["ref"], &ref) != nil || ref == "" || json.Unmarshal(payload["after"], &sha) != nil ||
		json.Unmarshal(payload[repoField], &repo) != nil || json.Unmarshal(repo[urlField], &cloneURL) != nil || cloneURL == "" {
		return "", false, httpx.Invalid("Push 缺少 ref/after 或仓库 HTTP clone 地址")
	}
	if !webhookSHA.MatchString(sha) {
		return "", false, httpx.Invalid("Push after 必须为完整小写 SHA-1")
	}
	if !sameRepository(repository, cloneURL) || ref != "refs/heads/"+branch || deleted || sha == strings.Repeat("0", 40) {
		return "", false, nil
	}
	return sha, true, nil
}

func sameRepository(configured, incoming string) bool {
	canonical := func(raw string) string {
		u, err := url.Parse(raw)
		if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return ""
		}
		return u.Scheme + "://" + strings.ToLower(u.Host) + strings.TrimSuffix(strings.TrimSuffix(u.EscapedPath(), "/"), ".git")
	}
	a, b := canonical(configured), canonical(incoming)
	return a != "" && a == b
}
