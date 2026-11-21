package integration_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/chart"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/release"
)

func successfulRelease(t *testing.T, f *releaseFixture, version int32) application.ReleaseRequest {
	t.Helper()
	f.apps.UseReleases(releaseReady{})
	r := decode[application.ReleaseRequest](t, f.confirm(t, f.preview(t, version), "source-"+uuid.NewString(), 202))
	// Isolated database evidence only. The worker has separate execution fixtures;
	// this source represents an already successful historical deployment.
	for _, statement := range []struct {
		sql string
		arg string
	}{
		{"UPDATE deployments SET status='succeeded',finished_at=clock_timestamp() WHERE id=$1", *r.DeploymentID},
		{"UPDATE release_requests SET status='succeeded' WHERE id=$1", r.RequestID},
		{"UPDATE app_environment_bindings SET current_deployment_id=$1 WHERE id=(SELECT s.binding_id FROM release_snapshots s JOIN release_requests r ON r.snapshot_id=s.id JOIN deployments d ON d.request_id=r.id WHERE d.id=$1)", *r.DeploymentID},
	} {
		if _, err := f.c.f.pool.Exec(context.Background(), statement.sql, statement.arg); err != nil {
			t.Fatal(err)
		}
	}
	return r
}

func actionSnapshot(t *testing.T, f *releaseFixture, r application.ReleaseRequest) release.Plan {
	t.Helper()
	var raw []byte
	var hash string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT snapshot,snapshot_sha256 FROM release_snapshots WHERE id=$1", r.SnapshotID).Scan(&raw, &hash); err != nil {
		t.Fatal(err)
	}
	p, err := release.Decode(raw, hash)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func addPromotionTarget(t *testing.T, f *releaseFixture, version int) string {
	t.Helper()
	w := decode[application.Workflow](t, f.c.f.call("GET", "/api/apps/"+f.app+"/pipelines", f.c.developer, nil, 200))
	out := decode[application.TemplateResult](t, f.c.f.keyed("POST", "/api/apps/"+f.app+"/workflow-templates", f.c.developer, "promotion-target-key", map[string]any{"template": "add_deploy", "expectedConfigVersion": version, "expectedWorkflowVersion": w.Version, "deployment": map[string]any{"binding": bindingInput(f.c, environment(t, f.c, "Production"), "promote-prod", map[string]any{"replicaCount": 4, "env": map[string]any{"MODE": "production"}, "ingress": map[string]any{"host": "prod.example.test"}}), "definition": map[string]any{"triggerMode": "manual", "upstreamPipelineId": nil, "deployTimeoutSeconds": 900}}}, 201))
	for _, b := range out.Bindings {
		if b.ID != f.binding {
			return b.ID
		}
	}
	t.Fatal("missing production binding")
	return ""
}

