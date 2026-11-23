// Package cleanup reclaims exact, platform-owned external execution resources.
// It never deletes business history or clears an execution lease/target hold.
package cleanup

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/release"
)

type Settings struct {
	Enabled                          bool
	BuildRetention, ReleaseRetention time.Duration
}

func (s Settings) Validate() error {
	if !s.Enabled {
		return nil
	}
	if s.BuildRetention < time.Hour || s.BuildRetention > 90*24*time.Hour || s.ReleaseRetention < 7*24*time.Hour || s.ReleaseRetention > 90*24*time.Hour {
		return errors.New("cleanup retention must be 1h..2160h for builds and 168h..2160h for releases")
	}
	return nil
}

type Service struct {
	pool     *pgxpool.Pool
	builds   *build.Service
	releases *release.Service
	settings Settings
}

func New(pool *pgxpool.Pool, builds *build.Service, releases *release.Service, settings Settings) *Service {
	return &Service{pool: pool, builds: builds, releases: releases, settings: settings}
}

func classification(err error) *string {
	if err == nil {
		return nil
	}
	code := "cleanup_evidence_unavailable"
	var api *httpx.Error
	if errors.As(err, &api) {
		code = api.Code
	}
	return &code
}

func record(ctx context.Context, q *sqlcdb.Queries, cluster, id, action string, err error) error {
	target, _ := json.Marshal(map[string]any{"executionId": id, "errorCode": classification(err)})
	result := "succeeded"
	if err != nil {
		result = "unknown"
	}
	return q.RecordAudit(ctx, sqlcdb.RecordAuditParams{ClusterID: &cluster, Action: action, RequestID: "cleanup-worker", Target: target, Result: result})
}

// A bounded transaction owns each resource cleanup step. SKIP LOCKED prevents
// two instances from deleting the same execution concurrently, with no lease to
// expire while a stale deleter is still running. Crash rolls scheduling back;
// restart rereads exact external identities before any conditional delete.
func (s *Service) ProcessBuild(ctx context.Context) (bool, error) {
	return s.processBuild(ctx, ctx)
}

func (s *Service) processBuild(claimCtx, ctx context.Context) (bool, error) {
	if s == nil || !s.settings.Enabled {
		return false, nil
	}
	if err := s.settings.Validate(); err != nil {
		return false, err
	}
	step, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	claim, cancelClaim := context.WithTimeout(claimCtx, 20*time.Second)
	defer cancelClaim()
	return database.Tx(step, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		row, err := q.NextBuildResourceCleanup(claim, int32(s.settings.BuildRetention/time.Second))
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		result := s.builds.CleanupResources(step, q, row)
		if err = q.CompleteBuildResourceCleanup(step, sqlcdb.CompleteBuildResourceCleanupParams{ID: row.ID, ErrorCode: classification(result), Completed: result == nil}); err != nil {
			return true, err
		}
		return true, record(step, q, row.BuildClusterID, row.ID, "build.resources.cleanup", result)
	})
}

func (s *Service) ProcessRelease(ctx context.Context) (bool, error) {
	return s.processRelease(ctx, ctx)
}

func (s *Service) processRelease(claimCtx, ctx context.Context) (bool, error) {
	if s == nil || !s.settings.Enabled {
		return false, nil
	}
	if err := s.settings.Validate(); err != nil {
		return false, err
	}
	step, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	claim, cancelClaim := context.WithTimeout(claimCtx, 20*time.Second)
	defer cancelClaim()
	q := sqlcdb.New(s.pool)
	rows, err := q.ReleaseResourceCleanupCandidates(claim, int32(s.settings.ReleaseRetention/time.Second))
	if err != nil {
		return false, err
	}
	for _, candidate := range rows {
		processed, err := database.Tx(step, s.pool, func(q *sqlcdb.Queries) (bool, error) {
			if _, err := q.LockCleanupApplication(claim, candidate.AppID); err != nil {
				return false, err
			}
			if _, err := q.LockCleanupCluster(claim, candidate.ClusterID); err != nil {
				return false, err
			}
			if _, err := q.LockCleanupTarget(claim, candidate.TargetID); err != nil {
				return false, err
			}
			if _, err := q.LockCleanupDeployment(claim, candidate.ID); err != nil {
				return false, err
			}
			allowed, err := q.ReleaseResourceCleanupAllowed(claim, sqlcdb.ReleaseResourceCleanupAllowedParams{ID: candidate.ID, RetentionSeconds: int32(s.settings.ReleaseRetention / time.Second)})
			if err != nil || !allowed {
				return false, err
			}
			result := s.releases.CleanupResources(step, q, candidate.ID)
			if err = q.CompleteReleaseResourceCleanup(step, sqlcdb.CompleteReleaseResourceCleanupParams{ID: candidate.ID, ErrorCode: classification(result), Completed: result == nil}); err != nil {
				return true, err
			}
			return true, record(step, q, candidate.ClusterID, candidate.ID, "deployment.resources.cleanup", result)
		})
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil || processed {
			return processed, err
		}
	}
	return false, nil
}

func (s *Service) RunDraining(drain, work context.Context) {
	if s == nil || !s.settings.Enabled || s.settings.Validate() != nil {
		return
	}
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		for _, process := range []func(context.Context, context.Context) (bool, error){s.processBuild, s.processRelease} {
			if drain.Err() != nil || work.Err() != nil {
				return
			}
			if _, err := process(drain, work); err != nil && drain.Err() == nil && work.Err() == nil {
				slog.Warn("resource cleanup deferred", "error_type", "bounded_step")
			}
		}
		select {
		case <-drain.Done():
			return
		case <-work.Done():
			return
		case <-ticker.C:
		}
	}
}
