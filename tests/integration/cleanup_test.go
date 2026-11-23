package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/cleanup"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/release"
)

// The fake accepts only exact conditional DELETEs and simulates dependent Pod
// collection. It can apply a delete while losing its reply, or replace an object
// between GET and DELETE. No user's cluster is contacted.
type cleanupAPI struct {
	mu                       *sync.Mutex
	objects                  map[string]map[string]any
	fallback                 http.Handler
	deletes                  int
	dropReply, replace, hold bool
	hook                     func(*http.Request)
}

func (a *cleanupAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if a.hook != nil {
		a.hook(r)
	}
	if r.Method != "DELETE" {
		if a.fallback != nil {
			a.fallback.ServeHTTP(w, r)
			return
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if o := a.objects[r.URL.Path]; o != nil {
			_ = json.NewEncoder(w).Encode(o)
			return
		}
		// Bounded namespace inventory; the job selector excludes unrelated Pods.
		if strings.Count(r.URL.Path, "/") == 5 && !strings.HasPrefix(r.URL.Path, "/apis/") || strings.Count(r.URL.Path, "/") == 6 && strings.HasPrefix(r.URL.Path, "/apis/") {
			items := []any{}
			for path, o := range a.objects {
				if !strings.HasPrefix(path, r.URL.Path+"/") {
					continue
				}
				selector := r.URL.Query().Get("labelSelector")
				if selector != "" && bm(bm(o["metadata"])["labels"])["controller-uid"] != strings.TrimPrefix(selector, "controller-uid=") {
					continue
				}
				items = append(items, o)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
			return
		}
		http.NotFound(w, r)
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	o := a.objects[r.URL.Path]
	if o == nil {
		w.WriteHeader(404)
		return
	}
	var options map[string]any
	if json.NewDecoder(r.Body).Decode(&options) != nil {
		w.WriteHeader(400)
		return
	}
	if a.replace {
		a.replace = false
		bm(o["metadata"])["uid"] = "replacement-uid"
	}
	preconditions := bm(options["preconditions"])
	if preconditions["uid"] == "" || preconditions["resourceVersion"] == "" || preconditions["uid"] != bm(o["metadata"])["uid"] || preconditions["resourceVersion"] != bm(o["metadata"])["resourceVersion"] || options["propagationPolicy"] != "Foreground" {
		w.WriteHeader(409)
		return
	}
	a.deletes++
	if !a.hold {
		delete(a.objects, r.URL.Path)
		if o["kind"] == "Job" {
			for path, child := range a.objects {
				if child["kind"] != "Pod" {
					continue
				}
				refs, _ := bm(child["metadata"])["ownerReferences"].([]any)
				for _, ref := range refs {
					if bm(ref)["uid"] == preconditions["uid"] {
						delete(a.objects, path)
					}
				}
			}
		}
	}
	if a.dropReply {
		a.dropReply = false
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			_ = conn.Close()
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": "v1", "kind": "Status", "status": "Success"})
}

func cleanupSettings() cleanup.Settings {
	return cleanup.Settings{Enabled: true, BuildRetention: 24 * time.Hour, ReleaseRetention: 7 * 24 * time.Hour}
}

func completedCleanupBuild(t *testing.T) (*buildFixture, build.Build, *cleanup.Service, *cleanupAPI) {
	t.Helper()
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "cleanup-build", 202))
	for range 3 {
		b.step(t)
	}
	b.kube.complete = true
	b.step(t)
	_, err := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET finished_at=clock_timestamp()-interval '2 days',next_poll_at=clock_timestamp()-interval '1 second' WHERE build_id=$1", out.ID)
	if err != nil {
		t.Fatal(err)
	}
	a := &cleanupAPI{mu: &b.kube.mu, objects: b.kube.objects, fallback: b.kube.server.Config.Handler}
	// Existing execution fixtures omit TypeMeta/owner apiVersion in Pods. Supply
	// the actual API identity when used by the collector's stricter exit checks.
	original := a.fallback
	a.fallback = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/pods") {
			b.kube.mu.Lock()
			defer b.kube.mu.Unlock()
			items := []any{}
			for _, o := range b.kube.objects {
				if o["kind"] == "Job" {
					pod := b.kube.pod(o)
					for _, ref := range bm(pod["metadata"])["ownerReferences"].([]any) {
						bm(ref)["apiVersion"] = "batch/v1"
					}
					items = append(items, pod)
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
			return
		}
		original.ServeHTTP(w, r)
	})
	b.kube.server.Config.Handler = a
	vault, _ := credential.New(testCredentialKey)
	w := cleanup.New(b.c.f.pool, b.worker, release.New(b.c.f.pool, vault, release.Settings{}, release.NewHelm()), cleanupSettings())
	return b, out, w, a
}

func cleanupDue(t *testing.T, b *buildFixture) {
	t.Helper()
	if _, err := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET next_cleanup_at=clock_timestamp()-interval '1 second'"); err != nil {
		t.Fatal(err)
	}
}