func TestReleaseActionPromotionTargetConfigReplayAndPermissions(t *testing.T) {
	f := setupRelease(t, "Deployment")
	source := successfulRelease(t, f, 3)
	old := actionSnapshot(t, f, source)
	c := f.c
	c.f.call("PUT", "/api/credentials/"+f.secret, c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"data": map[string]any{"DATABASE_URL": "new-production-secret"}}}, 200)
	c.f.call("PUT", "/api/apps/"+f.app+"/config", c.developer, map[string]any{"expectedVersion": 3, "section": "base", "chartConfig": map[string]any{"workloadKind": "Deployment", "chartVersion": "1.0.0"}, "deployValues": map[string]any{"containerPort": 9090, "env": map[string]any{"BASE": "current"}}, "secretRefs": []any{map[string]any{"credentialId": f.secret, "version": 2, "targetKey": "DATABASE_URL"}}}, 200)
	binding := addPromotionTarget(t, f, 4)
	path := "/api/deployments/" + *source.DeploymentID + "/promote"
	in := application.PromoteInput{BindingID: binding, ExpectedConfigVersion: 4}
	var wg sync.WaitGroup
	responses := make(chan application.ReleaseRequest, 2)
	for range 2 {
		wg.Go(func() {
			responses <- decode[application.ReleaseRequest](t, c.f.keyed("POST", path, c.developer, "concurrent-promotion-key", in, 202))
		})
	}
	wg.Wait()
	close(responses)
	var promoted application.ReleaseRequest
	for r := range responses {
		if promoted.RequestID != "" && !reflect.DeepEqual(promoted, r) {
			t.Fatal("same key created duplicate promotion")
		}
		promoted = r
	}
	p := actionSnapshot(t, f, promoted)
	if promoted.Kind != "promote" || promoted.BindingID != binding || p.ArtifactID != old.ArtifactID || p.ImageRef != old.ImageRef || p.ConfigVersion != 4 || p.TimeoutSeconds != 900 || p.SecretRefs[0].Version != 2 || bm(p.Chart.Values["env"])["MODE"] != "production" || bm(p.Chart.Values["env"])["BASE"] != "current" || p.Chart.Values["replicaCount"] != float64(4) || p.Chart.Values["containerPort"] != float64(9090) || bm(p.Chart.Values["ingress"])["host"] != "prod.example.test" {
		t.Fatal("promotion failed to combine source artifact with destination configuration")
	}
	if !reflect.DeepEqual(old, actionSnapshot(t, f, source)) {
		t.Fatal("promotion changed historical source snapshot")
	}
	d := decode[application.Deployment](t, c.f.call("GET", "/api/deployments/"+*promoted.DeploymentID, c.developer, nil, 200))
	list := decode[httpx.PageResult[application.Deployment]](t, c.f.call("GET", "/api/apps/"+f.app+"/deployments?bindingId="+binding, c.developer, nil, 200))
	if d.SourceDeploymentID == nil || *d.SourceDeploymentID != *source.DeploymentID || len(list.Items) != 1 || !reflect.DeepEqual(d, list.Items[0]) {
		t.Fatal("history omitted source lineage")
	}
	f.apps.UseReleases(nil)
	// A changed latest config and occupied destination do not invalidate a replay.
	c.f.call("PUT", "/api/apps/"+f.app+"/config", c.developer, map[string]any{"expectedVersion": 4, "section": "base", "chartConfig": map[string]any{"workloadKind": "Deployment", "chartVersion": "1.0.0"}, "deployValues": map[string]any{}, "secretRefs": []any{}}, 200)
	if replay := decode[application.ReleaseRequest](t, c.f.keyed("POST", path, c.developer, "concurrent-promotion-key", in, 202)); !reflect.DeepEqual(promoted, replay) {
		t.Fatal("replay changed after configuration/executor changes")
	}
	assertCode(t, c.f.keyed("POST", path, c.developer, "concurrent-promotion-key", application.PromoteInput{BindingID: binding, ExpectedConfigVersion: 5}, 409), "idempotency_conflict")
	c.f.call("DELETE", "/api/clusters/"+c.clusterID+"/resource-grants/"+f.grant, c.admin, nil, 204)
	c.f.call("POST", "/api/clusters/"+c.clusterID+"/resource-grants", c.admin, map[string]any{"principalType": "project", "principalId": c.projectID, "namespace": "demo", "resources": []string{"apps/deployments", "core/secrets"}, "actions": []string{"resource.write"}}, 201)
	assertCode(t, c.f.keyed("POST", path, c.developer, "concurrent-promotion-key", in, 403), "permission_denied")
}

