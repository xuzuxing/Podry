package integration_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/audit"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
	"github.com/xuzuxing/podry/internal/release"
	"github.com/xuzuxing/podry/internal/server"
	helmrelease "helm.sh/helm/v3/pkg/release"
)

// Real PostgreSQL and Helm SDK observations against an isolated read-only TLS
// fixture. No real cluster or Helm Submit is used by these reconciliation tests.
func setupReconciliation(t *testing.T, kind string) *applicationResourceFixture {
	t.Helper()
	f := setupApplicationResources(t, kind)
	ctx := context.Background()
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{"UPDATE deployments SET status='unknown',revision=1,fencing_token=1,started_at=clock_timestamp()-interval '5 seconds' WHERE id=$1", []any{f.plan.DeploymentID}},
		{"UPDATE release_requests SET status='unknown' WHERE id=$1", []any{f.plan.RequestID}},
		{"UPDATE deployment_targets SET active_deployment_id=$2,fencing_token=1 WHERE id=$1", []any{f.plan.TargetID, f.plan.DeploymentID}},
		{"UPDATE app_environment_bindings SET current_deployment_id=NULL WHERE id=$1", []any{f.binding}},
	} {
		if _, err := f.c.f.pool.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	setReconciliationHelm(t, f, helmrelease.StatusDeployed, 1)
	if kind == "Job" {
		// A standard typed PodList may omit TypeMeta on its individual Pods.
		// Keep that legal response shape to exercise the production list decoder.
		f.api.mu.Lock()
		raw, _ := json.Marshal(f.api.objects["/api/v1/namespaces/demo/pods/demo-pod"])
		var pod map[string]any
		if err := json.Unmarshal(raw, &pod); err != nil {
			t.Fatal(err)
		}
		delete(pod, "apiVersion")
		delete(pod, "kind")
		f.api.objects["/api/v1/namespaces/demo/pods"] = map[string]any{"apiVersion": "v1", "kind": "PodList", "items": []any{pod}}
		f.api.mu.Unlock()
	}
	vault, err := credential.New(testCredentialKey)
	if err != nil {
		t.Fatal(err)
	}
	// All background execution switches stay disabled, including release.
	f.apps.UseReleases(release.New(f.c.f.pool, vault, release.Settings{}, release.NewHelm()))
	return f
}

func setReconciliationHelm(t *testing.T, f *applicationResourceFixture, status helmrelease.Status, revision int) {
	t.Helper()
	var hash string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT snapshot_sha256 FROM release_snapshots WHERE id=(SELECT snapshot_id FROM release_requests WHERE id=$1)", f.plan.RequestID).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	configJSON, _ := json.Marshal(f.plan.Chart.Values)
	var values map[string]any
	if err := json.Unmarshal(configJSON, &values); err != nil {
		t.Fatal(err)
	}
	bm(values["podry"])["snapshotSHA256"] = hash
	r := helmrelease.Release{Name: f.plan.Target.ReleaseName, Namespace: f.plan.Target.Namespace, Version: revision, Config: values, Info: &helmrelease.Info{Status: status}}
	raw, _ := json.Marshal(r)
	var compressed bytes.Buffer
	zip := gzip.NewWriter(&compressed)
	_, _ = zip.Write(raw)
	_ = zip.Close()
	f.api.mu.Lock()
	f.api.objects["/api/v1/namespaces/demo/secrets"] = map[string]any{"apiVersion": "v1", "kind": "SecretList", "items": []any{map[string]any{"apiVersion": "v1", "kind": "Secret", "metadata": map[string]any{"name": "sh.helm.release.v1.release-demo.v1", "namespace": "demo", "labels": map[string]any{"owner": "helm", "name": f.plan.Target.ReleaseName, "version": "1", "status": string(status)}}, "type": "helm.sh/release.v1", "data": map[string]any{"release": base64.StdEncoding.EncodeToString([]byte(base64.StdEncoding.EncodeToString(compressed.Bytes())))}}}}
	f.api.mu.Unlock()
}

func reconciliationInput(revision int64) application.ReconcileDeploymentInput {
	return application.ReconcileDeploymentInput{ExpectedRevision: revision, Reason: "人工核对 private-reason-do-not-audit"}
}

func reconcileCall(t *testing.T, f *applicationResourceFixture, revision int64, key string, want int) json.RawMessage {
	t.Helper()
	return f.c.f.keyed("POST", "/api/deployments/"+f.plan.DeploymentID+"/reconcile", f.c.developer, key, reconciliationInput(revision), want)
}