func cleanupBuildStep(t *testing.T, w *cleanup.Service, want bool) {
	t.Helper()
	got, err := w.ProcessBuild(context.Background())
	if err != nil || got != want {
		t.Fatal("build cleanup", got, err)
	}
}

func TestResourceCleanupBuildArchiveGateAndHistory(t *testing.T) {
	b, out, w, a := completedCleanupBuild(t)
	cleanupBuildStep(t, w, true)
	if a.deletes != 0 {
		t.Fatal("unarchived logs lost")
	}
	if err := b.worker.ArchiveOne(context.Background()); err != nil {
		t.Fatal(err)
	}
	var attemptID string
	if err := b.c.f.pool.QueryRow(context.Background(), "SELECT id FROM build_attempts WHERE build_id=$1", out.ID).Scan(&attemptID); err != nil {
		t.Fatal(err)
	}
	archivePath := filepath.Join(b.worker.Settings.DataDir, "logs", "builds", attemptID+".ndjson")
	original, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	for _, state := range []string{"missing", "corrupt"} {
		t.Run(state+"_archive", func(t *testing.T) {
			if state == "missing" {
				if err := os.Remove(archivePath); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(archivePath, []byte("corrupt"), 0600); err != nil {
				t.Fatal(err)
			}
			cleanupDue(t, b)
			cleanupBuildStep(t, w, true)
			if a.deletes != 0 {
				t.Fatal("unavailable archive permitted cleanup")
			}
		})
	}
	if err := os.WriteFile(archivePath, original, 0600); err != nil {
		t.Fatal(err)
	}
	cleanupDue(t, b)
	cleanupBuildStep(t, w, true)
	if a.deletes != 3 || len(a.objects) != 0 {
		t.Fatal("execution resources not collected", a.deletes, len(a.objects))
	}
	got := decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+out.ID, b.c.developer, nil, 200))
	if got.Status != "succeeded" || got.ArtifactID == nil {
		t.Fatal("business history changed")
	}
	var archived, cleaned, audited bool
	if err := b.c.f.pool.QueryRow(context.Background(), `SELECT a.log_availability='archived',a.resources_cleaned_at IS NOT NULL,
 EXISTS(SELECT 1 FROM audit_events WHERE action='build.resources.cleanup' AND result='succeeded') FROM build_attempts a WHERE a.build_id=$1`, out.ID).Scan(&archived, &cleaned, &audited); err != nil || !archived || !cleaned || !audited {
		t.Fatal("cleanup evidence missing", err)
	}
	rows, err := sqlcdb.New(b.c.f.pool).ListBuildAttempts(context.Background(), out.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = b.worker.ReadLogs(context.Background(), rows[0]); err != nil {
		t.Fatal("archived logs not readable after cleanup", err)
	}
	cleanupBuildStep(t, w, false)
}

