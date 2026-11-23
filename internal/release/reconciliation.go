package release

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObserveRelease is an explicit read-only operation, independent of background
// execution switches. Its caller must authorize and recheck the entire input.
func (s *Service) ObserveRelease(ctx context.Context, in Input) (Observation, error) {
	if s == nil || s.executor == nil {
		return Observation{}, httpx.Fail(503, "deployment_observation_unavailable", "发布核对器尚未接入")
	}
	return s.executor.Observe(ctx, in)
}

// NormalizeObservation shares outcome and timeout semantics between automatic
// recovery and explicit reconciliation. Elapsed time never settles unknown.
func NormalizeObservation(o Observation, err error, started *time.Time, timeout int) Observation {
	if err != nil {
		o.State, o.Code = "unknown", "release_outcome_unknown"
	}
	if o.State != "observing" && o.State != "succeeded" && o.State != "failed" && o.State != "unknown" {
		o.State, o.Code = "unknown", "release_observation_invalid"
	}
	if o.State == "observing" && started != nil && time.Since(*started) > time.Duration(timeout)*time.Second {
		o.State, o.Code = "failed", "release_timeout"
	}
	return o
}

// PersistObservation runs inside the caller's transaction AFTER its fenced
// deployment transition, with the application locked. Any identity or fencing
// conflict rolls back the transition, pointers, resources, audit and replay.
func PersistObservation(ctx context.Context, q *sqlcdb.Queries, d sqlcdb.Deployment, binding string, o Observation) error {
	for _, r := range o.Resources {
		owners := r.Owners
		if owners == nil {
			owners = []metav1.OwnerReference{}
		}
		raw, err := json.Marshal(owners)
		if err != nil {
			return err
		}
		n, err := q.SaveDeploymentResource(ctx, sqlcdb.SaveDeploymentResourceParams{DeploymentID: d.ID, ApiVersion: r.APIVersion, Kind: r.Kind, Namespace: r.Namespace, Name: r.Name, Uid: r.UID, OwnerReferences: raw, ObservedGeneration: r.Generation})
		if err != nil {
			return err
		}
		if n != 1 {
			return errors.New("release resource identity changed")
		}
	}
	requestState := "executing"
	if o.State == "queued" || o.State == "unknown" || o.State == "succeeded" || o.State == "failed" {
		requestState = o.State
	}
	if err := q.SetReleaseRequestState(ctx, sqlcdb.SetReleaseRequestStateParams{ID: d.RequestID, Status: requestState}); err != nil {
		return err
	}
	if o.State == "succeeded" {
		request, err := q.GetReleaseRequest(ctx, d.RequestID)
		if err != nil {
			return err
		}
		var n int64
		if request.Kind == "offline" {
			n, err = q.CompleteBindingOffline(ctx, sqlcdb.CompleteBindingOfflineParams{ID: binding, TargetID: d.TargetID})
		} else {
			n, err = q.SetCurrentDeployment(ctx, sqlcdb.SetCurrentDeploymentParams{ID: binding, CurrentDeploymentID: &d.ID, TargetID: d.TargetID})
		}
		if err != nil {
			return err
		}
		if n != 1 {
			return errors.New("release binding identity changed")
		}
	}
	if o.State == "succeeded" || o.State == "failed" {
		n, err := q.ReleaseTarget(ctx, sqlcdb.ReleaseTargetParams{ID: d.TargetID, ActiveDeploymentID: &d.ID, FencingToken: d.FencingToken})
		if err != nil {
			return err
		}
		if n != 1 {
			return errors.New("release target fencing conflict")
		}
	}
	return nil
}
