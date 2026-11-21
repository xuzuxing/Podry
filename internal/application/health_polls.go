package application

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
)

var errHealthLeaseLost = errors.New("health observation lease lost")

// ProcessHealthOne refreshes one due binding. The operator's opt-in enables
// reads using the latest release requester's current app/resource permissions;
// browser tokens and build/release execution switches are independent.
func (s *Service) ProcessHealthOne(ctx context.Context) (bool, error) {
	if !s.HealthPollingEnabled {
		return false, nil
	}
	token := uuid.NewString()
	poll, err := s.q.ClaimHealthPoll(ctx, &token)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	step, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	var actor auth.Actor
	var appID string
	before, err := database.Tx(step, s.pool, func(q *sqlcdb.Queries) (applicationRead, error) {
		var e error
		appID, e = q.GetHealthPollApp(step, poll.BindingID)
		if e != nil {
			return applicationRead{}, e
		}
		latest, e := q.LatestBindingDeployment(step, poll.BindingID)
		if e != nil {
			return applicationRead{}, e
		}
		request, e := q.GetReleaseRequest(step, latest.RequestID)
		if e != nil {
			return applicationRead{}, e
		}
		actor, e = autoActor(step, q, request.RequestedBy)
		if e != nil {
			return applicationRead{}, e
		}
		state, e := s.readApplicationResources(step, q, actor, appID, poll.BindingID)
		if e != nil {
			return state, e
		}
		app, e := q.GetApplication(step, appID)
		if e != nil {
			return state, e
		}
		if e = mutable(app); e != nil {
			return state, e
		}
		// New requests must supply their own real actor. Unknown or queued
		// executions have no stable workload observation to refresh yet.
		if state.Latest.ID != latest.ID || state.Latest.Status == "unknown" || state.Latest.Status == "queued" || len(state.Roots) == 0 {
			return state, httpx.Fail(409, "health_not_ready", "尚无可观察的当前执行资源")
		}
		return state, nil
	})
	if err == nil {
		_, err = s.observeResources(step, actor, appID, poll.BindingID, before, func(q *sqlcdb.Queries, readErr error) error {
			app, e := q.GetApplication(step, appID)
			if e != nil {
				return e
			}
			if e = mutable(app); e != nil {
				return e
			}
			if e = finishHealthPoll(step, q, poll, healthErrorCode(readErr)); e != nil {
				return e
			}
			// A fully filtered read has no credential/observation to save. It
			// must still remove the older healthy cache in this transaction.
			return q.InvalidatePolledHealth(step, sqlcdb.InvalidatePolledHealthParams{BindingID: poll.BindingID, StartedAt: *poll.StartedAt})
		})
	}
	if err == nil {
		return true, nil
	}
	if ctx.Err() != nil {
		// Abandoned claims expire. Shutdown never extends the shared deadline.
		return true, ctx.Err()
	}
	// Failure invalidates older cache data without publishing any result from
	// an unauthorized or stale read. A newer interactive observation survives.
	_, persistErr := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		if _, e := q.LockHealthPoll(ctx, sqlcdb.LockHealthPollParams{BindingID: poll.BindingID, LeaseToken: poll.LeaseToken}); errors.Is(e, pgx.ErrNoRows) {
			return false, nil // Already completed, expired or reclaimed.
		} else if e != nil {
			return false, e
		}
		if e := q.InvalidatePolledHealth(ctx, sqlcdb.InvalidatePolledHealthParams{BindingID: poll.BindingID, StartedAt: *poll.StartedAt}); e != nil {
			return false, e
		}
		return true, finishHealthPoll(ctx, q, poll, healthErrorCode(err))
	})
	if errors.Is(persistErr, errHealthLeaseLost) {
		return true, nil
	}
	return true, persistErr
}

func healthErrorCode(err error) *string {
	if err == nil {
		return nil
	}
	code := "health_observation_failed"
	var api *httpx.Error
	if errors.Is(err, pgx.ErrNoRows) {
		code = "health_not_ready"
	} else if errors.As(err, &api) {
		switch api.Status {
		case 401, 403, 404:
			code = "health_access_denied"
		case 409:
			code = "health_state_changed"
		}
	}
	return &code
}

func finishHealthPoll(ctx context.Context, q *sqlcdb.Queries, poll sqlcdb.BindingHealthPoll, code *string) error {
	n, err := q.FinishHealthPoll(ctx, sqlcdb.FinishHealthPollParams{BindingID: poll.BindingID, Token: poll.LeaseToken, ErrorCode: code})
	if err != nil {
		return err
	}
	if n != 1 {
		return errHealthLeaseLost
	}
	return nil
}

func (s *Service) RunHealthPollingDraining(drain, work context.Context) {
	if !s.HealthPollingEnabled {
		return
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for drain.Err() == nil {
		step, cancel := context.WithTimeout(work, 30*time.Second)
		processed, err := s.ProcessHealthOne(step)
		cancel()
		if err != nil && work.Err() == nil {
			slog.Error("background health persistence failed")
		}
		if processed && err == nil {
			continue // Catch up due bindings without sleeping between each one.
		}
		select {
		case <-drain.Done():
			return
		case <-ticker.C:
		}
	}
}
