package integration_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/release"
)

func shutdownSignal(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not reach the expected shutdown state")
	}
}

func TestReleaseWorkerShutdownRecovery(t *testing.T) {
	for _, mode := range []string{"drain", "deadline"} {
		t.Run(mode, func(t *testing.T) {
			f := setupRelease(t, "Job")
			entered, unblock, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
			drain, stopClaims := context.WithCancel(context.Background())
			work, forceStop := context.WithCancel(context.Background())
			t.Cleanup(func() { stopClaims(); forceStop() })
			var submits atomic.Int32
			w := releaseWorker(t, f, releaseExecutor{
				submit: func(ctx context.Context, in release.Input) (release.Observation, error) {
					submits.Add(1)
					close(entered)
					select {
					case <-unblock:
						return release.Observation{State: "succeeded", Resources: releaseResources(t, in)}, ctx.Err()
					case <-ctx.Done():
						return release.Observation{}, ctx.Err()
					}
				},
			})
			first := decode[application.ReleaseRequest](t, f.confirm(t, f.preview(t, 3), "shutdown-release-first", 202))
			second := decode[application.ReleaseRequest](t, f.confirm(t, f.preview(t, 3), "shutdown-release-second", 202))
			go func() { defer close(done); w.RunDraining(drain, work) }()
			shutdownSignal(t, entered)
			stopClaims()
			if work.Err() != nil {
				t.Fatal("stopping acquisition canceled the execution context")
			}
			if mode == "drain" {
				close(unblock)
			} else {
				forceStop()
			}
			shutdownSignal(t, done)
			releaseState(t, f, *second.DeploymentID, "queued")
			if mode == "drain" {
				releaseState(t, f, *first.DeploymentID, "succeeded")
				return
			}
			// A forced exit after durable intent must retain the target and lease.
			releaseState(t, f, *first.DeploymentID, "submitting")
			var active, owner string
			if err := f.c.f.pool.QueryRow(context.Background(), "SELECT t.active_deployment_id::text,d.lease_owner::text FROM deployments d JOIN deployment_targets t ON t.id=d.target_id WHERE d.id=$1", *first.DeploymentID).Scan(&active, &owner); err != nil || active != *first.DeploymentID || owner == "" {
				t.Fatal("shutdown cleared an ambiguous execution", err)
			}
			// Simulate time passing, then instantiate a new process's controller.
			if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET lease_until=clock_timestamp()-interval '1 second',next_poll_at=clock_timestamp()-interval '1 second' WHERE id=$1", *first.DeploymentID); err != nil {
				t.Fatal(err)
			}
			w = releaseWorker(t, f, releaseExecutor{
				submit: func(context.Context, release.Input) (release.Observation, error) {
					submits.Add(1)
					return release.Observation{State: "failed"}, nil
				},
				observe: func(ctx context.Context, in release.Input) (release.Observation, error) {
					return release.Observation{State: "succeeded", Resources: releaseResources(t, in)}, nil
				},
			})
			releaseStep(t, w)
			releaseState(t, f, *first.DeploymentID, "succeeded")
			releaseState(t, f, *second.DeploymentID, "queued")
			if submits.Load() != 1 {
				t.Fatal("restart replayed the interrupted Helm submission")
			}
		})
	}
}

type shutdownTransport func(*http.Request) (*http.Response, error)

func (f shutdownTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestBuildWorkerDrainCommitsArtifactWithoutTakingNextBuild(t *testing.T) {
	b := setupBuild(t)
	first := decode[build.Build](t, b.trigger(t, "drain-build-first", 202))
	for range 3 {
		b.step(t)
	}
	b.kube.complete = true
	second := decode[build.Build](t, b.trigger(t, "drain-build-second", 202))
	if _, err := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET next_poll_at=clock_timestamp()-interval '1 second' WHERE build_id=$1", first.ID); err != nil {
		t.Fatal(err)
	}
	entered, unblock, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	drain, stopClaims := context.WithCancel(context.Background())
	work, forceStop := context.WithCancel(context.Background())
	t.Cleanup(func() { stopClaims(); forceStop() })
	transport := b.worker.RegistryTransport
	b.worker.RegistryTransport = shutdownTransport(func(r *http.Request) (*http.Response, error) {
		close(entered)
		select {
		case <-unblock:
			return transport.RoundTrip(r)
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
	})
	go func() { defer close(done); b.worker.RunDraining(drain, work) }()
	shutdownSignal(t, entered)
	stopClaims()
	close(unblock)
	shutdownSignal(t, done)
	got := decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+first.ID, b.c.developer, nil, 200))
	next := decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+second.ID, b.c.developer, nil, 200))
	if got.Status != "succeeded" || got.ArtifactID == nil || next.Status != "queued" {
		t.Fatal("drain lost the verified artifact or took another build")
	}
	var archived int
	if err := b.c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM log_archives").Scan(&archived); err != nil || archived != 0 {
		t.Fatal("draining started a new log archive task", err)
	}
}

func TestBuildWorkerForcedShutdownRecoversCreatedJob(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "forced-build-recovery", 202))
	entered, done := make(chan struct{}), make(chan struct{})
	original := b.kube.server.Config.Handler
	b.kube.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || !strings.HasSuffix(r.URL.Path, "/jobs") {
			original.ServeHTTP(w, r)
			return
		}
		// The fake API persists the Job, then the client exits before its response.
		recorder := httptest.NewRecorder()
		original.ServeHTTP(recorder, r)
		close(entered)
		<-r.Context().Done()
	})
	drain, stopClaims := context.WithCancel(context.Background())
	work, forceStop := context.WithCancel(context.Background())
	t.Cleanup(func() { stopClaims(); forceStop() })
	go func() { defer close(done); b.worker.RunDraining(drain, work) }()
	shutdownSignal(t, entered)
	stopClaims()
	forceStop()
	shutdownSignal(t, done)
	var stage, owner string
	if err := b.c.f.pool.QueryRow(context.Background(), "SELECT stage,lease_owner::text FROM build_attempts WHERE build_id=$1", out.ID).Scan(&stage, &owner); err != nil || stage != "creating" || owner == "" {
		t.Fatal("forced shutdown erased durable create intent", stage, err)
	}
	if _, err := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET lease_expires_at=clock_timestamp()-interval '1 second',next_poll_at=clock_timestamp()-interval '1 second' WHERE build_id=$1", out.ID); err != nil {
		t.Fatal(err)
	}
	vault, _ := credential.New(testCredentialKey)
	b.worker = build.New(b.c.f.pool, vault, b.worker.Settings)
	b.worker.RegistryTransport = b.registry.Client().Transport
	for range 3 {
		b.step(t)
	}
	if b.kube.creates != 1 || b.kube.starts != 1 {
		t.Fatal("restart duplicated the already-created Job")
	}
}