func reconciliationCounts(t *testing.T, f *applicationResourceFixture, want int) {
	t.Helper()
	for _, query := range []string{"SELECT count(*) FROM audit_events WHERE action='deployment.reconcile'", "SELECT count(*) FROM idempotency_records WHERE operation_id='reconcileDeployment'"} {
		var n int
		if err := f.c.f.pool.QueryRow(context.Background(), query).Scan(&n); err != nil || n != want {
			t.Fatal("non-atomic reconciliation result", n, want, err)
		}
	}
}

func reconciliationOccupied(t *testing.T, f *applicationResourceFixture, want bool) {
	t.Helper()
	var occupied bool
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT COALESCE(active_deployment_id=$2,false) FROM deployment_targets WHERE id=$1", f.plan.TargetID, f.plan.DeploymentID).Scan(&occupied); err != nil {
		t.Fatal(err)
	}
	if occupied != want || f.api.writes.Load() != 0 {
		t.Fatal("unsafe target occupancy or external write", occupied, want, f.api.writes.Load())
	}
}

func TestReleaseReconciliationSuccessAndReplay(t *testing.T) {
	f := setupReconciliation(t, "Deployment")
	raw := reconcileCall(t, f, 1, "reconcile-success-key", 200)
	out := decode[application.DeploymentReconciliation](t, raw)
	if out.Status != "succeeded" || out.Revision != 2 || !out.TargetReleased || out.HelmRevision == nil || *out.HelmRevision != 1 || out.CheckedAt.IsZero() || out.ErrorCode != nil {
		t.Fatalf("bad observation: %+v", out)
	}
	reconciliationOccupied(t, f, false)
	reconciliationCounts(t, f, 1)
	var current, requestState string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT current_deployment_id FROM app_environment_bindings WHERE id=$1", f.binding).Scan(&current); err != nil || current != f.plan.DeploymentID {
		t.Fatal("success pointer", current, err)
	}
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT status FROM release_requests WHERE id=$1", f.plan.RequestID).Scan(&requestState); err != nil || requestState != "succeeded" {
		t.Fatal("request state", requestState, err)
	}
	d := decode[application.Deployment](t, f.c.f.call("GET", "/api/deployments/"+f.plan.DeploymentID, f.c.developer, nil, 200))
	if d.Revision != 2 || d.FinishedAt == nil {
		t.Fatal("history revision or completion missing")
	}
	// Rebuilding the application without its vault or executor still replays.
	reads := f.api.reads.Load()
	apps := application.New(f.c.f.pool, nil, nil, testJWT)
	f.c.f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: f.c.f.auth, Project: project.New(f.c.f.pool), Audit: audit.New(f.c.f.pool), Application: apps})
	if replay := reconcileCall(t, f, 1, "reconcile-success-key", 200); !bytes.Equal(raw, replay) || f.api.reads.Load() != reads {
		t.Fatal("replay changed result or performed network I/O")
	}
	reconcileCall(t, f, 2, "reconcile-success-key", 409)
	reconciliationCounts(t, f, 1)
	var leaked int
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_events WHERE target::text LIKE '%private-reason%' OR target::text LIKE '%private-live-secret%' OR target::text LIKE '%snapshotSHA256%'").Scan(&leaked); err != nil || leaked != 0 {
		t.Fatal("audit leaked input, values or manifests", leaked, err)
	}
}

func TestReleaseReconciliationKeepsAmbiguousOutcomes(t *testing.T) {
	for _, mode := range []string{"absent", "pending", "helm-failed", "revision", "uid", "image", "missing", "network"} {
		t.Run(mode, func(t *testing.T) {
			f := setupReconciliation(t, "Deployment")
			switch mode {
			case "pending":
				setReconciliationHelm(t, f, helmrelease.StatusPendingUpgrade, 1)
			case "helm-failed":
				setReconciliationHelm(t, f, helmrelease.StatusFailed, 1)
			case "revision":
				setReconciliationHelm(t, f, helmrelease.StatusDeployed, 2)
			case "network":
				f.api.fail.Store(503)
			default:
				f.api.mu.Lock()
				switch mode {
				case "absent":
					f.api.objects["/api/v1/namespaces/demo/secrets"]["items"] = []any{}
				case "uid":
					bm(f.api.objects[f.workload]["metadata"])["uid"] = "replacement-uid"
				case "image":
					bm(bm(bm(f.api.objects[f.workload]["spec"])["template"])["spec"])["containers"] = []any{map[string]any{"name": "app", "image": "drifted:latest"}}
				case "missing":
					delete(f.api.objects, f.workload)
				}
				f.api.mu.Unlock()
			}
			if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET started_at=clock_timestamp()-interval '1 day' WHERE id=$1", f.plan.DeploymentID); err != nil {
				t.Fatal(err)
			}
			raw := reconcileCall(t, f, 1, "ambiguous-result-key", 200)
			out := decode[application.DeploymentReconciliation](t, raw)
			if out.Status != "unknown" || out.TargetReleased || out.ErrorCode == nil || (out.HelmRevision != nil && *out.HelmRevision != 1) {
				t.Fatalf("ambiguous result was settled: %+v", out)
			}
			reconciliationOccupied(t, f, true)
			reconciliationCounts(t, f, 1)
			if strings.Contains(string(raw), "private remote error") {
				t.Fatal("raw remote error exposed")
			}
		})
	}
}