func TestReleaseActionRollbackHistoricalJobAndWorker(t *testing.T) {
	f := setupRelease(t, "Job")
	c := f.c
	path := "/api/apps/" + f.app
	c.f.call("PUT", path+"/environments/"+f.binding, c.developer, bindingUpdate(1, map[string]any{"env": map[string]any{"MODE": "historical"}}), 200)
	source := successfulRelease(t, f, 3)
	old := actionSnapshot(t, f, source)
	c.f.call("PUT", "/api/credentials/"+f.secret, c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"data": map[string]any{"DATABASE_URL": "rotated-secret"}}}, 200)
	var transport string
	if err := c.f.pool.QueryRow(context.Background(), "SELECT credential_id FROM clusters WHERE id=$1", c.clusterID).Scan(&transport); err != nil {
		t.Fatal(err)
	}
	c.f.call("PUT", "/api/credentials/"+transport, c.admin, map[string]any{"expectedVersion": 1, "payload": fakeKubePayload(t)}, 200)
	c.f.call("PUT", path+"/config", c.developer, map[string]any{"expectedVersion": 3, "section": "base", "chartConfig": map[string]any{"workloadKind": "Job", "chartVersion": "1.0.0"}, "deployValues": map[string]any{"env": map[string]any{"MODE": "latest"}}, "secretRefs": []any{map[string]any{"credentialId": f.secret, "version": 2, "targetKey": "DATABASE_URL"}}}, 200)
	c.f.call("PUT", path+"/environments/"+f.binding, c.developer, bindingUpdate(2, map[string]any{"env": map[string]any{"MODE": "new-override"}}), 200)
	var submits int
	w := releaseWorker(t, f, releaseExecutor{
		submit: func(ctx context.Context, in release.Input) (release.Observation, error) {
			submits++
			data := bm(in.Values["podry"])["secretData"].(map[string]string)
			if data["DATABASE_URL"] != base64.StdEncoding.EncodeToString([]byte("private-db-value-never-return")) || bm(in.Values["env"])["MODE"] != "historical" || in.Plan.ClusterCredential.Version != 2 {
				t.Fatal("rollback drifted from historical business values or current transport credentials")
			}
			return release.Observation{State: "observing", Resources: releaseResources(t, in)}, nil
		},
		observe: func(ctx context.Context, in release.Input) (release.Observation, error) {
			return release.Observation{State: "succeeded", Resources: in.Known}, nil
		},
	})
	rollbackPath := "/api/deployments/" + *source.DeploymentID + "/rollback"
	r := decode[application.ReleaseRequest](t, c.f.keyed("POST", rollbackPath, c.developer, "historical-rollback-key", application.RollbackInput{Reason: "  restore known version  "}, 202))
	p := actionSnapshot(t, f, r)
	if r.Kind != "rollback" || p.BindingID != old.BindingID || p.ConfigVersion != old.ConfigVersion || p.BindingVersion != old.BindingVersion || p.ArtifactID != old.ArtifactID || p.ImageRef != old.ImageRef || !reflect.DeepEqual(p.SecretRefs, old.SecretRefs) || !bytes.Equal(p.Chart.Package, old.Chart.Package) || p.Chart.SHA256 != old.Chart.SHA256 || bm(p.Chart.Values["env"])["MODE"] != "historical" || p.DeploymentID == old.DeploymentID || p.ClusterCredential.Version != 2 {
		t.Fatal("rollback lost historical configuration or reused deployment identity")
	}
	a, b := bm(old.Chart.Values["podry"]), bm(p.Chart.Values["podry"])
	if a["workloadName"] == b["workloadName"] || a["secretName"] == b["secretName"] {
		t.Fatal("Job/Secret identities reused; Job would not run again")
	}
	var current, reason string
	if err := c.f.pool.QueryRow(context.Background(), "SELECT reason FROM release_requests WHERE id=$1", r.RequestID).Scan(&reason); err != nil || reason != "restore known version" {
		t.Fatal("rollback reason not recorded", err)
	}
	releaseStep(t, w)
	if err := c.f.pool.QueryRow(context.Background(), "SELECT current_deployment_id FROM app_environment_bindings WHERE id=$1", f.binding).Scan(&current); err != nil || current != old.DeploymentID {
		t.Fatal("rollback advanced pointer before success", err)
	}
	releasePoll(t, f, *r.DeploymentID)
	releaseStep(t, w)
	releaseState(t, f, *r.DeploymentID, "succeeded")
	if err := c.f.pool.QueryRow(context.Background(), "SELECT current_deployment_id FROM app_environment_bindings WHERE id=$1", f.binding).Scan(&current); err != nil || current != p.DeploymentID || submits != 1 {
		t.Fatal("successful rollback did not advance pointer exactly once", err)
	}
	if _, err := c.f.pool.Exec(context.Background(), "UPDATE release_requests SET reason='rewrite history' WHERE id=$1", r.RequestID); err == nil {
		t.Fatal("lineage identity mutable")
	}
	f.apps.UseReleases(nil)
	originalInput := application.RollbackInput{Reason: "  restore known version  "}
	if replay := decode[application.ReleaseRequest](t, c.f.keyed("POST", rollbackPath, c.developer, "historical-rollback-key", originalInput, 202)); !reflect.DeepEqual(r, replay) {
		t.Fatal("completed rollback replay changed")
	}
	assertCode(t, c.f.keyed("POST", rollbackPath, c.developer, "historical-rollback-key", application.RollbackInput{Reason: "different"}, 409), "idempotency_conflict")
	var leaks int
	if err := c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_events WHERE target::text LIKE '%restore known version%'").Scan(&leaks); err != nil || leaks != 0 {
		t.Fatal("freeform rollback reason leaked to audit", err)
	}
	downgradeHealthSchedule(t, c.f.dsn)
	if err := database.Migrate(c.f.dsn, true); err != nil {
		t.Fatal("v16 to v15 without auto deployment state", err)
	}
	if err := database.Migrate(c.f.dsn, true); err != nil {
		t.Fatal("v15 to v14 without webhook state", err)
	}
	if err := database.Migrate(c.f.dsn, true); err != nil {
		t.Fatal("v14 to v13 without drift history", err)
	}
	if err := database.Migrate(c.f.dsn, true); err != nil {
		t.Fatal("v13 to v12 without action history", err)
	}
	if err := database.Migrate(c.f.dsn, true); err != nil {
		t.Fatal("v12 to v11 without resource history", err)
	}
	if err := database.Migrate(c.f.dsn, true); err != nil {
		t.Fatal("v11 to v10 without external images", err)
	}
	if err := database.Migrate(c.f.dsn, true); err != nil {
		t.Fatal("v10 to v9 without build actions", err)
	}
	if err := database.Migrate(c.f.dsn, true); err == nil {
		t.Fatal("downgrade discarded derived release history")
	}
}

