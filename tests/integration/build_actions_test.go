package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
)

func buildActionRequest(b *buildFixture, id, action, key, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/api/builds/"+id+"/"+action, bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Idempotency-Key", key)
	w := httptest.NewRecorder()
	b.c.f.handler.ServeHTTP(w, r)
	return w
}
func buildAction(t *testing.T, b *buildFixture, id, action, key string, want int) json.RawMessage {
	t.Helper()
	w := buildActionRequest(b, id, action, key, b.c.developer)
	if w.Code != want {
		t.Fatalf("%s: got %d want %d: %s", action, w.Code, want, w.Body.String())
	}
	return w.Body.Bytes()
}
func buildState(t *testing.T, b *buildFixture, id string) build.Build {
	t.Helper()
	return decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+id, b.c.developer, nil, 200))
}
func buildRows(t *testing.T, b *buildFixture, id string) []sqlcdb.BuildAttempt {
	t.Helper()
	rows, err := sqlcdb.New(b.c.f.pool).ListBuildAttempts(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func sameBuildJSON(a, b []byte) bool {
	var left, right any
	return json.Unmarshal(a, &left) == nil && json.Unmarshal(b, &right) == nil && reflect.DeepEqual(left, right)
}

func TestBuildActionQueuedCancelAndFrozenRetry(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "queued-action-build", 202))
	original := buildRows(t, b, out.ID)[0]
	b.worker.Settings.Enabled = false
	first := buildAction(t, b, out.ID, "cancel", "queued-cancel-key", 202)
	if decode[build.Build](t, first).Status != "canceled" || b.kube.creates != 0 {
		t.Fatal("queued cancellation submitted external work")
	}
	if !sameBuildJSON(first, buildAction(t, b, out.ID, "cancel", "queued-cancel-key", 202)) {
		t.Fatal("cancel replay changed")
	}
	buildAction(t, b, out.ID, "retry", "disabled-retry-key", 503)
	if len(buildRows(t, b, out.ID)) != 1 {
		t.Fatal("disabled retry created attempt")
	}
	b.worker.Settings.Enabled = true
	b.worker.Settings.RunnerImage = "registry.test/new@sha256:" + strings.Repeat("b", 64)
	// Both current configuration and credential versions change; retries retain
	// the exact prior build inputs, including the old usable credential version.
	var old build.ExecutionSpec
	_ = json.Unmarshal(original.ExecutionSpec, &old)
	var registryID string
	if err := b.c.f.pool.QueryRow(context.Background(), "SELECT id FROM registries WHERE endpoint=$1", old.RegistryEndpoint).Scan(&registryID); err != nil {
		t.Fatal(err)
	}
	b.c.f.call("PUT", "/api/apps/"+b.app+"/config", b.c.developer, map[string]any{"expectedVersion": 2, "section": "build", "buildConfig": map[string]any{"dockerfile": "other.Dockerfile", "context": ".", "registryId": registryID, "imageRepository": "team/new", "platform": "linux/amd64", "timeoutSeconds": 900, "buildArgs": map[string]string{"NEW": "value"}}}, 200)
	b.c.f.call("PUT", "/api/credentials/"+old.ClusterCredential.ID, b.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"apiServer": b.kube.server.URL, "token": "unusable-new-token", "insecureSkipTLSVerify": true}}, 200)
	retried := buildAction(t, b, out.ID, "retry", "disabled-retry-key", 202)
	if got := decode[build.Build](t, retried); got.ID != out.ID || got.AttemptNo != 2 || got.ConfigVersion != 2 {
		t.Fatal("retry changed build identity/config")
	}
	rows := buildRows(t, b, out.ID)
	var next build.ExecutionSpec
	_ = json.Unmarshal(rows[1].ExecutionSpec, &next)
	if old.AttemptID == next.AttemptID || old.JobName == next.JobName || old.ImageTag() == next.ImageTag() {
		t.Fatal("retry reused external identity")
	}
	old.AttemptID = next.AttemptID
	old.JobName = next.JobName
	if !reflect.DeepEqual(old, next) {
		t.Fatal("retry adopted latest inputs")
	}
	b.remote.Server.Close()
	b.worker.Settings.Enabled = false
	if !sameBuildJSON(retried, buildAction(t, b, out.ID, "retry", "disabled-retry-key", 202)) {
		t.Fatal("offline replay changed")
	}
	b.worker.Settings.Enabled = true
	for range 3 {
		b.step(t)
	}
	if b.kube.creates != 1 || b.kube.starts != 1 {
		t.Fatal("frozen retry did not start once")
	}
	buildAction(t, b, out.ID, "retry", "retry-active-denied", 409)
}

