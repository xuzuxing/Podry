package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/server"
)

func (f *applicationResourceFixture) drift(t *testing.T, refresh bool) application.DriftReport {
	t.Helper()
	path := "/api/apps/" + f.app + "/drift?bindingId=" + f.binding
	if refresh {
		path += "&refresh=true"
	}
	return decode[application.DriftReport](t, f.c.f.call("GET", path, f.c.developer, nil, 200))
}

func TestApplicationDriftComparisonHistoryAndNoWriteback(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	before := f.api.reads.Load()
	if got := f.drift(t, false); got.Status != "unknown" || got.Reason != "no_observation" || len(got.History) != 0 {
		t.Fatal(got)
	}
	if before != f.api.reads.Load() {
		t.Fatal("cache read contacted cluster")
	}
	got := f.drift(t, true)
	if got.Status != "aligned" || got.Current == nil || got.Current.ResourceCount != 4 || got.SecretValuesCompared {
		t.Fatal(got)
	}
	before = f.api.reads.Load()
	if cached := f.drift(t, false); cached.Status != "aligned" || len(cached.History) != 1 {
		t.Fatal(cached)
	}
	if before != f.api.reads.Load() {
		t.Fatal("cache read contacted cluster")
	}
	f.api.mu.Lock()
	bm(f.api.objects[f.workload]["spec"])["replicas"] = 2
	for path, raw := range f.api.objects {
		if raw["kind"] == "Service" {
			delete(f.api.objects, path)
		}
	}
	f.api.mu.Unlock()
	got = f.drift(t, true)
	if got.Status != "drifted" || got.Current.ChangedCount != 1 || got.Current.MissingCount != 1 || len(got.History) != 2 {
		t.Fatal(got)
	}
	config := decode[application.Config](t, f.c.f.call("GET", "/api/apps/"+f.app+"/config", f.c.developer, nil, 200))
	if config.Version != 3 || config.DeployValues["replicaCount"] != nil {
		t.Fatal("observation changed base config", config)
	}
	f.resources(t, 200)
	f.health(t, "progressing")
	if f.api.writes.Load() != 0 {
		t.Fatal("observation wrote to cluster")
	}
	var persisted string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT jsonb_agg(to_jsonb(o))::text FROM application_drift_observations o").Scan(&persisted); err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"private-db", "cHJpdmF0ZS", "DATABASE_URL", "containers", "replicas", "annotations", f.plan.ImageRef} {
		if strings.Contains(persisted, value) {
			t.Fatal("resource content persisted", value)
		}
	}
}

func TestApplicationDriftSecretProjectionAndServerFields(t *testing.T) {
	f := setupApplicationResources(t, "Job")
	f.api.mu.Lock()
	for _, raw := range f.api.objects {
		if raw["kind"] == "Secret" {
			raw["data"] = map[string]any{"DATABASE_URL": "different-secret-value"}
		}
	}
	bm(f.api.objects[f.workload]["metadata"])["managedFields"] = []any{map[string]any{"private": "discard"}}
	f.api.mu.Unlock()
	if got := f.drift(t, true); got.Status != "aligned" {
		t.Fatal(got)
	}
	f.api.mu.Lock()
	for _, raw := range f.api.objects {
		if raw["kind"] == "Secret" {
			bm(raw["data"])["ANOTHER_KEY"] = "value"
		}
	}
	f.api.mu.Unlock()
	if got := f.drift(t, true); got.Status != "drifted" || got.Current.ChangedCount != 1 {
		t.Fatal(got)
	}
	f.api.mu.Lock()
	for _, raw := range f.api.objects {
		if raw["kind"] == "Secret" {
			delete(bm(raw["data"]), "ANOTHER_KEY")
		}
	}
	bm(f.api.objects[f.workload]["spec"])["ttlSecondsAfterFinished"] = 600
	f.api.mu.Unlock()
	if got := f.drift(t, true); got.Status != "drifted" || got.Current.ChangedCount != 1 {
		t.Fatal(got)
	}
}