func TestResourceCleanupBuildLostReplyReplacementAndRetry(t *testing.T) {
	b, _, w, a := completedCleanupBuild(t)
	// Expired runtime logs permit collection even when no archive was possible.
	if _, err := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET finished_at=clock_timestamp()-interval '8 days'"); err != nil {
		t.Fatal(err)
	}
	a.dropReply = true
	cleanupBuildStep(t, w, true)
	var cleaned bool
	if err := b.c.f.pool.QueryRow(context.Background(), "SELECT resources_cleaned_at IS NOT NULL FROM build_attempts WHERE job_uid IS NOT NULL").Scan(&cleaned); err != nil || cleaned {
		t.Fatal("lost reply considered finished", err)
	}
	cleanupDue(t, b)
	// Restart gets the same durable inputs. It observes the absent old Job and
	// cleans the remaining execution-owned objects without recreating anything.
	vault, _ := credential.New(testCredentialKey)
	w = cleanup.New(b.c.f.pool, b.worker, release.New(b.c.f.pool, vault, release.Settings{}, release.NewHelm()), cleanupSettings())
	cleanupBuildStep(t, w, true)
	if a.deletes != 3 || b.kube.creates != 1 {
		t.Fatal("restart replayed execution or lost cleanup")
	}
	if err := database.Migrate(b.c.f.dsn, true); err == nil {
		t.Fatal("cleanup history allowed destructive metadata downgrade")
	}
}

func TestResourceCleanupExpiredArchiveDoesNotLeakFile(t *testing.T) {
	b, out, w, a := completedCleanupBuild(t)
	if err := b.worker.ArchiveOne(context.Background()); err != nil {
		t.Fatal(err)
	}
	var key string
	if err := b.c.f.pool.QueryRow(context.Background(), "UPDATE log_archives SET expires_at=clock_timestamp()-interval '1 second' WHERE build_attempt_id=(SELECT id FROM build_attempts WHERE build_id=$1) RETURNING storage_key", out.ID).Scan(&key); err != nil {
		t.Fatal(err)
	}
	cleanupBuildStep(t, w, true)
	if _, err := os.Stat(filepath.Join(b.worker.Settings.DataDir, filepath.FromSlash(key))); !os.IsNotExist(err) {
		t.Fatal("GC expired metadata but leaked archive file", err)
	}
	var expired, cleaned bool
	if err := b.c.f.pool.QueryRow(context.Background(), "SELECT log_availability='expired',resources_cleaned_at IS NOT NULL FROM build_attempts WHERE build_id=$1", out.ID).Scan(&expired, &cleaned); err != nil || !expired || !cleaned || a.deletes != 3 {
		t.Fatal("expired archive state or cleanup missing", err)
	}
}