func TestReleaseReconciliationProgressAndJobResults(t *testing.T) {
	for _, mode := range []string{"progressing", "timeout", "job-complete", "job-failed", "job-no-pod"} {
		t.Run(mode, func(t *testing.T) {
			kind := "Deployment"
			if strings.HasPrefix(mode, "job-") {
				kind = "Job"
			}
			f := setupReconciliation(t, kind)
			f.api.mu.Lock()
			switch mode {
			case "progressing", "timeout":
				f.api.objects[f.workload]["status"] = map[string]any{"observedGeneration": 0}
			case "job-failed":
				f.api.objects[f.workload]["status"] = map[string]any{"conditions": []any{map[string]any{"type": "Failed", "status": "True"}}}
			case "job-no-pod":
				f.api.objects["/api/v1/namespaces/demo/pods"]["items"] = []any{}
				for path := range f.api.objects {
					if strings.Contains(path, "/pods/") {
						delete(f.api.objects, path)
					}
				}
			}
			f.api.mu.Unlock()
			if mode == "timeout" {
				if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET started_at=clock_timestamp()-interval '1 day' WHERE id=$1", f.plan.DeploymentID); err != nil {
					t.Fatal(err)
				}
			}
			want := "observing"
			if mode == "job-complete" {
				want = "succeeded"
			} else if mode == "job-failed" || mode == "timeout" {
				want = "failed"
			}
			out := decode[application.DeploymentReconciliation](t, reconcileCall(t, f, 1, "progress-result-key", 200))
			if out.Status != want {
				t.Fatalf("got %+v, want %s", out, want)
			}
			reconciliationOccupied(t, f, want == "observing")
			if want == "failed" {
				var current *string
				if err := f.c.f.pool.QueryRow(context.Background(), "SELECT current_deployment_id FROM app_environment_bindings WHERE id=$1", f.binding).Scan(&current); err != nil || current != nil {
					t.Fatal("failure advanced success pointer", err)
				}
			}
			if mode == "progressing" {
				f.api.mu.Lock()
				f.api.objects[f.workload]["status"] = map[string]any{"observedGeneration": 1, "replicas": 1, "updatedReplicas": 1, "readyReplicas": 1, "availableReplicas": 1, "conditions": []any{map[string]any{"type": "Available", "status": "True"}}}
				f.api.mu.Unlock()
				out = decode[application.DeploymentReconciliation](t, reconcileCall(t, f, 2, "progress-next-key", 200))
				if out.Status != "succeeded" || out.Revision != 3 {
					t.Fatal("explicit observation could not continue without workers", out)
				}
			}
		})
	}
}

