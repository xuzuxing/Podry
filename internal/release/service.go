package release

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
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
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type Settings struct {
	Enabled     bool
	Concurrency int
}

func (s Settings) Validate() error {
	if s.Enabled && (s.Concurrency < 1 || s.Concurrency > 4) {
		return errors.New("PODRY_RELEASE_CONCURRENCY must be between 1 and 4")
	}
	return nil
}

type Resource struct {
	APIVersion, Kind, Namespace, Name, UID string
	Owners                                 []metav1.OwnerReference
	Generation                             int64
}

// Input is ephemeral: Cluster and Values may contain decrypted credentials.
// Executors must never return or log those payloads, Helm manifests or errors.
type Input struct {
	Plan     Plan
	Hash     string
	Cluster  map[string]any
	Values   map[string]any
	Known    []Resource
	Revision *int32
}
type Observation struct {
	State     string
	Code      string
	Revision  *int32
	Resources []Resource
}
type Executor interface {
	Submit(context.Context, Input) (Observation, error)
	Observe(context.Context, Input) (Observation, error)
}
type Service struct {
	pool     *pgxpool.Pool
	q        *sqlcdb.Queries
	vault    *credential.Vault
	settings Settings
	executor Executor
}

func New(pool *pgxpool.Pool, vault *credential.Vault, settings Settings, executor Executor) *Service {
	return &Service{pool: pool, q: sqlcdb.New(pool), vault: vault, settings: settings, executor: executor}
}
func (s *Service) Ready(Target) error {
	if s == nil || !s.settings.Enabled || s.executor == nil || s.vault == nil {
		return httpx.Fail(503, "deployment_execution_unavailable", "发布执行器尚未启用；预览已保留")
	}
	return s.settings.Validate()
}

func (s *Service) secret(ctx context.Context, ref CredentialRef) (map[string]any, error) {
	v, err := s.q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: ref.ID, Version: ref.Version})
	if err != nil {
		return nil, err
	}
	return s.vault.Open(ref.ID, ref.Version, v.KeyID, v.EncryptedPayload)
}
func (s *Service) authorize(ctx context.Context, p Plan, user string) error {
	u, err := s.q.GetUser(ctx, user)
	if err != nil {
		return err
	}
	if u.DisabledAt != nil {
		return httpx.Forbidden()
	}
	a := auth.Actor{User: auth.Public(u), TokenVersion: u.TokenVersion}
	app, err := s.q.GetApplication(ctx, p.AppID)
	if err != nil {
		return err
	}
	if app.ArchivedAt != nil {
		return httpx.Forbidden()
	}
	role, err := project.ProjectRole(ctx, s.q, a, app.ProjectID)
	if err != nil {
		return err
	}
	if err = project.RequireRole(role, "deploy"); err != nil {
		return err
	}
	refs, err := Objects(p)
	if err != nil {
		return err
	}
	for _, ref := range refs {
		gvr, err := resourceName(ref.APIVersion, ref.Kind)
		if err != nil {
			return err
		}
		if err = platform.RequireTarget(ctx, s.q, a, app.ProjectID, p.Target.ClusterID, p.Target.Namespace, gvr, "resource.write"); err != nil {
			return err
		}
	}
	// Helm persists release records as Secrets even when the chart has no Secret.
	if err = platform.RequireTarget(ctx, s.q, a, app.ProjectID, p.Target.ClusterID, p.Target.Namespace, "core/secrets", "resource.write"); err != nil {
		return err
	}
	pr, err := s.q.GetProject(ctx, app.ProjectID)
	if err != nil {
		return err
	}
	for _, ref := range p.SecretRefs {
		cr, err := s.q.GetCredential(ctx, ref.CredentialID)
		if err != nil {
			return err
		}
		if cr.Kind != "secret" {
			return httpx.Forbidden()
		}
		if err = platform.CredentialAccess(ctx, s.q, a, cr, &pr.TeamID, false); err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) values(ctx context.Context, p Plan) (map[string]any, error) {
	raw, err := json.Marshal(p.Chart.Values)
	if err != nil {
		return nil, err
	}
	var values map[string]any
	if err = json.Unmarshal(raw, &values); err != nil {
		return nil, err
	}
	reserved, ok := values["podry"].(map[string]any)
	if !ok {
		return nil, errors.New("invalid reserved values")
	}
	data := map[string]string{}
	for _, ref := range p.SecretRefs {
		payload, err := s.secret(ctx, CredentialRef{ref.CredentialID, ref.Version})
		if err != nil {
			return nil, err
		}
		items, _ := payload["data"].(map[string]any)
		value, ok := items[ref.TargetKey].(string)
		if !ok {
			return nil, errors.New("missing secret key")
		}
		data[ref.TargetKey] = base64.StdEncoding.EncodeToString([]byte(value))
	}
	reserved["secretData"] = data
	return values, nil
}

type claimed struct {
	row   sqlcdb.NextReleaseRow
	lease sqlcdb.Deployment
}

func (s *Service) claim(ctx context.Context) (claimed, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (claimed, error) {
		r, err := q.NextRelease(ctx)
		if err != nil {
			return claimed{}, err
		}
		token, err := q.OccupyReleaseTarget(ctx, sqlcdb.OccupyReleaseTargetParams{TargetID: r.TargetID, DeploymentID: &r.ID})
		if err != nil {
			return claimed{}, err
		}
		owner := uuid.NewString()
		d, err := q.ClaimRelease(ctx, sqlcdb.ClaimReleaseParams{ID: r.ID, Owner: &owner, FencingToken: token})
		return claimed{r, d}, err
	})
}

