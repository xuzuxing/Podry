package integration_test

import (
	"context"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
)

// Older migration tests must still reach their original version and assert
// the same history guards. v17 contains disposable scheduling metadata only.
// First remove v18's provider constraint expansion (these older fixtures only use GitHub).
func downgradeHealthSchedule(t *testing.T, dsn string) {
	t.Helper()
	if err := database.Migrate(dsn, true); err != nil {
		t.Fatal("v19 to v18 cleanup metadata downgrade", err)
	}
	if err := database.Migrate(dsn, true); err != nil {
		t.Fatal("v18 to v17 provider constraint downgrade", err)
	}
	if err := database.Migrate(dsn, true); err != nil {
		t.Fatal("v17 to v16 scheduling metadata downgrade", err)
	}
}

func pollDue(t *testing.T, f *applicationResourceFixture) {
	t.Helper()
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE binding_health_polls SET next_poll_at=clock_timestamp()-interval '1 second' WHERE binding_id=$1", f.binding); err != nil {
		t.Fatal(err)
	}
}

func pollStep(t *testing.T, apps *application.Service, want bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if got, err := apps.ProcessHealthOne(ctx); err != nil || got != want {
		t.Fatalf("health poll processed=%v, want=%v, err=%v", got, want, err)
	}
}

func polledHealth(t *testing.T, f *applicationResourceFixture, want string) {
	t.Helper()
	var got string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT health FROM application_health WHERE app_id=$1", f.app).Scan(&got); err != nil || got != want {
		t.Fatalf("health=%s, want=%s, err=%v", got, want, err)
	}
}

func TestHealthPollingDisabledAndTransitions(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	reads := f.api.reads.Load()
	pollStep(t, f.apps, false)
	var untouched bool
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT started_at IS NULL AND lease_token IS NULL FROM binding_health_polls WHERE binding_id=$1", f.binding).Scan(&untouched); err != nil || !untouched || f.api.reads.Load() != reads {
		t.Fatal("disabled poller performed work", err)
	}
	f.apps.HealthPollingEnabled = true
	pollStep(t, f.apps, true)
	f.health(t, "healthy") // No resource GET was used to prime this observation.
	pollStep(t, f.apps, false)
	for _, want := range []string{"progressing", "stopped", "degraded", "unknown", "healthy"} {
		f.api.mu.Lock()
		workload := f.api.objects[f.workload]
		switch want {
		case "progressing":
			bm(workload["spec"])["replicas"] = 2
		case "stopped":
			bm(workload["spec"])["replicas"] = 0
			workload["status"] = map[string]any{"observedGeneration": 1}
		case "degraded":
			bm(workload["spec"])["replicas"] = 1
			workload["status"] = map[string]any{"observedGeneration": 1, "conditions": []any{map[string]any{"type": "Progressing", "status": "False", "reason": "ProgressDeadlineExceeded"}}}
		case "unknown":
			f.api.fail.Store(503)
		case "healthy":
			f.api.fail.Store(0)
			workload["status"] = map[string]any{"observedGeneration": 1, "replicas": 1, "updatedReplicas": 1, "readyReplicas": 1, "availableReplicas": 1, "conditions": []any{map[string]any{"type": "Available", "status": "True"}}}
		}
		f.api.mu.Unlock()
		pollDue(t, f)
		pollStep(t, f.apps, true)
		f.health(t, want)
	}
	var scheduled bool
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT lease_token IS NULL AND lease_until IS NULL AND last_error_code IS NULL AND next_poll_at>clock_timestamp()+interval '20 seconds' FROM binding_health_polls WHERE binding_id=$1", f.binding).Scan(&scheduled); err != nil || !scheduled || f.api.writes.Load() != 0 {
		t.Fatal("poll completion or read-only boundary", scheduled, err)
	}
}

func TestHealthPollingJobIdentityAndReadiness(t *testing.T) {
	f := setupApplicationResources(t, "Job")
	f.apps.HealthPollingEnabled = true
	pollStep(t, f.apps, true)
	f.health(t, "completed")
	f.api.mu.Lock()
	delete(f.api.objects, "/api/v1/namespaces/demo/pods/demo-pod")
	f.api.mu.Unlock()
	pollDue(t, f)
	pollStep(t, f.apps, true)
	f.health(t, "unknown")
	f.api.mu.Lock()
	bm(f.api.objects[f.workload]["metadata"])["uid"] = "replacement"
	f.api.mu.Unlock()
	pollDue(t, f)
	pollStep(t, f.apps, true)
	f.health(t, "unknown")
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET status='unknown',revision=revision+1 WHERE id=$1", f.plan.DeploymentID); err != nil {
		t.Fatal(err)
	}
	reads := f.api.reads.Load()
	pollDue(t, f)
	pollStep(t, f.apps, true)
	if f.api.reads.Load() != reads {
		t.Fatal("unknown execution triggered network observation")
	}
}