func TestBuildActionRunningCancelWaitsForExitAndRecovers(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "running-cancel-build", 202))
	for range 3 {
		b.step(t)
	}
	if decode[build.Build](t, buildAction(t, b, out.ID, "cancel", "running-cancel-key", 202)).Status != "canceling" {
		t.Fatal("cancel not persisted")
	}
	b.kube.dropSuspend = true
	b.step(t)
	if buildState(t, b, out.ID).Status != "unknown" {
		t.Fatal("lost suspend response not unknown")
	}
	buildAction(t, b, out.ID, "retry", "retry-unknown-denied", 409)
	vault, _ := credential.New(testCredentialKey)
	worker := build.New(b.c.f.pool, vault, b.worker.Settings)
	worker.RegistryTransport = b.worker.RegistryTransport
	b.worker = worker
	b.step(t)
	if buildState(t, b, out.ID).Status != "canceling" {
		t.Fatal("live Pod falsely confirmed stopped")
	}
	b.kube.cancelExited = true
	b.step(t)
	if buildState(t, b, out.ID).Status != "canceled" || b.kube.suspends != 1 || b.kube.creates != 1 {
		t.Fatal("cancel did not converge safely")
	}
	old := buildRows(t, b, out.ID)[0]
	if old.JobUid == nil || old.CancelRequestedAt == nil {
		t.Fatal("cancel lost durable evidence")
	}
	if _, err := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET next_poll_at=now()-interval '1 second'"); err != nil {
		t.Fatal(err)
	}
	if err := b.worker.ArchiveOne(context.Background()); err != nil {
		t.Fatal(err)
	}
	buildAction(t, b, out.ID, "retry", "running-retry-key", 202)
	if len(buildRows(t, b, out.ID)) != 2 {
		t.Fatal("retry missing")
	}
	// Following a historical attempt must end with its own canceled state even
	// while the latest attempt is queued. Its archived logs remain readable.
	logCtx, stop := context.WithTimeout(context.Background(), 3*time.Second)
	defer stop()
	r := httptest.NewRequest("GET", "/api/builds/"+out.ID+"/logs?attemptNo=1&follow=true", nil).WithContext(logCtx)
	r.Header.Set("Authorization", "Bearer "+b.c.developer)
	w := httptest.NewRecorder()
	b.c.f.handler.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"canceled"`) || !strings.Contains(w.Body.String(), "fixture output") {
		t.Fatalf("historical logs: %d %s", w.Code, w.Body.String())
	}
	if _, err := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET cancel_requested_at=NULL,cancel_requested_by=NULL WHERE id=$1", old.ID); err == nil {
		t.Fatal("cancel intent mutable")
	}
	downgradeHealthSchedule(t, b.c.f.dsn)
	if err := database.Migrate(b.c.f.dsn, true); err != nil {
		t.Fatal("v16 to v15 without auto deployment state", err)
	}
	if err := database.Migrate(b.c.f.dsn, true); err != nil {
		t.Fatal("v15 to v14 without webhook state", err)
	}
	if err := database.Migrate(b.c.f.dsn, true); err != nil {
		t.Fatal("v14 to v13 without drift history", err)
	}
	if err := database.Migrate(b.c.f.dsn, true); err != nil {
		t.Fatal("v13 to v12 without action history", err)
	}
	if err := database.Migrate(b.c.f.dsn, true); err != nil {
		t.Fatal("v12 to v11 without resource history", err)
	}
	if err := database.Migrate(b.c.f.dsn, true); err != nil {
		t.Fatal("v11 to v10", err)
	}
	if err := database.Migrate(b.c.f.dsn, true); err == nil {
		t.Fatal("downgrade lost cancellation history")
	}
}

func TestBuildActionCancelCompletionRace(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "complete-cancel-build", 202))
	for range 3 {
		b.step(t)
	}
	buildAction(t, b, out.ID, "cancel", "complete-cancel-key", 202)
	b.kube.complete = true
	b.registryFail = true
	b.step(t)
	if buildState(t, b, out.ID).Status != "unknown" {
		t.Fatal("unverified completion canceled")
	}
	assertCode(t, buildAction(t, b, out.ID, "retry", "complete-retry-denied", 409), "outcome_unknown")
	b.registryFail = false
	b.step(t)
	got := buildState(t, b, out.ID)
	if got.Status != "succeeded" || got.ArtifactID == nil || b.kube.suspends != 0 {
		t.Fatal("verified completion did not win")
	}
	buildAction(t, b, out.ID, "retry", "succeeded-retry-denied", 409)
	if decode[build.Build](t, buildAction(t, b, out.ID, "cancel", "terminal-cancel-key", 202)).Status != "succeeded" {
		t.Fatal("terminal cancellation rewrote success")
	}
}

func TestBuildActionAmbiguousAndReplacementNeverResubmits(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "ambiguous-cancel-build", 202))
	b.kube.dropCreate = true
	b.step(t)
	buildAction(t, b, out.ID, "cancel", "ambiguous-cancel-key", 202)
	b.kube.missing = true
	b.step(t)
	if buildState(t, b, out.ID).Status != "unknown" || b.kube.creates != 1 {
		t.Fatal("ambiguous creation assumed stopped or resubmitted")
	}
	b.kube.missing = false
	b.step(t)
	if buildRows(t, b, out.ID)[0].JobUid == nil {
		t.Fatal("cancel recovery did not save discovered UID")
	}
	for _, o := range b.kube.objects {
		if o["kind"] == "Job" {
			bm(o["metadata"])["uid"] = "stranger"
		}
	}
	b.step(t)
	if buildState(t, b, out.ID).Status != "unknown" || b.kube.suspends != 0 {
		t.Fatal("replacement was patched")
	}
}

func TestBuildActionFailedRetryRequiresPodExitAndIsConcurrent(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "failed-retry-build", 202))
	for range 3 {
		b.step(t)
	}
	b.kube.failed = true
	b.kube.terminalHeld = true
	b.step(t)
	if buildState(t, b, out.ID).Status != "running" {
		t.Fatal("failed condition alone confirmed exit")
	}
	b.kube.terminalHeld = false
	b.step(t)
	if buildState(t, b, out.ID).Status != "failed" {
		t.Fatal("terminal failure not settled")
	}
	// A legacy failure may still have a running Pod; admission must independently
	// recheck Kubernetes before creating a replacement attempt.
	b.kube.terminalHeld = true
	assertCode(t, buildAction(t, b, out.ID, "retry", "legacy-live-pod-key", 409), "build_exit_unconfirmed")
	b.kube.terminalHeld = false
	var wg sync.WaitGroup
	responses := make([]*httptest.ResponseRecorder, 4)
	for i := range responses {
		wg.Add(1)
		go func() {
			defer wg.Done()
			responses[i] = buildActionRequest(b, out.ID, "retry", "concurrent-retry-key", b.c.developer)
		}()
	}
	wg.Wait()
	for _, w := range responses {
		if w.Code != 202 || !sameBuildJSON(w.Body.Bytes(), responses[0].Body.Bytes()) {
			t.Fatalf("concurrent retry: %d %s", w.Code, w.Body.String())
		}
	}
	if len(buildRows(t, b, out.ID)) != 2 {
		t.Fatal("concurrent retry duplicated attempts")
	}
	buildAction(t, b, out.ID, "retry", "second-retry-key", 409)
	b.c.f.call("DELETE", "/api/projects/"+b.c.projectID+"/members/"+b.c.dev.ID, b.c.admin, nil, 204)
	if w := buildActionRequest(b, out.ID, "retry", "concurrent-retry-key", b.c.developer); w.Code == 202 {
		t.Fatal("revoked actor replayed result")
	}
}

func TestBuildActionCancelRetainsInFlightLease(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "leased-cancel-build", 202))
	q := sqlcdb.New(b.c.f.pool)
	ctx := context.Background()
	owner := "in-flight-worker"
	claimed, err := q.ClaimBuildAttempt(ctx, &owner)
	if err != nil {
		t.Fatal(err)
	}
	buildAction(t, b, out.ID, "cancel", "leased-cancel-key", 202)
	row := buildRows(t, b, out.ID)[0]
	if row.Revision != claimed.Revision || row.LeaseOwner == nil || *row.LeaseOwner != owner || row.Stage != "planned" {
		t.Fatal("cancel revoked in-flight lease")
	}
	if _, err = q.MarkBuildCreateIntent(ctx, sqlcdb.MarkBuildCreateIntentParams{ID: row.ID, Revision: row.Revision, LeaseOwner: &owner}); err == nil {
		t.Fatal("canceled attempt acquired create intent")
	}
	if _, err = b.c.f.pool.Exec(ctx, "UPDATE build_attempts SET lease_expires_at=now()-interval '1 second' WHERE id=$1", row.ID); err != nil {
		t.Fatal(err)
	}
	b.step(t)
	if buildState(t, b, out.ID).Status != "canceled" || b.kube.creates != 0 {
		t.Fatal("expired planned lease did not cancel safely")
	}
}

func TestBuildActionMigrationAndValidation(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "migration-action-build", 202))
	before := buildRows(t, b, out.ID)[0]
	downgradeHealthSchedule(t, b.c.f.dsn)
	if err := database.Migrate(b.c.f.dsn, true); err != nil {
		t.Fatal("v16 to v15 without auto deployment state", err)
	}
	if err := database.Migrate(b.c.f.dsn, true); err != nil {
		t.Fatal("v15 to v14 without webhook state", err)
	}
	if err := database.Migrate(b.c.f.dsn, true); err != nil {
		t.Fatal("v14 to v13 without drift history", err)
	}
	if err := database.Migrate(b.c.f.dsn, true); err != nil {
		t.Fatal("v13 to v12 without action history", err)
	}
	if err := database.Migrate(b.c.f.dsn, true); err != nil {
		t.Fatal("v12 to v11 without resource history", err)
	}
	if err := database.Migrate(b.c.f.dsn, true); err != nil {
		t.Fatal("v11 to v10 without external image history", err)
	}
	if err := database.Migrate(b.c.f.dsn, true); err != nil {
		t.Fatal(err)
	}
	if database.CheckSchema(context.Background(), b.c.f.pool) == nil {
		t.Fatal("current binary accepted v9")
	}
	if err := database.Migrate(b.c.f.dsn, false); err != nil {
		t.Fatal(err)
	}
	if after := buildRows(t, b, out.ID)[0]; !bytes.Equal(before.ExecutionSpec, after.ExecutionSpec) || before.ExecutionHash != after.ExecutionHash {
		t.Fatal("upgrade changed build snapshot")
	}
	if _, err := b.c.f.pool.Exec(context.Background(), "UPDATE builds SET commit_sha=repeat('a',40) WHERE id=$1", out.ID); err == nil {
		t.Fatal("build fixed input mutable")
	}
	buildAction(t, b, out.ID, "cancel", "", 422)
	b.c.f.keyed("POST", "/api/builds/"+out.ID+"/cancel", b.c.developer, "unknown-field-key", map[string]any{"unexpected": true}, 422)
	buildAction(t, b, out.ID, "cancel", "migration-cancel-key", 202)
	// Missing historical credentials cannot be replaced with the latest version.
	var spec build.ExecutionSpec
	_ = json.Unmarshal(before.ExecutionSpec, &spec)
	b.c.f.call("PUT", "/api/credentials/"+spec.ClusterCredential.ID, b.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"apiServer": b.kube.server.URL, "token": "new-current-token", "insecureSkipTLSVerify": true}}, 200)
	// Corrupt only the isolated fixture, bypassing immutable-version protection
	// deliberately to exercise admission against a damaged historical backup.
	if _, err := b.c.f.pool.Exec(context.Background(), "ALTER TABLE secret_versions DISABLE TRIGGER USER"); err != nil {
		t.Fatal(err)
	}
	if _, err := b.c.f.pool.Exec(context.Background(), "DELETE FROM secret_versions WHERE credential_id=$1 AND version=$2", spec.ClusterCredential.ID, spec.ClusterCredential.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := b.c.f.pool.Exec(context.Background(), "ALTER TABLE secret_versions ENABLE TRIGGER USER"); err != nil {
		t.Fatal(err)
	}
	assertCode(t, buildAction(t, b, out.ID, "retry", "missing-old-secret", 409), "credential_version_unavailable")
	if len(buildRows(t, b, out.ID)) != 1 {
		t.Fatal("failed admission left phantom attempt")
	}
}

func TestBuildActionInFlightStepsMergeCancellation(t *testing.T) {
	for _, stage := range []string{"create", "prepare", "start"} {
		t.Run(stage, func(t *testing.T) {
			b := setupBuild(t)
			out := decode[build.Build](t, b.trigger(t, "inflight-"+stage+"-build", 202))
			if stage != "create" {
				b.step(t)
			}
			if stage == "start" {
				b.step(t)
			}
			entered, released := make(chan struct{}), make(chan struct{})
			var once, releaseOnce sync.Once
			release := func() { releaseOnce.Do(func() { close(released) }) }
			defer release()
			b.kube.beforeRequest = func(r *http.Request) {
				match := stage == "create" && r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/jobs") || stage == "prepare" && r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/configmaps") || stage == "start" && r.Method == "PATCH"
				if match {
					once.Do(func() { close(entered); <-released })
				}
			}
			if _, err := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET next_poll_at=now()-interval '1 second'"); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { _, err := b.worker.ProcessOne(context.Background()); done <- err }()
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("worker did not reach external step")
			}
			before := buildRows(t, b, out.ID)[0]
			buildAction(t, b, out.ID, "cancel", "inflight-"+stage+"-cancel", 202)
			after := buildRows(t, b, out.ID)[0]
			if before.Revision != after.Revision || after.LeaseOwner == nil {
				t.Fatal("cancel fenced running external step")
			}
			release()
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("worker result did not persist")
			}
			row := buildRows(t, b, out.ID)[0]
			if row.Status != "canceling" || row.JobUid == nil || row.CancelRequestedAt == nil {
				t.Fatal("in-flight result overwrote cancellation or lost UID")
			}
			b.kube.cancelExited = true
			b.step(t)
			if stage == "start" {
				b.step(t)
			}
			if buildState(t, b, out.ID).Status != "canceled" || b.kube.creates != 1 {
				t.Fatal("in-flight cancellation failed to converge")
			}
		})
	}
}

func TestBuildActionRetryUsesCurrentActorAndNoBody(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "retry-current-actor-build", 202))
	r := httptest.NewRequest("POST", "/api/builds/"+out.ID+"/cancel", nil)
	r.Header.Set("Authorization", "Bearer "+b.c.developer)
	r.Header.Set("Idempotency-Key", "no-body-cancel-key")
	w := httptest.NewRecorder()
	b.c.f.handler.ServeHTTP(w, r)
	if w.Code != 202 {
		t.Fatalf("cancel without body: %d %s", w.Code, w.Body.String())
	}
	w = buildActionRequest(b, out.ID, "retry", "admin-retry-key", b.c.admin)
	if w.Code != 202 {
		t.Fatalf("admin retry: %d %s", w.Code, w.Body.String())
	}
	rows := buildRows(t, b, out.ID)
	var spec build.ExecutionSpec
	_ = json.Unmarshal(rows[1].ExecutionSpec, &spec)
	var adminID string
	if err := b.c.f.pool.QueryRow(context.Background(), "SELECT id FROM users WHERE email='admin@example.test'").Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	parent, err := sqlcdb.New(b.c.f.pool).GetBuild(context.Background(), out.ID)
	if err != nil {
		t.Fatal(err)
	}
	if spec.RequestedBy != adminID || parent.RequestedBy != b.c.dev.ID {
		t.Fatal("retry actor or original requester changed incorrectly")
	}
	b.c.f.call("DELETE", "/api/projects/"+b.c.projectID+"/members/"+b.c.dev.ID, b.c.admin, nil, 204)
	for range 3 {
		b.step(t)
	}
	if b.kube.starts != 1 {
		t.Fatal("retry authorization used original requester")
	}
	var actor string
	if err = b.c.f.pool.QueryRow(context.Background(), "SELECT actor_id FROM audit_events WHERE action='build.running' AND target->>'attemptId'=$1", spec.AttemptID).Scan(&actor); err != nil {
		t.Fatal(err)
	}
	if actor != adminID {
		t.Fatal("worker audit attributed retry to original requester")
	}
}