func TestReleaseReconciliationValidationAndLease(t *testing.T) {
	f := setupReconciliation(t, "Deployment")
	path := "/api/deployments/" + f.plan.DeploymentID + "/reconcile"
	for _, in := range []any{reconciliationInput(0), application.ReconcileDeploymentInput{ExpectedRevision: 1, Reason: " "}, application.ReconcileDeploymentInput{ExpectedRevision: 1, Reason: strings.Repeat("x", 1001)}, map[string]any{"expectedRevision": 1, "reason": "check", "status": "succeeded"}} {
		f.c.f.keyed("POST", path, f.c.developer, "validation-check-key", in, 422)
	}
	f.c.f.keyed("POST", path, f.c.developer, "bad", reconciliationInput(1), 422)
	reconcileCall(t, f, 2, "stale-revision-key", 409)
	for _, state := range []string{"queued", "succeeded", "failed"} {
		if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET status=$2 WHERE id=$1", f.plan.DeploymentID, state); err != nil {
			t.Fatal(err)
		}
		raw := reconcileCall(t, f, 1, "non-reconcilable-key", 409)
		if !strings.Contains(string(raw), "deployment_not_reconcilable") {
			t.Fatal(string(raw))
		}
	}
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET status='unknown',lease_owner=$1,lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1", f.plan.DeploymentID); err != nil {
		t.Fatal(err)
	}
	reconcileCall(t, f, 1, "live-lease-check-key", 409)
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", f.plan.DeploymentID); err != nil {
		t.Fatal(err)
	}
	tx, err := f.c.f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(context.Background(), "SELECT id FROM deployments WHERE id=$1 FOR UPDATE", f.plan.DeploymentID); err != nil {
		t.Fatal(err)
	}
	reconcileCall(t, f, 1, "locked-row-check-key", 409)
	_ = tx.Rollback(context.Background())
	if f.api.reads.Load() != 0 {
		t.Fatal("rejected request accessed cluster")
	}
	reconciliationCounts(t, f, 0)
	reconcileCall(t, f, 1, "expired-lease-check-key", 200)
}

func TestReleaseReconciliationAuthorizationAndReplay(t *testing.T) {
	f := setupReconciliation(t, "Job")
	path := "/api/deployments/" + f.plan.DeploymentID + "/reconcile"
	outsider := f.c.f.account("reconcile-outsider@example.test", false)
	f.c.f.keyed("POST", path, f.c.f.login(outsider.Email), "outsider-check-key", reconciliationInput(1), 404)
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE resource_grants SET actions=ARRAY['resource.write'] WHERE id=$1", f.grant); err != nil {
		t.Fatal(err)
	}
	reconcileCall(t, f, 1, "missing-view-check-key", 403)
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE resource_grants SET actions=ARRAY['resource.view','resource.write'],resources=ARRAY['batch/jobs','core/secrets'] WHERE id=$1", f.grant); err != nil {
		t.Fatal(err)
	}
	reconcileCall(t, f, 1, "missing-pods-check-key", 403)
	if f.api.reads.Load() != 0 {
		t.Fatal("unauthorized observation read secrets or pods")
	}
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE resource_grants SET resources=ARRAY['*'] WHERE id=$1", f.grant); err != nil {
		t.Fatal(err)
	}
	reconcileCall(t, f, 1, "authorized-check-key", 200)
	f.c.f.call("DELETE", "/api/clusters/"+f.c.clusterID+"/resource-grants/"+f.grant, f.c.admin, nil, 204)
	reads := f.api.reads.Load()
	reconcileCall(t, f, 1, "authorized-check-key", 403)
	if f.api.reads.Load() != reads {
		t.Fatal("revoked replay observed remotely")
	}
	reconciliationCounts(t, f, 1)
}

func TestReleaseReconciliationDiscardsChangedInputs(t *testing.T) {
	for _, mode := range []string{"resources", "project", "disabled", "logout", "credential", "binding", "fencing", "worker"} {
		t.Run(mode, func(t *testing.T) {
			f := setupReconciliation(t, "Deployment")
			entered, resume := make(chan struct{}), make(chan struct{})
			var once sync.Once
			f.api.mu.Lock()
			f.api.hook = func(*http.Request) { once.Do(func() { close(entered); <-resume }) }
			f.api.mu.Unlock()
			var releaseOnce sync.Once
			t.Cleanup(func() { releaseOnce.Do(func() { close(resume) }) })
			done := make(chan *httptest.ResponseRecorder, 1)
			go func() { done <- reconciliationRequest(f, "changed-input-check-key") }()
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("observation did not start")
			}
			want := 409
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			var err error
			switch mode {
			case "resources":
				_, err = f.c.f.pool.Exec(ctx, "DELETE FROM resource_grants WHERE id=$1", f.grant)
				want = 403
			case "project":
				_, err = f.c.f.pool.Exec(ctx, "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", f.c.projectID, f.c.dev.ID)
				want = 404
			case "disabled":
				_, err = f.c.f.pool.Exec(ctx, "UPDATE users SET disabled_at=clock_timestamp() WHERE id=$1", f.c.dev.ID)
				want = 401
			case "logout":
				_, err = f.c.f.pool.Exec(ctx, "UPDATE users SET token_version=token_version+1 WHERE id=$1", f.c.dev.ID)
				want = 401
			case "credential":
				// The public rotation route also invalidates/locks the cluster row.
				f.c.f.call("PUT", "/api/credentials/"+f.credential, f.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"apiServer": f.api.server.URL, "token": "rotated-fixture", "insecureSkipTLSVerify": true}}, 200)
			case "binding":
				_, err = f.c.f.pool.Exec(ctx, "UPDATE app_environment_bindings SET version=version+1 WHERE id=$1", f.binding)
			case "fencing":
				_, err = f.c.f.pool.Exec(ctx, "UPDATE deployment_targets SET fencing_token=fencing_token+1 WHERE id=$1", f.plan.TargetID)
			case "worker":
				_, err = f.c.f.pool.Exec(ctx, "UPDATE deployments SET revision=revision+1,lease_owner=$1,lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1", f.plan.DeploymentID)
			}
			if err != nil {
				t.Fatal("network read held a database lock", err)
			}
			releaseOnce.Do(func() { close(resume) })
			select {
			case response := <-done:
				if response.Code != want {
					t.Fatalf("response=%d want=%d %s", response.Code, want, response.Body.String())
				}
			case <-time.After(5 * time.Second):
				t.Fatal("late observation did not finish")
			}
			releaseState(t, f.releaseFixture, f.plan.DeploymentID, "unknown")
			reconciliationOccupied(t, f, true)
			reconciliationCounts(t, f, 0)
		})
	}
}

