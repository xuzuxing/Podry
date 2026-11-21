package application

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/idempotency"
	"github.com/xuzuxing/podry/internal/platform"
)

func buildResult(b sqlcdb.Build) idempotency.Result {
	body, _ := json.Marshal(buildDTO(b))
	return idempotency.Result{Status: 202, Body: body}
}

func (s *Service) CancelBuild(ctx context.Context, a auth.Actor, id, key, req string) (idempotency.Result, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
		b, err := q.GetBuild(ctx, id)
		if err != nil {
			return idempotency.Result{}, err
		}
		app, err := buildAccess(ctx, q, a, b.AppID)
		if err != nil {
			return idempotency.Result{}, err
		}
		b, err = q.LockBuild(ctx, id)
		if err != nil {
			return idempotency.Result{}, err
		}
		return idempotency.Execute(ctx, q, a.ID, "cancelBuild", key, "POST", "/api/builds/"+id+"/cancel", struct{}{}, func() (idempotency.Result, error) {
			row, err := q.LockBuildAttempt(ctx, sqlcdb.LockBuildAttemptParams{BuildID: id, AttemptNo: b.AttemptNo})
			if err != nil {
				return idempotency.Result{}, err
			}
			if row.Stage == "finished" || row.CancelRequestedAt != nil {
				return buildResult(b), nil
			}
			if err = mutable(app); err != nil {
				return idempotency.Result{}, err
			}
			immediate := row.Stage == "planned" && row.JobUid == nil && (row.LeaseExpiresAt == nil || row.LeaseExpiresAt.Before(time.Now()))
			if !immediate {
				if err = s.builds.Ready(); err != nil {
					return idempotency.Result{}, err
				}
			}
			row, err = q.RequestBuildCancel(ctx, sqlcdb.RequestBuildCancelParams{ID: row.ID, ActorID: a.ID})
			if err != nil {
				return idempotency.Result{}, err
			}
			if immediate {
				row, err = q.CancelUnclaimedBuildAttempt(ctx, row.ID)
				if err != nil {
					return idempotency.Result{}, err
				}
			}
			b.Status = row.Status
			if err = q.SetBuildState(ctx, sqlcdb.SetBuildStateParams{ID: id, Status: b.Status}); err != nil {
				return idempotency.Result{}, err
			}
			if err = record(ctx, q, a, app, "build.cancel", req, map[string]any{"buildId": id, "attemptId": row.ID}); err != nil {
				return idempotency.Result{}, err
			}
			return buildResult(b), nil
		})
	})
}