func TestResourceCleanupBuildIdentityExitAndConcurrency(t *testing.T) {
	b, _, w, a := completedCleanupBuild(t)
	t.Run("retention_status_and_lease", func(t *testing.T) {
		for _, statement := range []string{
			"UPDATE build_attempts SET finished_at=clock_timestamp() WHERE job_uid IS NOT NULL",
			"UPDATE build_attempts SET finished_at=clock_timestamp()-interval '8 days',status='unknown' WHERE job_uid IS NOT NULL",
			"UPDATE build_attempts SET status='succeeded',lease_expires_at=clock_timestamp()+interval '1 minute' WHERE job_uid IS NOT NULL",
		} {
			if _, err := b.c.f.pool.Exec(context.Background(), statement); err != nil {
				t.Fatal(err)
			}
			cleanupBuildStep(t, w, false)
		}
		if _, err := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET lease_expires_at=NULL WHERE job_uid IS NOT NULL"); err != nil {
			t.Fatal(err)
		}
		if a.deletes != 0 {
			t.Fatal("protected attempt resources deleted")
		}
	})
	if _, err := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET finished_at=clock_timestamp()-interval '8 days'"); err != nil {
		t.Fatal(err)
	}
	t.Run("active_pod", func(t *testing.T) {
		b.kube.terminalHeld = true
		cleanupBuildStep(t, w, true)
		if a.deletes != 0 {
			t.Fatal("active pod deleted")
		}
		b.kube.terminalHeld = false
		cleanupDue(t, b)
	})
	t.Run("concurrent_collectors", func(t *testing.T) {
		entered, proceed := make(chan struct{}), make(chan struct{})
		var releaseOnce sync.Once
		unblock := func() { releaseOnce.Do(func() { close(proceed) }) }
		t.Cleanup(unblock)
		var once sync.Once
		a.hook = func(r *http.Request) { once.Do(func() { close(entered); <-proceed }) }
		type result struct {
			got bool
			err error
		}
		done := make(chan result, 1)
		go func() { got, err := w.ProcessBuild(context.Background()); done <- result{got, err} }()
		select {
		case <-entered:
		case <-time.After(5 * time.Second):
			t.Fatal("no cleanup read")
		}
		cleanupBuildStep(t, w, false)
		a.replace = true
		unblock()
		r := <-done
		if r.err != nil || !r.got {
			t.Fatal(r)
		}
		a.hook = nil
		if a.deletes != 0 {
			t.Fatal("replacement UID deleted")
		}
		cleanupDue(t, b)
		cleanupBuildStep(t, w, true)
		if a.deletes != 0 {
			t.Fatal("replacement UID adopted on retry")
		}
	})
}

func TestResourceCleanupDrainFinishesClaimedStep(t *testing.T) {
	b, _, w, a := completedCleanupBuild(t)
	if _, err := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET finished_at=clock_timestamp()-interval '8 days'"); err != nil {
		t.Fatal(err)
	}
	entered, proceed := make(chan struct{}), make(chan struct{})
	var first, releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(proceed) }) }
	t.Cleanup(unblock)
	a.hook = func(r *http.Request) { first.Do(func() { close(entered); <-proceed }) }
	drain, stop := context.WithCancel(context.Background())
	defer stop()
	work, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); w.RunDraining(drain, work) }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("cleanup did not claim")
	}
	stop()
	unblock()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("cleanup did not drain")
	}
	var cleaned bool
	if err := b.c.f.pool.QueryRow(context.Background(), "SELECT resources_cleaned_at IS NOT NULL FROM build_attempts WHERE job_uid IS NOT NULL").Scan(&cleaned); err != nil || !cleaned || a.deletes != 3 {
		t.Fatal("drain abandoned acquired cleanup", err)
	}
}