func TestApplicationDriftFailuresNeverReuseAligned(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	f.drift(t, true)
	f.api.fail.Store(503)
	if got := f.drift(t, true); got.Status != "unknown" || got.Reason != "read_failed" {
		t.Fatal(got)
	}
	if got := f.drift(t, false); got.Status != "unknown" || got.Reason != "read_failed" {
		t.Fatal(got)
	}
	f.api.fail.Store(0)
	if got := f.drift(t, true); got.Status != "aligned" {
		t.Fatal(got)
	}
	f.api.mu.Lock()
	bm(f.api.objects[f.workload]["metadata"])["uid"] = "same-name-replacement"
	f.api.mu.Unlock()
	if got := f.drift(t, true); got.Status != "unknown" || got.Reason != "identity_changed" || got.Current.ChangedCount != 0 {
		t.Fatal(got)
	}
	if _, err := f.c.f.pool.Exec(context.Background(), "DELETE FROM deployment_resources WHERE deployment_id=$1 AND kind='Secret'", f.plan.DeploymentID); err != nil {
		t.Fatal(err)
	}
	reads := f.api.reads.Load()
	if got := f.drift(t, true); got.Status != "unknown" || got.Reason != "identity_unconfirmed" {
		t.Fatal(got)
	}
	if reads != f.api.reads.Load() {
		t.Fatal("unconfirmed identity contacted cluster")
	}
}

func TestApplicationDriftExpiryAndIdentityInvalidation(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	f.drift(t, true)
	ctx := context.Background()
	if _, err := f.c.f.pool.Exec(ctx, "UPDATE application_drift_observations SET observed_at=now()-interval '61 seconds'"); err != nil {
		t.Fatal(err)
	}
	if got := f.drift(t, false); got.Status != "unknown" || got.Reason != "stale" || got.Current != nil {
		t.Fatal(got)
	}
	f.drift(t, true)
	if _, err := f.c.f.pool.Exec(ctx, "UPDATE app_environment_bindings SET version=version+1 WHERE id=$1", f.binding); err != nil {
		t.Fatal(err)
	}
	if got := f.drift(t, false); got.Status != "unknown" || got.Current != nil {
		t.Fatal(got)
	}
	if got := f.drift(t, true); got.Status != "aligned" {
		t.Fatal(got)
	}
	if _, err := f.c.f.pool.Exec(ctx, "UPDATE deployments SET revision=revision+1 WHERE id=$1", f.plan.DeploymentID); err != nil {
		t.Fatal(err)
	}
	if got := f.drift(t, false); got.Status != "unknown" {
		t.Fatal(got)
	}
	f.drift(t, true)
	f.c.f.call("PUT", "/api/credentials/"+f.credential, f.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"apiServer": f.api.server.URL, "token": "rotated", "insecureSkipTLSVerify": true}}, 200)
	if got := f.drift(t, false); got.Status != "unknown" || got.Current != nil {
		t.Fatal(got)
	}
}