func TestReleaseActionAdmissionFailuresLeaveNoTasks(t *testing.T) {
	f := setupRelease(t, "Deployment")
	c := f.c
	source := successfulRelease(t, f, 3)
	path := "/api/deployments/" + *source.DeploymentID
	f.apps.UseReleases(nil)
	assertCode(t, c.f.keyed("POST", path+"/rollback", c.developer, "disabled-rollback-key", application.RollbackInput{Reason: "restore"}, 503), "deployment_execution_unavailable")
	f.apps.UseReleases(releaseReady{})
	for _, reason := range []string{"", "   ", strings.Repeat("中", 1001)} {
		assertCode(t, c.f.keyed("POST", path+"/rollback", c.developer, "invalid-reason-key", application.RollbackInput{Reason: reason}, 422), "validation_failed")
	}
	assertCode(t, c.f.keyed("POST", path+"/rollback", c.developer, "short", application.RollbackInput{Reason: "restore"}, 422), "validation_failed")
	assertCode(t, c.f.keyed("POST", path+"/promote", c.developer, "same-binding-key", application.PromoteInput{BindingID: f.binding, ExpectedConfigVersion: 3}, 422), "validation_failed")
	other := c.app(t, "foreign-binding")
	c.configure(t, other)
	foreign := decode[application.Binding](t, c.f.call("POST", "/api/apps/"+other+"/environments", c.developer, bindingInput(c, c.environmentID, "foreign-binding", map[string]any{}), 201))
	c.f.keyed("POST", path+"/promote", c.developer, "foreign-binding-key", application.PromoteInput{BindingID: foreign.ID, ExpectedConfigVersion: 3}, 404)
	// Current CD authorization is required even when all business inputs are old.
	if _, err := c.f.pool.Exec(context.Background(), "UPDATE pipelines SET enabled=false WHERE app_id=$1 AND kind='cd'", f.app); err != nil {
		t.Fatal(err)
	}
	assertCode(t, c.f.keyed("POST", path+"/rollback", c.developer, "disabled-cd-rollback", application.RollbackInput{Reason: "restore"}, 422), "prerequisite_missing")
	c.f.call("PATCH", "/api/apps/"+f.app, c.developer, map[string]any{"archived": true}, 200)
	assertCode(t, c.f.keyed("POST", path+"/rollback", c.developer, "archived-rollback-key", application.RollbackInput{Reason: "restore"}, 409), "application_archived")
	for _, table := range []string{"release_requests", "release_snapshots", "deployments", "deployment_previews"} {
		var count int
		if err := c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&count); err != nil || count != 1 {
			t.Fatal("rejected action left partial history", table, count, err)
		}
	}
	var count int
	if err := c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM idempotency_records WHERE operation_id IN ('promoteDeployment','rollbackDeployment')").Scan(&count); err != nil || count != 0 {
		t.Fatal("rejected action retained idempotency reservation", err)
	}
}

func TestReleaseActionBusyUnknownAndSourceStatus(t *testing.T) {
	f := setupRelease(t, "Deployment")
	source := successfulRelease(t, f, 3)
	queued := decode[application.ReleaseRequest](t, f.confirm(t, f.preview(t, 3), "queued-release-key", 202))
	path := "/api/deployments/" + *source.DeploymentID + "/rollback"
	input := application.RollbackInput{Reason: "restore"}
	for _, status := range []string{"queued", "submitting", "observing", "unknown"} {
		if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET status=$2 WHERE id=$1", *queued.DeploymentID, status); err != nil {
			t.Fatal(err)
		}
		assertCode(t, f.c.f.keyed("POST", path, f.c.developer, "busy-rollback-"+status, input, 409), "target_busy")
		assertCode(t, f.c.f.keyed("POST", "/api/deployments/"+*queued.DeploymentID+"/rollback", f.c.developer, "source-rollback-"+status, input, 409), "source_deployment_unavailable")
	}
	// Occupancy itself remains authoritative even after a terminal row appears.
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployment_targets SET active_deployment_id=$1 WHERE id=(SELECT target_id FROM deployments WHERE id=$1)", *queued.DeploymentID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE deployments SET status='failed' WHERE id=$1", *queued.DeploymentID); err != nil {
		t.Fatal(err)
	}
	assertCode(t, f.c.f.keyed("POST", path, f.c.developer, "occupied-rollback-key", input, 409), "target_busy")
}