func TestResourceCleanupDisabledAndMigrationRoundTrip(t *testing.T) {
	w := cleanup.New(nil, nil, nil, cleanup.Settings{})
	if got, err := w.ProcessBuild(context.Background()); got || err != nil {
		t.Fatal("disabled build collector performed I/O")
	}
	if got, err := w.ProcessRelease(context.Background()); got || err != nil {
		t.Fatal("disabled release collector performed I/O")
	}
	dsn, pool := testDatabase(t)
	if err := database.Migrate(dsn, true); err != nil {
		t.Fatal(err)
	}
	if database.CheckSchema(context.Background(), pool) == nil {
		t.Fatal("v18 accepted by v19 binary")
	}
	if err := database.Migrate(dsn, false); err != nil {
		t.Fatal(err)
	}
	if err := database.CheckSchema(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
}

func obsoleteRelease(t *testing.T, kind string) (*applicationResourceFixture, *cleanup.Service, *cleanupAPI) {
	t.Helper()
	f := setupApplicationResources(t, kind)
	// Confirm a second release via the actual preview/confirmation path. Only the
	// isolated fake's successful remote observation is seeded below.
	p := f.preview(t, 3)
	r := decode[application.ReleaseRequest](t, f.confirm(t, p, "cleanup-current", 202))
	ctx := context.Background()
	for _, s := range []struct {
		query string
		args  []any
	}{
		{"UPDATE deployments SET finished_at=clock_timestamp()-interval '8 days',created_at=clock_timestamp()-interval '9 days' WHERE id=$1", []any{f.plan.DeploymentID}},
		{"UPDATE deployments SET status='succeeded',finished_at=clock_timestamp() WHERE id=$1", []any{*r.DeploymentID}},
		{"UPDATE app_environment_bindings SET current_deployment_id=$2 WHERE id=$1", []any{f.binding, *r.DeploymentID}},
	} {
		if _, err := f.c.f.pool.Exec(ctx, s.query, s.args...); err != nil {
			t.Fatal(err)
		}
	}
	a := &cleanupAPI{mu: &f.api.mu, objects: f.api.objects}
	f.api.server.Config.Handler = a
	// Keep only the real controller Pod: spoofed test Pods are outside the old
	// Job's selector and should not be considered collector-owned dependents.
	for _, o := range a.objects {
		if o["kind"] == "Pod" {
			refs, _ := bm(o["metadata"])["ownerReferences"].([]any)
			if len(refs) == 1 && bm(refs[0])["kind"] == "Job" {
				bm(o["metadata"])["labels"] = map[string]any{"controller-uid": "Job-fixture"}
			}
		}
	}
	vault, _ := credential.New(testCredentialKey)
	w := cleanup.New(f.c.f.pool, build.New(f.c.f.pool, vault, build.Settings{}), release.New(f.c.f.pool, vault, release.Settings{}, release.NewHelm()), cleanupSettings())
	return f, w, a
}

func cleanupReleaseStep(t *testing.T, w *cleanup.Service, want bool) {
	t.Helper()
	got, err := w.ProcessRelease(context.Background())
	if got != want || err != nil {
		t.Fatal("release cleanup", got, err)
	}
}

func TestResourceCleanupReleaseSupersededJobAndSecret(t *testing.T) {
	f, w, a := obsoleteRelease(t, "Job")
	ctx := context.Background()
	var current string
	if err := f.c.f.pool.QueryRow(ctx, "SELECT current_deployment_id FROM app_environment_bindings WHERE id=$1", f.binding).Scan(&current); err != nil {
		t.Fatal(err)
	}
	t.Run("current_success_protected", func(t *testing.T) {
		if _, err := f.c.f.pool.Exec(ctx, "UPDATE app_environment_bindings SET current_deployment_id=$2 WHERE id=$1", f.binding, f.plan.DeploymentID); err != nil {
			t.Fatal(err)
		}
		cleanupReleaseStep(t, w, false)
		if _, err := f.c.f.pool.Exec(ctx, "UPDATE app_environment_bindings SET current_deployment_id=$2 WHERE id=$1", f.binding, current); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("unknown_protected", func(t *testing.T) {
		if _, err := f.c.f.pool.Exec(ctx, "UPDATE deployments SET status='unknown' WHERE id=$1", f.plan.DeploymentID); err != nil {
			t.Fatal(err)
		}
		cleanupReleaseStep(t, w, false)
		if _, err := f.c.f.pool.Exec(ctx, "UPDATE deployments SET status='succeeded' WHERE id=$1", f.plan.DeploymentID); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("active_lease_protected", func(t *testing.T) {
		if _, err := f.c.f.pool.Exec(ctx, "UPDATE deployments SET lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1", f.plan.DeploymentID); err != nil {
			t.Fatal(err)
		}
		cleanupReleaseStep(t, w, false)
		if _, err := f.c.f.pool.Exec(ctx, "UPDATE deployments SET lease_until=NULL WHERE id=$1", f.plan.DeploymentID); err != nil {
			t.Fatal(err)
		}
	})
	if a.deletes != 0 {
		t.Fatal("protected release resources deleted")
	}
	cleanupReleaseStep(t, w, true)
	if a.deletes != 2 {
		t.Fatal("obsolete Job and Secret not collected", a.deletes)
	}
	var retained, cleaned bool
	if err := f.c.f.pool.QueryRow(context.Background(), `SELECT status='succeeded', resources_cleaned_at IS NOT NULL FROM deployments WHERE id=$1`, f.plan.DeploymentID).Scan(&retained, &cleaned); err != nil || !retained || !cleaned {
		t.Fatal("historical deployment changed", err)
	}
	cleanupReleaseStep(t, w, false)
	if err := database.Migrate(f.c.f.dsn, true); err == nil {
		t.Fatal("release cleanup evidence removed by downgrade")
	}
}

func TestResourceCleanupReleaseConsumersAndTargetHolds(t *testing.T) {
	f, w, a := obsoleteRelease(t, "Deployment")
	var secretPath, secretName string
	for path, o := range a.objects {
		if o["kind"] == "Secret" {
			secretPath = path
			secretName = fmt.Sprint(bm(o["metadata"])["name"])
		}
	}
	// A retained old ReplicaSet can need the previous version's Secret even when
	// replicas=0. Current success alone is insufficient proof of non-use.
	for _, o := range a.objects {
		if o["kind"] == "ReplicaSet" {
			o["spec"] = map[string]any{"replicas": 0, "template": map[string]any{"spec": map[string]any{"volumes": []any{map[string]any{"name": "old", "secret": map[string]any{"secretName": secretName}}}}}}
		}
	}
	cleanupReleaseStep(t, w, true)
	if a.deletes != 0 {
		t.Fatal("referenced Secret deleted")
	}
	ctx := context.Background()
	for path, o := range a.objects {
		if o["kind"] == "ReplicaSet" {
			delete(a.objects, path)
		}
	}
	// The fixture's old Deployment also references the old Secret; simulate the
	// newer successful controller adopting its own new per-deployment Secret.
	for _, o := range a.objects {
		if o["kind"] == "Deployment" {
			bm(bm(bm(o["spec"])["template"])["spec"])["containers"] = []any{map[string]any{"name": "app", "image": f.plan.ImageRef}}
		}
	}
	if _, err := f.c.f.pool.Exec(ctx, "UPDATE deployments SET next_cleanup_at=clock_timestamp()-interval '1 second' WHERE id=$1", f.plan.DeploymentID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.c.f.pool.Exec(ctx, "UPDATE deployment_targets SET active_deployment_id=$1 WHERE id=$2", f.plan.DeploymentID, f.plan.TargetID); err != nil {
		t.Fatal(err)
	}
	cleanupReleaseStep(t, w, false)
	if a.deletes != 0 {
		t.Fatal("target hold ignored")
	}
	if _, err := f.c.f.pool.Exec(ctx, "UPDATE deployment_targets SET active_deployment_id=NULL WHERE id=$1", f.plan.TargetID); err != nil {
		t.Fatal(err)
	}
	cleanupReleaseStep(t, w, true)
	if a.deletes != 1 || a.objects[secretPath] != nil || a.objects[f.workload] == nil {
		t.Fatal("cleanup deleted workload or retained unreferenced secret", a.deletes)
	}
}

func TestResourceCleanupReleaseMissingJobProtectsOrphanPods(t *testing.T) {
	f, w, a := obsoleteRelease(t, "Job")
	delete(a.objects, f.workload)
	podPath := "/api/v1/namespaces/demo/pods/demo-pod"
	bm(a.objects[podPath]["status"])["phase"] = "Running"
	cleanupReleaseStep(t, w, true)
	if a.deletes != 0 {
		t.Fatal("missing Job treated as proof that its Pods exited")
	}
	delete(a.objects, podPath)
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET next_cleanup_at=clock_timestamp()-interval '1 second' WHERE id=$1", f.plan.DeploymentID); err != nil {
		t.Fatal(err)
	}
	cleanupReleaseStep(t, w, true)
	if a.deletes != 1 {
		t.Fatal("cleanup did not resume after orphan Pod disappeared")
	}
}
