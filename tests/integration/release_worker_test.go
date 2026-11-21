package integration_test

import (
	"context"
	"encoding/base64"
	"errors"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/release"
)

type releaseExecutor struct {
	submit  func(context.Context, release.Input) (release.Observation, error)
	observe func(context.Context, release.Input) (release.Observation, error)
}

func (e releaseExecutor) Submit(ctx context.Context, in release.Input) (release.Observation, error) {
	return e.submit(ctx, in)
}
func (e releaseExecutor) Observe(ctx context.Context, in release.Input) (release.Observation, error) {
	return e.observe(ctx, in)
}
func releaseWorker(t *testing.T, f *releaseFixture, e release.Executor) *release.Service {
	t.Helper()
	vault, err := credential.New(testCredentialKey)
	if err != nil {
		t.Fatal(err)
	}
	w := release.New(f.c.f.pool, vault, release.Settings{Enabled: true, Concurrency: 1}, e)
	f.apps.UseReleases(w)
	return w
}
func releasePoll(t *testing.T, f *releaseFixture, id string) {
	t.Helper()
	_, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET next_poll_at=clock_timestamp()-interval '1 second' WHERE id=$1", id)
	if err != nil {
		t.Fatal(err)
	}
}
func releaseStep(t *testing.T, w *release.Service) {
	t.Helper()
	ok, err := w.ProcessOne(context.Background())
	if err != nil || !ok {
		t.Fatal("release step", ok, err)
	}
}
func releaseState(t *testing.T, f *releaseFixture, id, status string) {
	t.Helper()
	var got string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT status FROM deployments WHERE id=$1", id).Scan(&got); err != nil || got != status {
		t.Fatalf("deployment state=%s want=%s err=%v", got, status, err)
	}
}
func releaseResources(t *testing.T, in release.Input) []release.Resource {
	t.Helper()
	refs, err := release.Objects(in.Plan)
	if err != nil {
		t.Fatal(err)
	}
	for i := range refs {
		refs[i].UID = "fixture-uid-" + refs[i].Name
		refs[i].Generation = 2
	}
	return refs
}
func TestReleaseWorkerFrozenSecretsSuccessAndHistory(t *testing.T) {
	f := setupRelease(t, "Deployment")
	var submits, observes atomic.Int32
	var request application.ReleaseRequest
	revision := int32(2)
	w := releaseWorker(t, f, releaseExecutor{
		submit: func(ctx context.Context, in release.Input) (release.Observation, error) {
			submits.Add(1)
			var status, active string
			if err := f.c.f.pool.QueryRow(ctx, "SELECT d.status,t.active_deployment_id::text FROM deployments d JOIN deployment_targets t ON t.id=d.target_id WHERE d.id=$1", in.Plan.DeploymentID).Scan(&status, &active); err != nil || status != "submitting" || active != in.Plan.DeploymentID {
				t.Fatal("remote call preceded durable intent/target occupancy", err)
			}
			// secretData is map[string]string in the ephemeral execution input.
			values, ok := bm(in.Values["podry"])["secretData"].(map[string]string)
			if !ok || values["DATABASE_URL"] != base64.StdEncoding.EncodeToString([]byte("private-db-value-never-return")) {
				t.Fatal("worker drifted from frozen secret version")
			}
			return release.Observation{State: "observing", Revision: &revision, Resources: releaseResources(t, in)}, nil
		},
		observe: func(ctx context.Context, in release.Input) (release.Observation, error) {
			poll := observes.Add(1)
			if len(in.Known) != 4 || in.Values != nil || in.Plan.DeploymentID != *request.DeploymentID {
				t.Fatal("recovery lost identities or decrypted runtime secrets")
			}
			if in.Revision == nil || *in.Revision != revision {
				t.Fatal("a conflicting revision replaced the frozen comparison baseline")
			}
			if poll == 1 {
				conflict := int32(3)
				return release.Observation{State: "unknown", Code: "release_revision_conflict", Revision: &conflict, Resources: in.Known}, nil
			}
			return release.Observation{State: "succeeded", Revision: &revision, Resources: in.Known}, nil
		},
	})
	p := f.preview(t, 3)
	request = decode[application.ReleaseRequest](t, f.confirm(t, p, "worker-success-key", 202))
	id := *request.DeploymentID
	f.c.f.call("PUT", "/api/credentials/"+f.secret, f.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"data": map[string]any{"DATABASE_URL": "rotated-private-value"}}}, 200)
	releaseStep(t, w)
	releaseState(t, f, id, "observing")
	var current *string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT current_deployment_id FROM app_environment_bindings WHERE id=$1", f.binding).Scan(&current); err != nil || current != nil {
		t.Fatal("pointer moved before success", err)
	}
	// Revocation after submission must not hide the already-written outcome.
	f.c.f.call("DELETE", "/api/clusters/"+f.c.clusterID+"/resource-grants/"+f.grant, f.c.admin, nil, 204)
	releasePoll(t, f, id)
	releaseStep(t, w)
	releaseState(t, f, id, "unknown")
	conflict := decode[application.Deployment](t, f.c.f.call("GET", "/api/deployments/"+id, f.c.developer, nil, 200))
	if conflict.HelmRevision == nil || *conflict.HelmRevision != revision || conflict.ErrorCode == nil || *conflict.ErrorCode != "release_revision_conflict" {
		t.Fatal("revision conflict did not preserve its baseline")
	}
	releasePoll(t, f, id)
	releaseStep(t, w)
	releaseState(t, f, id, "succeeded")
	if submits.Load() != 1 || observes.Load() != 2 {
		t.Fatal("submission was replayed")
	}
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT current_deployment_id FROM app_environment_bindings WHERE id=$1", f.binding).Scan(&current); err != nil || current == nil || *current != id {
		t.Fatal("successful deployment did not advance pointer", err)
	}
	d := decode[application.Deployment](t, f.c.f.call("GET", "/api/deployments/"+id, f.c.developer, nil, 200))
	if d.HelmRevision == nil || *d.HelmRevision != 2 || d.StartedAt == nil || d.FinishedAt == nil || d.ErrorCode != nil {
		t.Fatal("history omitted execution evidence")
	}
	r := decode[application.ReleaseRequest](t, f.c.f.call("GET", "/api/release-requests/"+request.RequestID, f.c.developer, nil, 200))
	if r.Status != "succeeded" {
		t.Fatal("request projection stale")
	}
	var leaks int
	err := f.c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM release_snapshots WHERE snapshot::text LIKE '%private-db-value%' OR snapshot::text LIKE '%rotated-private-value%'").Scan(&leaks)
	if err != nil || leaks != 0 {
		t.Fatal("decrypted credential persisted", err)
	}
}
func TestReleaseWorkerTargetSerializationAndUnknownRecovery(t *testing.T) {
	f := setupRelease(t, "Job")
	var submits atomic.Int32
	settled := false
	w := releaseWorker(t, f, releaseExecutor{
		submit: func(ctx context.Context, in release.Input) (release.Observation, error) {
			submits.Add(1)
			return release.Observation{Resources: releaseResources(t, in)}, errors.New("response lost after partial write")
		},
		observe: func(ctx context.Context, in release.Input) (release.Observation, error) {
			if len(in.Known) != 2 {
				t.Fatal("failed submission lost partial identities")
			}
			if settled {
				return release.Observation{State: "succeeded", Resources: in.Known}, nil
			}
			return release.Observation{State: "unknown", Resources: in.Known, Code: "release_outcome_unknown"}, nil
		},
	})
	one, two := f.preview(t, 3), f.preview(t, 3)
	r1 := decode[application.ReleaseRequest](t, f.confirm(t, one, "serial-release-one", 202))
	r2 := decode[application.ReleaseRequest](t, f.confirm(t, two, "serial-release-two", 202))
	id1, id2 := *r1.DeploymentID, *r2.DeploymentID
	releaseStep(t, w)
	releaseState(t, f, id1, "unknown")
	if ok, err := w.ProcessOne(context.Background()); err != nil || ok {
		t.Fatal("occupied target admitted a second execution", ok, err)
	}
	// An old deadline never clears an ambiguous remote outcome.
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET started_at=now()-interval '1 day' WHERE id=$1", id1); err != nil {
		t.Fatal(err)
	}
	releasePoll(t, f, id1)
	releaseStep(t, w)
	releaseState(t, f, id1, "unknown")
	releaseState(t, f, id2, "queued")
	// Recreate the controller to prove recovery uses PostgreSQL, not memory.
	settled = true
	w = releaseWorker(t, f, recoveredReleaseExecutor(t, &submits))
	releasePoll(t, f, id1)
	releaseStep(t, w)
	releaseState(t, f, id1, "succeeded")
	if submits.Load() != 1 {
		t.Fatal("unknown outcome was resubmitted")
	}
	releaseStep(t, w)
	releaseState(t, f, id2, "failed")
	var token int64
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT fencing_token FROM deployment_targets WHERE id=(SELECT target_id FROM deployments WHERE id=$1)", id2).Scan(&token); err != nil || token != 2 {
		t.Fatal("physical target did not acquire a new fencing token", err)
	}
	var current string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT current_deployment_id FROM app_environment_bindings WHERE id=$1", f.binding).Scan(&current); err != nil || current != id1 {
		t.Fatal("failure moved successful current pointer", err)
	}
}
func recoveredReleaseExecutor(t *testing.T, count *atomic.Int32) releaseExecutor {
	return releaseExecutor{
		submit: func(context.Context, release.Input) (release.Observation, error) {
			count.Add(1)
			return release.Observation{State: "failed", Code: "release_target_conflict"}, nil
		},
		observe: func(ctx context.Context, in release.Input) (release.Observation, error) {
			if len(in.Known) == 0 {
				t.Fatal("restart lost resource identities")
			}
			return release.Observation{State: "succeeded", Resources: in.Known}, nil
		},
	}
}
func TestReleaseWorkerStaleLeaseCannotOverwriteRecovery(t *testing.T) {
	f := setupRelease(t, "Job")
	entered, unblock := make(chan struct{}), make(chan struct{})
	var submits atomic.Int32
	w := releaseWorker(t, f, releaseExecutor{
		submit: func(ctx context.Context, in release.Input) (release.Observation, error) {
			submits.Add(1)
			close(entered)
			<-unblock
			return release.Observation{State: "succeeded", Resources: releaseResources(t, in)}, nil
		},
		observe: func(ctx context.Context, in release.Input) (release.Observation, error) {
			return release.Observation{State: "unknown", Code: "release_outcome_unknown"}, nil
		},
	})
	r := decode[application.ReleaseRequest](t, f.confirm(t, f.preview(t, 3), "lease-release-key", 202))
	id := *r.DeploymentID
	done := make(chan error, 1)
	go func() { _, err := w.ProcessOne(context.Background()); done <- err }()
	<-entered
	if ok, err := w.ProcessOne(context.Background()); err != nil || ok {
		t.Fatal("concurrent worker stole an active lease", ok, err)
	}
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET lease_until=clock_timestamp()-interval '1 second',next_poll_at=clock_timestamp()-interval '1 second' WHERE id=$1", id); err != nil {
		t.Fatal(err)
	}
	releaseStep(t, w)
	releaseState(t, f, id, "unknown")
	close(unblock)
	if err := <-done; !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("stale writer was not fenced", err)
	}
	releaseState(t, f, id, "unknown")
	var n int
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM deployment_resources WHERE deployment_id=$1", id).Scan(&n); err != nil || n != 0 {
		t.Fatal("stale resource writes committed", err)
	}
	if submits.Load() != 1 {
		t.Fatal("recovery duplicated Helm submission")
	}
	var active string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT active_deployment_id FROM deployment_targets WHERE id=(SELECT target_id FROM deployments WHERE id=$1)", id).Scan(&active); err != nil || active != id {
		t.Fatal("unknown released physical target", err)
	}
}
func TestReleaseWorkerRevocationAndSettledTimeout(t *testing.T) {
	for _, mode := range []string{"revoked", "timeout"} {
		t.Run(mode, func(t *testing.T) {
			f := setupRelease(t, "Job")
			var submits atomic.Int32
			w := releaseWorker(t, f, releaseExecutor{
				submit: func(ctx context.Context, in release.Input) (release.Observation, error) {
					submits.Add(1)
					return release.Observation{State: "observing", Resources: releaseResources(t, in)}, nil
				},
				observe: func(ctx context.Context, in release.Input) (release.Observation, error) {
					return release.Observation{State: "observing", Resources: in.Known}, nil
				},
			})
			r := decode[application.ReleaseRequest](t, f.confirm(t, f.preview(t, 3), "revocation-timeout-key", 202))
			id := *r.DeploymentID
			if mode == "revoked" {
				f.c.f.call("DELETE", "/api/clusters/"+f.c.clusterID+"/resource-grants/"+f.grant, f.c.admin, nil, 204)
			}
			releaseStep(t, w)
			if mode == "timeout" {
				if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET started_at=now()-interval '1 day',next_poll_at=now()-interval '1 second' WHERE id=$1", id); err != nil {
					t.Fatal(err)
				}
				releaseStep(t, w)
			}
			releaseState(t, f, id, "failed")
			d, err := sqlcdb.New(f.c.f.pool).GetDeployment(context.Background(), id)
			if err != nil || d.ErrorCode == nil {
				t.Fatal("missing safe failure code", err)
			}
			if mode == "revoked" && (*d.ErrorCode != "release_authorization_revoked" || submits.Load() != 0) {
				t.Fatal("revoked intent executed")
			}
			if mode == "timeout" && *d.ErrorCode != "release_timeout" {
				t.Fatal("settled timeout was not recorded")
			}
		})
	}
}