func TestReleaseActionHistoricalDependenciesFailClosed(t *testing.T) {
	f := setupRelease(t, "Deployment")
	source := successfulRelease(t, f, 3)
	f.c.f.call("PUT", "/api/credentials/"+f.secret, f.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"data": map[string]any{"DATABASE_URL": "current-secret"}}}, 200)
	path := "/api/deployments/" + *source.DeploymentID + "/rollback"
	input := application.RollbackInput{Reason: "restore"}
	ctx := context.Background()
	// Fault injection is confined to this isolated database. Immutable production
	// rows cannot normally be edited or deleted by the API.
	conn, err := f.c.f.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	if _, err = conn.Exec(ctx, "ALTER TABLE secret_versions DISABLE TRIGGER secret_versions_immutable"); err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec(ctx, "DELETE FROM secret_versions WHERE credential_id=$1 AND version=1", f.secret); err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec(ctx, "ALTER TABLE secret_versions ENABLE TRIGGER secret_versions_immutable"); err != nil {
		t.Fatal(err)
	}
	assertCode(t, f.c.f.keyed("POST", path, f.c.developer, "missing-secret-key", input, 409), "secret_version_unavailable")
	// A valid canonical hash is insufficient if the actual historical package is
	// unsupported. Missing/corrupt bytes are also rejected by snapshot integrity.
	p := actionSnapshot(t, f, source)
	p.Chart.Version = "9.0.0"
	p.SecretRefs = []release.SecretRef{}
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec(ctx, "ALTER TABLE release_snapshots DISABLE TRIGGER release_snapshot_immutable"); err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec(ctx, "UPDATE release_snapshots SET snapshot=$2,snapshot_sha256=$3 WHERE id=$1", source.SnapshotID, raw, chart.Hash(raw)); err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec(ctx, "ALTER TABLE release_snapshots ENABLE TRIGGER release_snapshot_immutable"); err != nil {
		t.Fatal(err)
	}
	assertCode(t, f.c.f.keyed("POST", path, f.c.developer, "unsupported-chart-key", input, 409), "chart_unavailable")
}

func TestReleaseActionLineageUpgradePreservesHistory(t *testing.T) {
	f := setupRelease(t, "Deployment")
	source := successfulRelease(t, f, 3)
	before := actionSnapshot(t, f, source)
	downgradeHealthSchedule(t, f.c.f.dsn)
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v16 to v15 without auto deployment state", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v15 to v14 without webhook state", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v14 to v13 without drift history", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v13 to v12 without action history", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v12 to v11 without resource history", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v11 to v10 without external images", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v10 to v9 without build actions", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v9 to v8 without derived history", err)
	}
	if err := database.CheckSchema(context.Background(), f.c.f.pool); err == nil {
		t.Fatal("v9 binary accepted v8 database")
	}
	if err := database.Migrate(f.c.f.dsn, false); err != nil {
		t.Fatal("v8 to v9", err)
	}
	if !reflect.DeepEqual(before, actionSnapshot(t, f, source)) {
		t.Fatal("lineage upgrade changed historical snapshot")
	}
	d := decode[application.Deployment](t, f.c.f.call("GET", "/api/deployments/"+*source.DeploymentID, f.c.developer, nil, 200))
	if d.Kind != "deploy" || d.SourceDeploymentID != nil {
		t.Fatal("existing deployment acquired fabricated lineage")
	}
	// BEFORE INSERT must reject same-binding promotion before uniqueness checks.
	_, err := f.c.f.pool.Exec(context.Background(), "INSERT INTO release_requests(id,snapshot_id,requested_by,kind,source_deployment_id) VALUES($1,$2,$3,'promote',$4)", uuid.NewString(), source.SnapshotID, f.c.dev.ID, *source.DeploymentID)
	if err == nil || !strings.Contains(err.Error(), "invalid release lineage") {
		t.Fatal("database accepted invalid derived lineage", err)
	}
}