// A durable submitting state permits observation only. Even an absent Helm
// release after a crash is ambiguous; lease expiry never permits a second submit.
func (s *Service) ProcessOne(ctx context.Context) (bool, error) {
	return s.processOne(ctx, ctx)
}

func (s *Service) processOne(claimCtx, ctx context.Context) (bool, error) {
	if err := s.Ready(Target{}); err != nil {
		return false, err
	}
	c, err := s.claim(claimCtx)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	d := c.lease
	p, err := Decode(c.row.Snapshot, c.row.SnapshotSha256)
	if err != nil || p.DeploymentID != d.ID || p.RequestID != d.RequestID || p.TargetID != d.TargetID || p.AppID != c.row.AppID || p.BindingID != c.row.BindingID {
		state := "unknown"
		if d.Status == "queued" {
			state = "failed"
		}
		return true, s.finish(ctx, c, Observation{State: state, Code: "release_snapshot_invalid"})
	}
	stepCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	in := Input{Plan: p, Hash: c.row.SnapshotSha256, Revision: d.HelmRevision}
	rows, err := s.q.ListDeploymentResources(stepCtx, d.ID)
	if err != nil {
		return true, err
	}
	for _, r := range rows {
		var owners []metav1.OwnerReference
		if err = json.Unmarshal(r.OwnerReferences, &owners); err != nil {
			return true, err
		}
		in.Known = append(in.Known, Resource{r.ApiVersion, r.Kind, r.Namespace, r.Name, r.Uid, owners, r.ObservedGeneration})
	}
	if d.Status == "queued" {
		if err = s.authorize(stepCtx, p, c.row.RequestedBy); err != nil {
			var api *httpx.Error
			if errors.Is(err, pgx.ErrNoRows) || (errors.As(err, &api) && (api.Status == 403 || api.Status == 404)) {
				return true, s.finish(ctx, c, Observation{State: "failed", Code: "release_authorization_revoked"})
			}
			return true, s.finish(ctx, c, Observation{State: "queued", Code: "release_authorization_unavailable"})
		}
		if d.StartedAt != nil && time.Since(*d.StartedAt) > time.Duration(p.TimeoutSeconds)*time.Second {
			return true, s.finish(ctx, c, Observation{State: "failed", Code: "release_timeout"})
		}
		in.Values, err = s.values(stepCtx, p)
		if err != nil {
			return true, s.finish(ctx, c, Observation{State: "queued", Code: "release_credentials_unavailable"})
		}
	}
	in.Cluster, err = s.secret(stepCtx, p.ClusterCredential)
	if err != nil {
		state := "unknown"
		if d.Status == "queued" {
			state = "queued"
		}
		return true, s.finish(ctx, c, Observation{State: state, Code: "release_credentials_unavailable"})
	}
	var result Observation
	if d.Status == "queued" {
		d, err = s.q.MarkReleaseIntent(stepCtx, sqlcdb.MarkReleaseIntentParams{ID: d.ID, Revision: d.Revision, LeaseOwner: d.LeaseOwner})
		if err != nil {
			return true, err
		}
		c.lease = d
		result, err = s.executor.Submit(stepCtx, in)
	} else {
		result, err = s.executor.Observe(stepCtx, in)
	}
	if ctx.Err() != nil {
		return true, ctx.Err()
	}
	if err != nil {
		result.State = "unknown"
		result.Code = "release_outcome_unknown"
	}
	if result.State != "observing" && result.State != "succeeded" && result.State != "failed" && result.State != "unknown" {
		result.State = "unknown"
		result.Code = "release_observation_invalid"
	}
	// Only a settled Helm release may time out as failed. Unsettled outcomes keep
	// the target occupied regardless of elapsed wall time.
	if result.State == "observing" && d.StartedAt != nil && time.Since(*d.StartedAt) > time.Duration(p.TimeoutSeconds)*time.Second {
		result.State = "failed"
		result.Code = "release_timeout"
	}
	return true, s.finish(ctx, c, result)
}
func strptr(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}
func (s *Service) finish(ctx context.Context, c claimed, o Observation) error {
	_, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		// Match confirmation's application-before-target lock order.
		app, err := q.LockApplication(ctx, c.row.AppID)
		if err != nil {
			return false, err
		}
		d, err := q.TransitionRelease(ctx, sqlcdb.TransitionReleaseParams{ID: c.lease.ID, Revision: c.lease.Revision, Owner: c.lease.LeaseOwner, Status: o.State, HelmRevision: o.Revision, ErrorCode: strptr(o.Code)})
		if err != nil {
			return false, err
		}
		for _, r := range o.Resources {
			owners := r.Owners
			if owners == nil {
				owners = []metav1.OwnerReference{}
			}
			raw, err := json.Marshal(owners)
			if err != nil {
				return false, err
			}
			n, err := q.SaveDeploymentResource(ctx, sqlcdb.SaveDeploymentResourceParams{DeploymentID: d.ID, ApiVersion: r.APIVersion, Kind: r.Kind, Namespace: r.Namespace, Name: r.Name, Uid: r.UID, OwnerReferences: raw, ObservedGeneration: r.Generation})
			if err != nil {
				return false, err
			}
			if n != 1 {
				return false, errors.New("release resource identity changed")
			}
		}
		requestState := "executing"
		if o.State == "queued" {
			requestState = "queued"
		}
		if o.State == "unknown" || o.State == "succeeded" || o.State == "failed" {
			requestState = o.State
		}
		if err = q.SetReleaseRequestState(ctx, sqlcdb.SetReleaseRequestStateParams{ID: d.RequestID, Status: requestState}); err != nil {
			return false, err
		}
		if o.State == "succeeded" {
			if _, err = q.SetCurrentDeployment(ctx, sqlcdb.SetCurrentDeploymentParams{ID: c.row.BindingID, CurrentDeploymentID: &d.ID, TargetID: d.TargetID}); err != nil {
				return false, err
			}
		}
		if o.State == "succeeded" || o.State == "failed" {
			n, err := q.ReleaseTarget(ctx, sqlcdb.ReleaseTargetParams{ID: d.TargetID, ActiveDeploymentID: &d.ID, FencingToken: d.FencingToken})
			if err != nil {
				return false, err
			}
			if n != 1 {
				return false, errors.New("release target fencing conflict")
			}
		}
		if c.row.Status != o.State {
			pr, err := q.GetProject(ctx, app.ProjectID)
			if err != nil {
				return false, err
			}
			err = project.Record(ctx, q, auth.Actor{User: auth.User{ID: c.row.RequestedBy}}, &pr.TeamID, &pr.ID, "deployment."+o.State, "worker", map[string]any{"deploymentId": d.ID, "requestId": d.RequestID, "errorCode": o.Code})
			if err != nil {
				return false, err
			}
		}
		return true, nil
	})
	return err
}
func (s *Service) Run(ctx context.Context) {
	s.RunDraining(ctx, ctx)
}

// RunDraining keeps a claimed step alive while the process stops taking work.
// Canceling work preserves durable intent and leases for observation on restart.
func (s *Service) RunDraining(drain, work context.Context) {
	if s.Ready(Target{}) != nil {
		return
	}
	var wg sync.WaitGroup
	for range s.settings.Concurrency {
		wg.Go(func() {
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			for {
				if drain.Err() != nil || work.Err() != nil {
					return
				}
				if _, err := s.processOne(drain, work); err != nil && drain.Err() == nil && work.Err() == nil {
					slog.Warn("release reconciliation failed", "error_type", "bounded_step")
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