func TestHealthPollingRequesterPermissions(t *testing.T) {
	for _, mode := range []string{"project", "resources", "filtered", "disabled", "logout", "archived"} {
		t.Run(mode, func(t *testing.T) {
			f := setupApplicationResources(t, "Deployment")
			f.apps.HealthPollingEnabled = true
			pollStep(t, f.apps, true)
			polledHealth(t, f, "healthy")
			reads := f.api.reads.Load()
			switch mode {
			case "project":
				f.c.f.call("DELETE", "/api/projects/"+f.c.projectID+"/members/"+f.c.dev.ID, f.c.admin, nil, 204)
			case "resources":
				f.c.f.call("DELETE", "/api/clusters/"+f.c.clusterID+"/resource-grants/"+f.grant, f.c.admin, nil, 204)
			case "filtered":
				if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE resource_grants SET resources=ARRAY['configmaps'] WHERE id=$1", f.grant); err != nil {
					t.Fatal(err)
				}
			case "disabled":
				if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE users SET disabled_at=now(),token_version=token_version+1 WHERE id=$1", f.c.dev.ID); err != nil {
					t.Fatal(err)
				}
			case "logout":
				f.c.f.call("POST", "/api/auth/logout", f.c.developer, nil, 204)
			case "archived":
				if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE applications SET archived_at=now() WHERE id=$1", f.app); err != nil {
					t.Fatal(err)
				}
			}
			pollDue(t, f)
			pollStep(t, f.apps, mode != "archived")
			want := "unknown"
			if mode == "logout" {
				want = "healthy" // Current account authorization outlives browser sessions.
			} else if mode == "archived" {
				want = "stopped"
			}
			polledHealth(t, f, want)
			if mode != "logout" && f.api.reads.Load() != reads {
				t.Fatal("ineligible requester caused cluster I/O")
			}
		})
	}
}

type healthStepResult struct {
	processed bool
	err       error
}

func asyncHealthStep(f *applicationResourceFixture) <-chan healthStepResult {
	done := make(chan healthStepResult, 1)
	go func() {
		processed, err := f.apps.ProcessHealthOne(context.Background())
		done <- healthStepResult{processed, err}
	}()
	return done
}

func awaitHealthStep(t *testing.T, done <-chan healthStepResult) {
	t.Helper()
	select {
	case r := <-done:
		if !r.processed || r.err != nil {
			t.Fatal("background step failed", r)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("background step did not complete")
	}
}

func TestHealthPollingRechecksAfterNetwork(t *testing.T) {
	for _, mode := range []string{"project", "grant", "rotation", "binding", "revision", "archived"} {
		t.Run(mode, func(t *testing.T) {
			f := setupApplicationResources(t, "Deployment")
			f.apps.HealthPollingEnabled = true
			pollStep(t, f.apps, true)
			pollDue(t, f)
			entered, releaseRead := make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(releaseRead) }) }
			t.Cleanup(unblock)
			var pause sync.Once
			f.api.mu.Lock()
			f.api.hook = func(r *http.Request) {
				pause.Do(func() { close(entered); <-releaseRead })
			}
			f.api.mu.Unlock()
			done := asyncHealthStep(f)
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("no paused request")
			}
			switch mode {
			case "project":
				f.c.f.call("DELETE", "/api/projects/"+f.c.projectID+"/members/"+f.c.dev.ID, f.c.admin, nil, 204)
			case "grant":
				f.c.f.call("DELETE", "/api/clusters/"+f.c.clusterID+"/resource-grants/"+f.grant, f.c.admin, nil, 204)
			case "rotation":
				f.c.f.call("PUT", "/api/credentials/"+f.credential, f.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"apiServer": f.api.server.URL, "token": "rotated", "insecureSkipTLSVerify": true}}, 200)
			default:
				statement := "UPDATE app_environment_bindings SET version=version+1 WHERE id=$1"
				id := f.binding
				if mode == "revision" {
					statement, id = "UPDATE deployments SET revision=revision+1 WHERE id=$1", f.plan.DeploymentID
				} else if mode == "archived" {
					statement, id = "UPDATE applications SET archived_at=now() WHERE id=$1", f.app
				}
				if _, err := f.c.f.pool.Exec(context.Background(), statement, id); err != nil {
					t.Fatal(err)
				}
			}
			unblock()
			awaitHealthStep(t, done)
			want := "unknown"
			if mode == "archived" {
				want = "stopped"
			}
			polledHealth(t, f, want)
			var observations int
			if err := f.c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM binding_observations WHERE binding_id=$1", f.binding).Scan(&observations); err != nil || observations != 0 {
				t.Fatal("stale observation survived", observations, err)
			}
		})
	}
}

