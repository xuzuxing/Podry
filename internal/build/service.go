package build

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/project"
)

type Service struct {
	pool              *pgxpool.Pool
	q                 *sqlcdb.Queries
	vault             *credential.Vault
	Settings          Settings
	RegistryTransport http.RoundTripper
}

func New(pool *pgxpool.Pool, vault *credential.Vault, settings Settings) *Service {
	return &Service{pool: pool, q: sqlcdb.New(pool), vault: vault, Settings: settings}
}
func (s *Service) Ready() error {
	if s == nil || !s.Settings.Enabled {
		return httpx.Fail(503, "build_environment_unavailable", "构建执行环境尚未启用")
	}
	return s.Settings.Validate()
}
func (s *Service) Secret(ctx context.Context, ref CredentialRef) (map[string]any, error) {
	v, e := s.q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: ref.ID, Version: ref.Version})
	if e != nil {
		return nil, e
	}
	return s.vault.Open(ref.ID, ref.Version, v.KeyID, v.EncryptedPayload)
}

type stepResult struct{ stage, status, uid, code, digest, availability string }

func ptr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Every external step is bounded to 20 seconds; a lease lasts 60 seconds.
// Lease expiry permits observation, never replay of an ambiguous Job creation.
func (s *Service) ProcessOne(ctx context.Context) (bool, error) {
	return s.processOne(ctx, ctx)
}