func TestApplicationDriftAuthorizationAndConcurrentInvalidation(t *testing.T) {
	for _, change := range []string{"grants", "project", "credential", "binding", "resources"} {
		t.Run(change, func(t *testing.T) {
			f := setupApplicationResources(t, "Deployment")
			var once atomic.Bool
			f.api.mu.Lock()
			f.api.hook = func(r *http.Request) {
				if r.URL.Path != f.workload || !once.CompareAndSwap(false, true) {
					return
				}
				var err error
				switch change {
				case "grants":
					_, err = f.c.f.pool.Exec(context.Background(), "DELETE FROM resource_grants WHERE id=$1", f.grant)
				case "project":
					_, err = f.c.f.pool.Exec(context.Background(), "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", f.c.projectID, f.c.dev.ID)
				case "credential":
					f.c.f.call("PUT", "/api/credentials/"+f.credential, f.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"apiServer": f.api.server.URL, "token": "rotated", "insecureSkipTLSVerify": true}}, 200)
				case "binding":
					_, err = f.c.f.pool.Exec(context.Background(), "UPDATE app_environment_bindings SET version=version+1 WHERE id=$1", f.binding)
				case "resources":
					_, err = f.c.f.pool.Exec(context.Background(), "DELETE FROM deployment_resources WHERE deployment_id=$1 AND kind='Secret'", f.plan.DeploymentID)
				}
				if err != nil {
					t.Error(err)
				}
			}
			f.api.mu.Unlock()
			status := 409
			if change == "grants" || change == "project" {
				status = 404
			}
			f.c.f.call("GET", "/api/apps/"+f.app+"/drift?bindingId="+f.binding+"&refresh=true", f.c.developer, nil, status)
			var count int
			if err := f.c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM application_drift_observations").Scan(&count); err != nil || count != 0 {
				t.Fatal("obsolete observation persisted", count, err)
			}
		})
	}
	t.Run("cached-history", func(t *testing.T) {
		f := setupApplicationResources(t, "Deployment")
		f.drift(t, true)
		f.c.f.call("DELETE", "/api/clusters/"+f.c.clusterID+"/resource-grants/"+f.grant, f.c.admin, nil, 204)
		f.c.f.call("POST", "/api/clusters/"+f.c.clusterID+"/resource-grants", f.c.admin, map[string]any{"principalType": "project", "principalId": f.c.projectID, "namespace": "demo", "resources": []string{"apps/deployments"}, "actions": []string{"resource.view"}}, 201)
		reads := f.api.reads.Load()
		for _, suffix := range []string{"", "&refresh=true"} {
			f.c.f.call("GET", "/api/apps/"+f.app+"/drift?bindingId="+f.binding+suffix, f.c.developer, nil, 404)
		}
		if reads != f.api.reads.Load() {
			t.Fatal("unauthorized drift contacted cluster")
		}
	})
}

func TestApplicationDriftOlderReadCannotReplaceNewer(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	entered, resume := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	f.api.mu.Lock()
	f.api.hook = func(r *http.Request) {
		if r.URL.Path == f.workload && calls.Add(1) == 2 {
			close(entered)
			<-resume
		}
	}
	f.api.mu.Unlock()
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		r := httptest.NewRequest("GET", "/api/apps/"+f.app+"/drift?bindingId="+f.binding+"&refresh=true", nil)
		r.Header.Set("Authorization", "Bearer "+f.c.developer)
		w := httptest.NewRecorder()
		f.c.f.handler.ServeHTTP(w, r)
		done <- w
	}()
	defer func() {
		select {
		case <-resume:
		default:
			close(resume)
		}
	}()
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("older read did not reach barrier")
	}
	f.api.mu.Lock()
	bm(f.api.objects[f.workload]["spec"])["replicas"] = 2
	f.api.mu.Unlock()
	newer := f.drift(t, true)
	if newer.Status != "drifted" {
		t.Fatal(newer)
	}
	close(resume)
	select {
	case w := <-done:
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		got := decode[application.DriftReport](t, w.Body.Bytes())
		if got.Status != "drifted" || got.Current.ID != newer.Current.ID || len(got.History) != 2 {
			t.Fatal(got)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("older read did not finish")
	}
}