func TestHealthPollingLeaseRecoveryAndFencing(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	f.apps.HealthPollingEnabled = true
	// The second root read is the final UID recheck, after healthy was captured.
	entered, releaseRead := make(chan struct{}), make(chan struct{})
	var count atomic.Int32
	var once sync.Once
	unblock := func() { once.Do(func() { close(releaseRead) }) }
	t.Cleanup(unblock)
	f.api.hook = func(r *http.Request) {
		if r.URL.Path == f.workload && count.Add(1) == 2 {
			close(entered)
			<-releaseRead
		}
	}
	done := asyncHealthStep(f)
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not reach final UID recheck")
	}
	vault, err := credential.New(testCredentialKey)
	if err != nil {
		t.Fatal(err)
	}
	other := application.New(f.c.f.pool, vault, nil, testJWT)
	other.HealthPollingEnabled = true
	reads := f.api.reads.Load()
	pollStep(t, other, false)
	if f.api.reads.Load() != reads {
		t.Fatal("live lease was duplicated")
	}
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE binding_health_polls SET lease_until=clock_timestamp()-interval '1 second' WHERE binding_id=$1", f.binding); err != nil {
		t.Fatal(err)
	}
	f.api.mu.Lock()
	f.api.objects[f.workload]["status"] = map[string]any{"observedGeneration": 1, "conditions": []any{map[string]any{"type": "Progressing", "status": "False", "reason": "ProgressDeadlineExceeded"}}}
	f.api.mu.Unlock()
	pollStep(t, other, true)
	polledHealth(t, f, "degraded")
	unblock()
	awaitHealthStep(t, done)
	polledHealth(t, f, "degraded")
	var code *string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT last_error_code FROM binding_health_polls WHERE binding_id=$1", f.binding).Scan(&code); err != nil || code != nil {
		t.Fatal("old worker changed newer poll metadata", code, err)
	}
	// Simulate a process dying immediately after its durable claim.
	pollDue(t, f)
	token := uuid.NewString()
	if _, err := sqlcdb.New(f.c.f.pool).ClaimHealthPoll(context.Background(), &token); err != nil {
		t.Fatal(err)
	}
	pollStep(t, other, false)
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE binding_health_polls SET lease_until=clock_timestamp()-interval '1 second' WHERE binding_id=$1", f.binding); err != nil {
		t.Fatal(err)
	}
	pollStep(t, other, true)
	polledHealth(t, f, "degraded")
}

func TestHealthPollingMigrationBackfillAndReadOnlyMetadata(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	f.apps.HealthPollingEnabled = true
	pollStep(t, f.apps, true)
	downgradeHealthSchedule(t, f.c.f.dsn)
	if database.CheckSchema(context.Background(), f.c.f.pool) == nil {
		t.Fatal("current binary accepted v16")
	}
	if err := database.Migrate(f.c.f.dsn, false); err != nil {
		t.Fatal(err)
	}
	var seeded bool
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT p.started_at IS NULL AND o.health='healthy' FROM binding_health_polls p JOIN binding_observations o USING(binding_id) WHERE p.binding_id=$1", f.binding).Scan(&seeded); err != nil || !seeded {
		t.Fatal("backfill or cached observation preservation", err)
	}
	pollStep(t, f.apps, true)
	polledHealth(t, f, "healthy")
}

func TestHealthPollingOlderFailurePreservesNewerInteractiveHealth(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	f.apps.HealthPollingEnabled = true
	entered, releaseRead := make(chan struct{}), make(chan struct{})
	var count atomic.Int32
	var once sync.Once
	unblock := func() { once.Do(func() { close(releaseRead) }) }
	t.Cleanup(unblock)
	f.api.hook = func(r *http.Request) {
		if r.URL.Path == f.workload && count.Add(1) == 2 {
			close(entered)
			<-releaseRead
		}
	}
	done := asyncHealthStep(f)
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("no final UID check")
	}
	f.resources(t, 200)
	f.health(t, "healthy")
	f.api.fail.Store(503)
	unblock()
	awaitHealthStep(t, done)
	f.health(t, "healthy")
	var code string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT last_error_code FROM binding_health_polls WHERE binding_id=$1", f.binding).Scan(&code); err != nil || code != "health_observation_failed" {
		t.Fatal("failure metadata was not persisted safely", code, err)
	}
}

func TestHealthPollingDrainFinishesClaimedRead(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	f.apps.HealthPollingEnabled = true
	entered, releaseRead := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(releaseRead) }) }
	t.Cleanup(unblock)
	var pause sync.Once
	f.api.hook = func(r *http.Request) { pause.Do(func() { close(entered); <-releaseRead }) }
	drain, stopClaims := context.WithCancel(context.Background())
	defer stopClaims()
	work, cancelWork := context.WithCancel(context.Background())
	defer cancelWork()
	done := make(chan struct{})
	go func() { defer close(done); f.apps.RunHealthPollingDraining(drain, work) }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("health runner did not claim")
	}
	stopClaims()
	select {
	case <-done:
		t.Fatal("drain abandoned an active observation")
	default:
	}
	unblock()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("health runner did not drain")
	}
	polledHealth(t, f, "healthy")
	pollDue(t, f)
	var idle bool
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT lease_token IS NULL FROM binding_health_polls WHERE binding_id=$1", f.binding).Scan(&idle); err != nil || !idle {
		t.Fatal("drained runner retained a lease", err)
	}
}