func reconciliationRequest(f *applicationResourceFixture, key string) *httptest.ResponseRecorder {
	data, _ := json.Marshal(reconciliationInput(1))
	req := httptest.NewRequest("POST", "/api/deployments/"+f.plan.DeploymentID+"/reconcile", bytes.NewReader(data))
	req.RemoteAddr = "127.0.0.1:20000"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+f.c.developer)
	req.Header.Set("Idempotency-Key", key)
	recorder := httptest.NewRecorder()
	f.c.f.handler.ServeHTTP(recorder, req)
	return recorder
}

func TestReleaseReconciliationConcurrentRequests(t *testing.T) {
	for _, sameKey := range []bool{true, false} {
		t.Run(map[bool]string{true: "same-key", false: "different-key"}[sameKey], func(t *testing.T) {
			f := setupReconciliation(t, "Deployment")
			entered, resume := make(chan struct{}, 2), make(chan struct{})
			f.api.mu.Lock()
			f.api.hook = func(r *http.Request) {
				if r.URL.Path == "/api/v1/namespaces/demo/secrets" {
					entered <- struct{}{}
					<-resume
				}
			}
			f.api.mu.Unlock()
			var once sync.Once
			t.Cleanup(func() { once.Do(func() { close(resume) }) })
			responses := make(chan *httptest.ResponseRecorder, 2)
			for i := range 2 {
				key := "concurrent-check-first"
				if i == 1 && !sameKey {
					key = "concurrent-check-second"
				}
				go func() { responses <- reconciliationRequest(f, key) }()
			}
			for range 2 {
				select {
				case <-entered:
				case <-time.After(5 * time.Second):
					t.Fatal("two read-only observations did not run concurrently")
				}
			}
			once.Do(func() { close(resume) })
			var first *httptest.ResponseRecorder
			successes, conflicts := 0, 0
			for range 2 {
				select {
				case r := <-responses:
					if r.Code == 200 {
						successes++
					} else if r.Code == 409 {
						conflicts++
					} else {
						t.Fatal("unexpected concurrent status", r.Code, r.Body.String())
					}
					if sameKey && first != nil && first.Body.String() != r.Body.String() {
						t.Fatal("same key did not replay the winner")
					}
					if r.Header().Get("Cache-Control") != "no-store" {
						t.Fatal("missing no-store")
					}
					first = r
				case <-time.After(5 * time.Second):
					t.Fatal("concurrent completion timed out")
				}
			}
			if sameKey && successes != 2 || !sameKey && (successes != 1 || conflicts != 1) {
				t.Fatal("unexpected winners", successes, conflicts)
			}
			reconciliationCounts(t, f, 1)
			reconciliationOccupied(t, f, false)
		})
	}
}