func (s *Service) processOne(claimCtx, ctx context.Context) (bool, error) {
	owner := uuid.NewString()
	row, e := s.q.ClaimBuildAttempt(claimCtx, &owner)
	if errors.Is(e, pgx.ErrNoRows) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	var spec ExecutionSpec
	if json.Unmarshal(row.ExecutionSpec, &spec) != nil || spec.Version != 1 || Hash(spec) != row.ExecutionHash {
		return true, s.finish(ctx, row, stepResult{stage: "finished", status: "failed", code: "execution_integrity_failed", availability: "unavailable"})
	}
	stepCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if row.CancelRequestedAt != nil {
		return true, s.finish(ctx, row, s.cancelStep(stepCtx, spec, row))
	}
	// After submission, revocation must not hide an existing external outcome.
	if row.Stage == "planned" {
		if e = s.authorize(stepCtx, spec); e != nil {
			result := authorizationFailure(e, row.Stage)
			return true, s.finish(ctx, row, result)
		}
	}
	create := row.Stage == "planned"
	if create {
		marked, err := s.q.MarkBuildCreateIntent(ctx, sqlcdb.MarkBuildCreateIntentParams{ID: row.ID, Revision: row.Revision, LeaseOwner: &owner})
		if errors.Is(err, pgx.ErrNoRows) {
			return true, s.finish(ctx, row, stepResult{stage: row.Stage, status: row.Status, availability: row.LogAvailability})
		}
		row, e = marked, err
		if e != nil {
			return true, e
		}
	}
	result := s.step(stepCtx, spec, row, create)
	if ctx.Err() != nil {
		return true, ctx.Err()
	}
	return true, s.finish(ctx, row, result)
}
func authorizationFailure(err error, stage string) stepResult {
	var api *httpx.Error
	if errors.Is(err, pgx.ErrNoRows) || (errors.As(err, &api) && (api.Status == 403 || api.Status == 404)) {
		return stepResult{stage: "finished", status: "failed", code: "execution_authorization_revoked", availability: "unavailable"}
	}
	return stepResult{stage: stage, status: "unknown", code: "execution_authorization_unavailable", availability: "unavailable"}
}
func (s *Service) authorize(ctx context.Context, spec ExecutionSpec) error {
	user, e := s.q.GetUser(ctx, spec.RequestedBy)
	if e != nil {
		return e
	}
	if user.DisabledAt != nil {
		return httpx.Forbidden()
	}
	app, e := s.q.GetApplication(ctx, spec.AppID)
	if e != nil {
		return e
	}
	if app.ArchivedAt != nil {
		return httpx.Forbidden()
	}
	a := auth.Actor{User: auth.Public(user), TokenVersion: user.TokenVersion}
	role, e := project.ProjectRole(ctx, s.q, a, app.ProjectID)
	if e != nil {
		return e
	}
	return project.RequireRole(role, "build")
}
func (s *Service) finish(ctx context.Context, row sqlcdb.BuildAttempt, r stepResult) error {
	_, e := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		b, e := q.LockBuild(ctx, row.BuildID)
		if e != nil {
			return false, e
		}
		if b.AttemptNo != row.AttemptNo {
			return false, pgx.ErrNoRows
		}
		current, e := q.LockBuildAttempt(ctx, sqlcdb.LockBuildAttemptParams{BuildID: row.BuildID, AttemptNo: row.AttemptNo})
		if e != nil {
			return false, e
		}
		// Preserve intent recorded during an in-flight external step without
		// discarding its discovered UID or verified terminal outcome.
		if current.CancelRequestedAt != nil && r.stage != "finished" && r.status != "unknown" {
			r.status = "canceling"
		}
		updated, e := q.TransitionBuildAttempt(ctx, sqlcdb.TransitionBuildAttemptParams{ID: row.ID, Revision: row.Revision, LeaseOwner: row.LeaseOwner, Stage: r.stage, Status: r.status, JobUid: ptr(r.uid), ErrorCode: ptr(r.code), LogAvailability: r.availability})
		if e != nil {
			return false, e
		}
		var artifactID *string
		if r.status == "succeeded" {
			b, e := q.GetBuild(ctx, row.BuildID)
			if e != nil {
				return false, e
			}
			var spec ExecutionSpec
			_ = json.Unmarshal(row.ExecutionSpec, &spec)
			a, e := q.CreateArtifact(ctx, sqlcdb.CreateArtifactParams{ID: uuid.NewString(), AppID: b.AppID, BuildID: &b.ID, AttemptID: &row.ID, ImageRepository: registryRepository(spec), Digest: r.digest})
			if e != nil {
				return false, e
			}
			artifactID = &a.ID
		}
		if e = q.SetBuildState(ctx, sqlcdb.SetBuildStateParams{ID: row.BuildID, Status: r.status, ArtifactID: artifactID}); e != nil {
			return false, e
		}
		app, e := q.GetApplication(ctx, b.AppID)
		if e != nil {
			return false, e
		}
		p, e := q.GetProject(ctx, app.ProjectID)
		if e != nil {
			return false, e
		}
		if updated.Stage == "finished" || row.Status != updated.Status {
			var spec ExecutionSpec
			_ = json.Unmarshal(row.ExecutionSpec, &spec)
			actorID := spec.RequestedBy
			if actorID == "" {
				actorID = b.RequestedBy
			}
			e = project.Record(ctx, q, auth.Actor{User: auth.User{ID: actorID}}, &p.TeamID, &p.ID, "build."+r.status, "worker", map[string]any{"buildId": b.ID, "attemptId": row.ID, "errorCode": r.code})
		}
		return true, e
	})
	return e
}

func (s *Service) Run(ctx context.Context) {
	s.RunDraining(ctx, ctx)
}

// RunDraining stops claiming on drain cancellation. An already claimed step may
// finish and persist its result until work is canceled by the shutdown deadline.
func (s *Service) RunDraining(drain, work context.Context) {
	if s.Ready() != nil {
		return
	}
	var wg sync.WaitGroup
	for range s.Settings.Concurrency {
		wg.Go(func() {
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			for {
				if drain.Err() != nil || work.Err() != nil {
					return
				}
				if _, e := s.processOne(drain, work); e != nil && drain.Err() == nil && work.Err() == nil {
					slog.Warn("build reconciliation failed", "error_type", "bounded_step")
				}
				// Archive acquisition and retention are new work, not part of the
				// claimed execution step. Leave them for restart when draining.
				if drain.Err() == nil && work.Err() == nil {
					archiveCtx, cancel := context.WithTimeout(drain, 20*time.Second)
					_ = s.ArchiveOne(archiveCtx)
					_ = s.PurgeExpiredArchives(archiveCtx)
					cancel()
				}
				select {
				case <-drain.Done():
					return
				case <-work.Done():
					return
				case <-ticker.C:
				}
			}
		})
	}
	wg.Wait()
}