func TestApplicationDriftRechecksAuthorizationInFinalTransaction(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	entered, resume := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	f.api.mu.Lock()
	f.api.hook = func(r *http.Request) {
		if r.URL.Path == f.workload && calls.Add(1) == 2 {
			close(entered)
			<-resume
		}
	}
	f.api.mu.Unlock()
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		r := httptest.NewRequest("GET", "/api/apps/"+f.app+"/drift?bindingId="+f.binding+"&refresh=true", nil)
		r.Header.Set("Authorization", "Bearer "+f.c.developer)
		w := httptest.NewRecorder()
		f.c.f.handler.ServeHTTP(w, r)
		done <- w
	}()
	defer func() {
		select {
		case <-resume:
		default:
			close(resume)
		}
	}()
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("read did not reach barrier")
	}
	ctx := context.Background()
	tx, err := f.c.f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT id FROM app_environment_bindings WHERE id=$1 FOR UPDATE", f.binding); err != nil {
		t.Fatal(err)
	}
	close(resume)
	// Hold only the binding so the final load waits after its earlier resource
	// recheck. A grant revocation may commit while that final transaction waits.
	waiting := false
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if err = f.c.f.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity
		 WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'
		 AND query LIKE '%FOR UPDATE OF b,t%')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !waiting {
		t.Fatal("final transaction did not reach binding lock")
	}
	f.c.f.call("DELETE", "/api/clusters/"+f.c.clusterID+"/resource-grants/"+f.grant, f.c.admin, nil, 204)
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case w := <-done:
		if w.Code != 404 {
			t.Fatal("returned revoked comparison", w.Code, w.Body.String())
		}
	case <-time.After(10 * time.Second):
		t.Fatal("final transaction did not finish")
	}
	var count int
	if err = f.c.f.pool.QueryRow(ctx, "SELECT count(*) FROM application_drift_observations").Scan(&count); err != nil || count != 0 {
		t.Fatal("revoked observation persisted", count, err)
	}
}

func TestApplicationDriftNoBaselineAndUnsettledRelease(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	f.drift(t, true)
	ctx := context.Background()
	if _, err := f.c.f.pool.Exec(ctx, "UPDATE app_environment_bindings SET current_deployment_id=NULL WHERE id=$1", f.binding); err != nil {
		t.Fatal(err)
	}
	reads := f.api.reads.Load()
	if got := f.drift(t, true); got.Status != "unknown" || got.Reason != "no_baseline" || len(got.History) != 0 {
		t.Fatal(got)
	}
	if reads != f.api.reads.Load() {
		t.Fatal("no baseline contacted cluster")
	}
	if _, err := f.c.f.pool.Exec(ctx, "UPDATE app_environment_bindings SET current_deployment_id=$2 WHERE id=$1", f.binding, f.plan.DeploymentID); err != nil {
		t.Fatal(err)
	}
	p := f.preview(t, 3)
	r := decode[application.ReleaseRequest](t, f.confirm(t, p, "drift-next-release", 202))
	if got := f.drift(t, true); got.Status != "unknown" || got.Reason != "release_unsettled" {
		t.Fatal(got)
	}
	if reads != f.api.reads.Load() {
		t.Fatal("unsettled release contacted cluster")
	}
	// A newer success establishes a different baseline and a distinct history.
	if _, err := f.c.f.pool.Exec(ctx, "UPDATE deployments SET status='succeeded',helm_revision=2 WHERE id=$1", r.DeploymentID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.c.f.pool.Exec(ctx, "UPDATE app_environment_bindings SET current_deployment_id=$2 WHERE id=$1", f.binding, r.DeploymentID); err != nil {
		t.Fatal(err)
	}
	if got := f.drift(t, false); len(got.History) != 0 || got.Reason != "no_observation" {
		t.Fatal(got)
	}
	// Historical Diff does not create or overwrite drift observations.
	f.diff(t, 200)
	var count int
	if err := f.c.f.pool.QueryRow(ctx, "SELECT count(*) FROM application_drift_observations").Scan(&count); err != nil || count != 2 {
		t.Fatal(count, err)
	}
}

func TestApplicationDriftRetentionMigrationAndOfflineCache(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	downgradeHealthSchedule(t, f.c.f.dsn)
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v16 to v15 without auto deployment state", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("empty v15 down", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("empty v14 down", err)
	}
	if err := database.CheckSchema(context.Background(), f.c.f.pool); err == nil {
		t.Fatal("old schema accepted")
	}
	if err := database.Migrate(f.c.f.dsn, false); err != nil {
		t.Fatal(err)
	}
	f.drift(t, true)
	if _, err := f.c.f.pool.Exec(context.Background(), `INSERT INTO application_drift_observations
	(id,binding_id,deployment_id,snapshot_key,status,reason,resource_count,changed_count,missing_count,observed_at)
	SELECT gen_random_uuid(),binding_id,deployment_id,snapshot_key,status,reason,resource_count,changed_count,missing_count,
	observed_at-n*interval '1 second' FROM application_drift_observations CROSS JOIN generate_series(1,110) n`); err != nil {
		t.Fatal(err)
	}
	if got := f.drift(t, true); len(got.History) != 20 {
		t.Fatal(got)
	}
	var count int
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM application_drift_observations").Scan(&count); err != nil || count != 100 {
		t.Fatal(count, err)
	}
	vault, _ := credential.New("")
	apps := application.New(f.c.f.pool, vault, nil, testJWT)
	f.c.f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: f.c.f.auth, Application: apps})
	reads := f.api.reads.Load()
	if got := f.drift(t, false); got.Status != "aligned" {
		t.Fatal(got)
	}
	if reads != f.api.reads.Load() {
		t.Fatal("offline cache contacted cluster")
	}
	if got := f.drift(t, true); got.Status != "unknown" || got.Reason != "read_failed" {
		t.Fatal(got)
	}
	downgradeHealthSchedule(t, f.c.f.dsn)
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v16 to v15 without auto deployment state", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v15 down before drift protection", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err == nil {
		t.Fatal("downgrade lost drift history")
	}
}