func TestReleaseReconciliationMissingExecutorAndKeys(t *testing.T) {
	f := setupReconciliation(t, "Deployment")
	f.apps.UseReleases(nil)
	reconcileCall(t, f, 1, "no-executor-check-key", 503)
	reconciliationCounts(t, f, 0)
	// Current transport credentials are used after rotation; no archived runtime
	// Secret values are opened by reconciliation.
	f.c.f.call("PUT", "/api/credentials/"+f.credential, f.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"apiServer": f.api.server.URL, "token": "rotated-fixture", "insecureSkipTLSVerify": true}}, 200)
	// Seed a new current transport version under another key, leaving every old
	// immutable version intact. The replacement app cannot decrypt runtime Secrets.
	vault, err := credential.New(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	encrypted, keyID, err := vault.Seal(f.credential, 3, map[string]any{"apiServer": f.api.server.URL, "token": "new-key-fixture", "insecureSkipTLSVerify": true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.c.f.pool.Exec(context.Background(), "INSERT INTO secret_versions(credential_id,version,encrypted_payload,key_id) VALUES($1,3,$2,$3)", f.credential, encrypted, keyID); err != nil {
		t.Fatal(err)
	}
	if _, err = f.c.f.pool.Exec(context.Background(), "UPDATE credentials SET version=3 WHERE id=$1", f.credential); err != nil {
		t.Fatal(err)
	}
	f.apps = application.New(f.c.f.pool, vault, nil, testJWT).UseReleases(release.New(f.c.f.pool, nil, release.Settings{}, release.NewHelm()))
	f.c.f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: f.c.f.auth, Project: project.New(f.c.f.pool), Platform: platform.New(f.c.f.pool, vault), Application: f.apps})
	secret, err := sqlcdb.New(f.c.f.pool).GetSecretVersion(context.Background(), sqlcdb.GetSecretVersionParams{CredentialID: f.secret, Version: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = vault.Open(f.secret, 1, secret.KeyID, secret.EncryptedPayload); err == nil {
		t.Fatal("fixture runtime Secret key unexpectedly available")
	}
	out := decode[application.DeploymentReconciliation](t, reconcileCall(t, f, 1, "current-credentials-key", 200))
	if out.Status != "succeeded" {
		t.Fatal("could not use current transport credentials", out)
	}
	reconciliationCounts(t, f, 1)
}

func TestReleaseReconciliationTransactionRollback(t *testing.T) {
	f := setupReconciliation(t, "Deployment")
	ctx := context.Background()
	for _, sql := range []string{
		"CREATE FUNCTION reject_manual_reconcile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='deployment.reconcile' THEN RAISE EXCEPTION 'private fixture audit failure'; END IF; RETURN NEW; END $$",
		"CREATE TRIGGER reject_manual_reconcile BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_manual_reconcile()",
	} {
		if _, err := f.c.f.pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	raw := reconcileCall(t, f, 1, "atomic-result-check-key", 500)
	if strings.Contains(string(raw), "private fixture") {
		t.Fatal("database error leaked")
	}
	releaseState(t, f.releaseFixture, f.plan.DeploymentID, "unknown")
	reconciliationOccupied(t, f, true)
	reconciliationCounts(t, f, 0)
	var unchanged bool
	if err := f.c.f.pool.QueryRow(ctx, "SELECT d.revision=1 AND d.finished_at IS NULL AND b.current_deployment_id IS NULL AND r.status='unknown' FROM deployments d JOIN release_requests r ON r.id=d.request_id JOIN app_environment_bindings b ON b.id=$2 WHERE d.id=$1", f.plan.DeploymentID, f.binding).Scan(&unchanged); err != nil || !unchanged {
		t.Fatal("observation did not roll back atomically", unchanged, err)
	}
	if _, err := f.c.f.pool.Exec(ctx, "DROP TRIGGER reject_manual_reconcile ON audit_events"); err != nil {
		t.Fatal(err)
	}
	reconcileCall(t, f, 1, "atomic-result-check-key", 200)
	reconciliationCounts(t, f, 1)
}

func TestReleaseReconciliationFencesExpiredWorker(t *testing.T) {
	f := setupReconciliation(t, "Deployment")
	ctx := context.Background()
	owner := f.plan.DeploymentID
	if _, err := f.c.f.pool.Exec(ctx, "UPDATE deployments SET status='submitting',lease_owner=$1,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", owner); err != nil {
		t.Fatal(err)
	}
	reconcileCall(t, f, 1, "expired-worker-result-key", 200)
	_, err := sqlcdb.New(f.c.f.pool).TransitionRelease(ctx, sqlcdb.TransitionReleaseParams{ID: owner, Revision: 1, Owner: &owner, Status: "unknown"})
	if err != pgx.ErrNoRows {
		t.Fatal("late worker transition was not fenced", err)
	}
	releaseState(t, f.releaseFixture, owner, "succeeded")
	reconciliationOccupied(t, f, false)
	reconciliationCounts(t, f, 1)
}