// Replays authorize scope, while new attempts also require all exact secret
// versions to remain decryptable. Rotation never substitutes a newer version.
func (s *Service) buildActionCredentials(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, spec build.ExecutionSpec, decrypt bool) error {
	p, err := q.GetProject(ctx, app.ProjectID)
	if err != nil {
		return err
	}
	refs := []struct {
		ref  *build.CredentialRef
		kind string
	}{{&spec.ClusterCredential, "kubeconfig"}, {spec.GitCredential, "git"}, {spec.RegistryCredential, "registry"}}
	for _, item := range refs {
		if item.ref == nil {
			continue
		}
		c, err := q.LockCredential(ctx, item.ref.ID)
		if err != nil {
			return err
		}
		if c.Kind != item.kind || (item.kind == "kubeconfig" && c.TeamID != nil) {
			return httpx.Fail(409, "execution_integrity_failed", "冻结凭据类型或范围不匹配")
		}
		if item.kind != "kubeconfig" {
			if err = platform.CredentialAccess(ctx, q, a, c, &p.TeamID, false); err != nil {
				return err
			}
		}
		if decrypt {
			v, err := q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: c.ID, Version: item.ref.Version})
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.Fail(409, "credential_version_unavailable", "冻结的凭据版本不可用")
			}
			if err != nil {
				return err
			}
			if _, err = s.vault.Open(c.ID, item.ref.Version, v.KeyID, v.EncryptedPayload); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) RetryBuild(ctx context.Context, a auth.Actor, id, key, req string) (idempotency.Result, error) {
	var source sqlcdb.BuildAttempt
	var spec build.ExecutionSpec
	// Serialize admission in both phases. The external exit check runs between
	// transactions and cannot reserve an idempotency key or hold database locks.
	phase := func(final bool) (idempotency.Result, bool, error) {
		type outcome struct {
			result idempotency.Result
			done   bool
		}
		out, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (outcome, error) {
			b, err := q.GetBuild(ctx, id)
			if err != nil {
				return outcome{}, err
			}
			app, err := buildAccess(ctx, q, a, b.AppID)
			if err != nil {
				return outcome{}, err
			}
			b, err = q.LockBuild(ctx, id)
			if err != nil {
				return outcome{}, err
			}
			path := "/api/builds/" + id + "/retry"
			replay, found, err := idempotency.Lookup(ctx, q, a.ID, "retryBuild", key, "POST", path, struct{}{})
			if err != nil {
				return outcome{}, err
			}
			if found {
				var stored build.Build
				if err = json.Unmarshal(replay.Body, &stored); err != nil {
					return outcome{}, err
				}
				row, err := q.GetBuildAttempt(ctx, sqlcdb.GetBuildAttemptParams{BuildID: id, AttemptNo: stored.AttemptNo})
				if err != nil {
					return outcome{}, err
				}
				frozen, err := build.DecodeExecution(b, row)
				if err != nil {
					return outcome{}, err
				}
				if err = s.buildActionCredentials(ctx, q, a, app, frozen, false); err != nil {
					return outcome{}, err
				}
				return outcome{replay, true}, nil
			}
			if err = mutable(app); err != nil {
				return outcome{}, err
			}
			if b.Status == "unknown" {
				return outcome{}, httpx.Fail(409, "outcome_unknown", "构建结果尚未确定，不能重试")
			}
			if (b.Status != "failed" && b.Status != "canceled") || b.ArtifactID != nil {
				return outcome{}, httpx.Fail(409, "build_not_retryable", "只能重试失败或已取消的构建")
			}
			if err = s.builds.Ready(); err != nil {
				return outcome{}, err
			}
			row, err := q.LockBuildAttempt(ctx, sqlcdb.LockBuildAttemptParams{BuildID: id, AttemptNo: b.AttemptNo})
			if err != nil {
				return outcome{}, err
			}
			if row.Stage != "finished" || row.Status != b.Status || (row.LeaseExpiresAt != nil && row.LeaseExpiresAt.After(time.Now())) {
				return outcome{}, httpx.Fail(409, "build_exit_unconfirmed", "旧构建任务尚未确认退出")
			}
			busy, err := q.OtherActiveBuildAttempt(ctx, sqlcdb.OtherActiveBuildAttemptParams{BuildID: id, AttemptNo: b.AttemptNo})
			if err != nil {
				return outcome{}, err
			}
			if busy {
				return outcome{}, httpx.Fail(409, "build_exit_unconfirmed", "历史尝试尚未退出")
			}
			frozen, err := build.DecodeExecution(b, row)
			if err != nil {
				return outcome{}, err
			}
			pipeline, _, err := enabledCI(ctx, q, app.ID)
			if err != nil {
				return outcome{}, err
			}
			if pipeline.ID != b.PipelineID {
				return outcome{}, httpx.Fail(409, "revision_conflict", "原 CI 流水线已不可用")
			}
			if err = s.buildActionCredentials(ctx, q, a, app, frozen, true); err != nil {
				return outcome{}, err
			}
			if err = s.urlPolicy.Validate(frozen.RepositoryURL, false); err != nil {
				return outcome{}, err
			}
			if err = s.urlPolicy.Validate(frozen.RegistryEndpoint, true); err != nil {
				return outcome{}, err
			}
			if !final {
				source = row
				spec = frozen
				return outcome{}, nil
			}
			if source.ID != row.ID || source.Revision != row.Revision || source.ExecutionHash != row.ExecutionHash {
				return outcome{}, httpx.Fail(409, "revision_conflict", "构建尝试已变化，请重新重试")
			}
			result, err := idempotency.Execute(ctx, q, a.ID, "retryBuild", key, "POST", path, struct{}{}, func() (idempotency.Result, error) {
				next, err := q.RetryBuild(ctx, sqlcdb.RetryBuildParams{ID: id, AttemptNo: b.AttemptNo})
				if err != nil {
					return idempotency.Result{}, err
				}
				frozen.AttemptID = uuid.NewString()
				frozen.JobName = "podry-build-" + frozen.AttemptID
				frozen.RequestedBy = a.ID
				raw, _ := json.Marshal(frozen)
				_, err = q.CreateRetryBuildAttempt(ctx, sqlcdb.CreateRetryBuildAttemptParams{ID: frozen.AttemptID, BuildID: id, AttemptNo: next.AttemptNo, BuildClusterID: frozen.ClusterID, Namespace: frozen.Namespace, JobName: frozen.JobName, ExecutionSpec: raw, ExecutionHash: build.Hash(frozen)})
				if err != nil {
					return idempotency.Result{}, err
				}
				if err = record(ctx, q, a, app, "build.retry", req, map[string]any{"buildId": id, "sourceAttemptId": source.ID, "attemptId": frozen.AttemptID}); err != nil {
					return idempotency.Result{}, err
				}
				return buildResult(next), nil
			})
			return outcome{result, true}, err
		})
		return out.result, out.done, err
	}
	result, done, err := phase(false)
	if err != nil || done {
		return result, err
	}
	checkCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err = s.builds.VerifyRetryExit(checkCtx, spec, source); err != nil {
		return idempotency.Result{}, err
	}
	result, _, err = phase(true)
	return result, err
}