func TestApplicationDriftPendingManualOperationAndValidation(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	f.drift(t, true)
	ctx := context.Background()
	// Seed only the durable operation identities; no resource worker is running.
	op := uuid.NewString()
	if _, err := f.c.f.pool.Exec(ctx, `INSERT INTO resource_operations(id,cluster_id,requested_by,kind,encrypted_payload,key_id,payload_redacted,result_redacted)
	VALUES($1,$2,$3,'scale','x','fixture','[]','[]')`, op, f.c.clusterID, f.c.dev.ID); err != nil {
		t.Fatal(err)
	}
	reads := f.api.reads.Load()
	if got := f.drift(t, false); got.Status != "unknown" || got.Reason != "resource_operation_pending" {
		t.Fatal(got)
	}
	if got := f.drift(t, true); got.Status != "unknown" || got.Reason != "resource_operation_pending" {
		t.Fatal(got)
	}
	if reads != f.api.reads.Load() {
		t.Fatal("pending operation compared resources")
	}
	if _, err := f.c.f.pool.Exec(ctx, "UPDATE resource_operations SET status='succeeded',revision=revision+1 WHERE id=$1", op); err != nil {
		t.Fatal(err)
	}
	if got := f.drift(t, false); got.Status != "unknown" || got.Current != nil {
		t.Fatal(got)
	}
	if got := f.drift(t, true); got.Status != "aligned" {
		t.Fatal(got)
	}
	for _, suffix := range []string{"&refresh=bad", "&refresh=", "&refresh=true&refresh=false"} {
		f.c.f.call("GET", "/api/apps/"+f.app+"/drift?bindingId="+f.binding+suffix, f.c.developer, nil, 422)
	}
	f.c.f.call("GET", "/api/apps/"+f.app+"/drift?bindingId=invalid", f.c.developer, nil, 422)
	var raw []byte
	if err := f.c.f.pool.QueryRow(ctx, "SELECT jsonb_agg(to_jsonb(o)) FROM application_drift_observations o").Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var rows []map[string]any
	if json.Unmarshal(raw, &rows) != nil || len(rows) != 3 {
		t.Fatal(string(raw))
	}
}
