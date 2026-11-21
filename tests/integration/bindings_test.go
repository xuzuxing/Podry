package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/release"
)

func bindingInput(c *controlFixture, env, name string, overrides map[string]any) map[string]any {
	return map[string]any{"environmentId": env, "target": map[string]any{"clusterId": c.clusterID, "namespace": "demo", "releaseName": name}, "overrideValues": overrides, "autoDeploy": false}
}
func bindingUpdate(version int, overrides map[string]any) map[string]any {
	return map[string]any{"expectedVersion": version, "overrideValues": overrides, "autoDeploy": false}
}
func environment(t *testing.T, c *controlFixture, name string) string {
	t.Helper()
	return decode[platform.Environment](t, c.f.call("POST", "/api/environments", c.admin, map[string]any{"name": name, "production": true}, 201)).ID
}

func TestEnvironmentBindingsIndependentAndAdditionalCD(t *testing.T) {
	c := controlSetup(t)
	f := c.f
	id := c.app(t, "multi-environment")
	c.configure(t, id)
	c.grant(t, "demo")
	path := "/api/apps/" + id
	initial := bindingInput(c, c.environmentID, "multi-dev", map[string]any{"replicaCount": 2})
	b := decode[application.Binding](t, f.call("POST", path+"/environments", c.developer, initial, 201))
	w := decode[application.Workflow](t, f.call("GET", path+"/pipelines", c.developer, nil, 200))
	if w.Version != 0 || len(w.Items) != 0 || b.Version != 1 || b.CurrentDeploymentID != nil || b.OverrideValues["replicaCount"] != float64(2) {
		t.Fatal("independent binding unexpectedly changed workflow or lost overrides", b, w)
	}
	// Build-only can be created after an independent binding, then explicitly
	// attach its CD through the versioned workflow collection.
	template := map[string]any{"template": "build_only", "expectedConfigVersion": 3, "expectedWorkflowVersion": 0, "ci": map[string]any{"manual": true, "push": false, "branch": "main", "webhookCredentialId": nil}}
	first := decode[application.TemplateResult](t, f.keyed("POST", path+"/workflow-templates", c.developer, "independent-build-only", template, 201))
	ci := first.Workflow.Items[0]
	items := []map[string]any{
		{"id": ci.ID, "kind": "ci", "enabled": true, "definition": ci.Definition},
		{"kind": "cd", "bindingId": b.ID, "enabled": true, "definition": map[string]any{"triggerMode": "manual", "upstreamPipelineId": ci.ID, "deployTimeoutSeconds": 600}},
	}
	f.call("PUT", path+"/pipelines", c.developer, map[string]any{"expectedVersion": 1, "items": items}, 200)
	prod := environment(t, c, "Production")
	add := map[string]any{"template": "add_deploy", "expectedConfigVersion": 3, "expectedWorkflowVersion": 2, "deployment": map[string]any{"binding": bindingInput(c, prod, "multi-prod", map[string]any{"replicaCount": 3}), "definition": map[string]any{"triggerMode": "manual", "upstreamPipelineId": nil, "deployTimeoutSeconds": 600}}}
	out := decode[application.TemplateResult](t, f.keyed("POST", path+"/workflow-templates", c.developer, "additional-prod-deploy", add, 201))
	if out.Workflow.Version != 3 || len(out.Workflow.Items) != 3 || len(out.Bindings) != 2 {
		t.Fatal("add_deploy did not preserve existing workflow", out)
	}
	for _, p := range out.Workflow.Items {
		if p.Kind == "ci" && p.ID != ci.ID || p.Kind == "cd" && p.Definition["upstreamPipelineId"] != ci.ID {
			t.Fatal("add_deploy duplicated or replaced CI", p)
		}
	}
	replay := decode[application.TemplateResult](t, f.keyed("POST", path+"/workflow-templates", c.developer, "additional-prod-deploy", add, 201))
	if !reflect.DeepEqual(out, replay) {
		t.Fatal("add_deploy retry did not replay its original transaction")
	}
	// Both uniqueness failures must roll back their newly allocated target.
	assertCode(t, f.call("POST", path+"/environments", c.developer, bindingInput(c, prod, "unused-target", map[string]any{}), 409), "target_conflict")
	assertCode(t, f.call("POST", path+"/environments", c.developer, bindingInput(c, environment(t, c, "Other"), "multi-dev", map[string]any{}), 409), "target_conflict")
	add["expectedWorkflowVersion"] = 2
	assertCode(t, f.keyed("POST", path+"/workflow-templates", c.developer, "stale-add-deploy", add, 409), "revision_conflict")
	for _, table := range []string{"deployment_targets", "app_environment_bindings"} {
		var n int
		if err := f.pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&n); err != nil || n != 2 {
			t.Fatal("conflicting binding left partial state", table, n, err)
		}
	}
	for _, table := range []string{"builds", "release_requests", "deployments"} {
		var n int
		if err := f.pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&n); err != nil || n != 0 {
			t.Fatal("saving configuration started execution", table, err)
		}
	}
}

func TestEnvironmentBindingOverridesPreviewAndFreeze(t *testing.T) {
	f := setupRelease(t, "Deployment")
	c := f.c
	path := "/api/apps/" + f.app
	old := f.preview(t, 3)
	before := decode[application.Config](t, c.f.call("GET", path+"/config", c.developer, nil, 200))
	overrides := map[string]any{"replicaCount": float64(3), "env": map[string]any{"MODE": "production", "REGION": "east"}, "service": map[string]any{"port": float64(8081)}, "ingress": map[string]any{"host": "prod.example.test"}, "resources": map[string]any{"requests": map[string]any{"cpu": "100m"}}}
	b := decode[application.Binding](t, c.f.call("PUT", path+"/environments/"+f.binding, c.developer, bindingUpdate(1, overrides), 200))
	if b.Version != 2 || b.CurrentDeploymentID != nil || !reflect.DeepEqual(b.OverrideValues, overrides) {
		t.Fatal("binding save did not persist its revision", b)
	}
	after := decode[application.Config](t, c.f.call("GET", path+"/config", c.developer, nil, 200))
	if !reflect.DeepEqual(before, after) {
		t.Fatal("environment override mutated immutable application base")
	}
	f.apps.UseReleases(releaseReady{})
	assertCode(t, f.confirm(t, old, "old-binding-preview", 409), "revision_conflict")
	p := f.preview(t, 3)
	if p.ValuesRedacted["replicaCount"] != float64(3) || bm(p.ValuesRedacted["service"])["port"] != float64(8081) || bm(p.ValuesRedacted["service"])["enabled"] != true || bm(p.ValuesRedacted["ingress"])["host"] != "prod.example.test" || bm(p.ValuesRedacted["env"])["MODE"] != "production" {
		t.Fatal("preview did not merge environment overrides", p.ValuesRedacted)
	}
	for _, obj := range manifestObjects(t, p.Diff.After) {
		if obj["kind"] == "Deployment" && bm(obj["spec"])["replicas"] != float64(3) {
			t.Fatal("override missing from rendered manifest")
		}
	}
	// Another binding must inherit base MODE=test and its own service port.
	other := decode[application.Binding](t, c.f.call("POST", path+"/environments", c.developer, bindingInput(c, environment(t, c, "Staging"), "release-staging", map[string]any{"service": map[string]any{"port": 8082}}), 201))
	w := decode[application.Workflow](t, c.f.call("GET", path+"/pipelines", c.developer, nil, 200))
	items := []map[string]any{}
	for _, pipeline := range w.Items {
		items = append(items, map[string]any{"id": pipeline.ID, "kind": pipeline.Kind, "bindingId": pipeline.BindingID, "enabled": pipeline.Enabled, "definition": pipeline.Definition})
	}
	items = append(items, map[string]any{"kind": "cd", "bindingId": other.ID, "enabled": true, "definition": map[string]any{"triggerMode": "manual", "upstreamPipelineId": nil, "deployTimeoutSeconds": 600}})
	c.f.call("PUT", path+"/pipelines", c.developer, map[string]any{"expectedVersion": w.Version, "items": items}, 200)
	p2 := decode[application.DeploymentPreview](t, c.f.call("POST", path+"/deployment-previews", c.developer, application.DeploymentPreviewInput{BindingID: other.ID, ArtifactID: f.artifact, ExpectedConfigVersion: 3}, 201))
	if bm(p2.ValuesRedacted["env"])["MODE"] != "test" || bm(p2.ValuesRedacted["service"])["port"] != float64(8082) || bm(p2.ValuesRedacted["ingress"])["host"] != "demo.example.test" {
		t.Fatal("override leaked between environments", p2.ValuesRedacted)
	}
	p = f.preview(t, 3)
	r := decode[application.ReleaseRequest](t, f.confirm(t, p, "freeze-environment-plan", 202))
	var raw []byte
	var hash string
	if err := c.f.pool.QueryRow(context.Background(), "SELECT snapshot,snapshot_sha256 FROM release_snapshots WHERE id=$1", r.SnapshotID).Scan(&raw, &hash); err != nil {
		t.Fatal(err)
	}
	plan, err := release.Decode(raw, hash)
	if err != nil || plan.BindingVersion != 2 || plan.Chart.Values["replicaCount"] != float64(3) || strings.Contains(string(raw), "private-db-value") {
		t.Fatal("merged snapshot not frozen or integrity failed", err)
	}
	assertCode(t, c.f.call("PUT", path+"/environments/"+f.binding, c.developer, bindingUpdate(2, map[string]any{}), 409), "target_busy")
	// Unknown is also busy even before a worker has acquired an occupancy pointer.
	if _, err = c.f.pool.Exec(context.Background(), "UPDATE deployments SET status='unknown' WHERE id=$1", *r.DeploymentID); err != nil {
		t.Fatal(err)
	}
	assertCode(t, c.f.call("PUT", path+"/environments/"+f.binding, c.developer, bindingUpdate(2, map[string]any{}), 409), "target_busy")
}

func TestEnvironmentBindingValidationAndScope(t *testing.T) {
	f := setupRelease(t, "Deployment")
	c := f.c
	path := "/api/apps/" + f.app
	invalid := []map[string]any{
		nil, {"image": "evil:latest"}, {"replicaCount": nil}, {"replicaCount": 101}, {"env": map[string]any{"DATABASE_URL": "plaintext"}},
		{"env": map[string]any{"API_TOKEN": "plaintext"}}, {"service": map[string]any{"type": "LoadBalancer"}}, {"job": map[string]any{"parallelism": 1}},
		{"resources": map[string]any{"limits": map[string]any{"gpu": "1"}}}, {"ingress": map[string]any{"host": "invalid/url"}},
	}
	for _, v := range invalid {
		c.f.call("PUT", path+"/environments/"+f.binding, c.developer, bindingUpdate(1, v), 422)
	}
	bad := bindingUpdate(1, map[string]any{})
	bad["autoDeploy"] = true
	assertCode(t, c.f.call("PUT", path+"/environments/"+f.binding, c.admin, bad, 422), "validation_failed")
	for _, field := range []string{"target", "environmentId"} {
		bad = bindingUpdate(1, map[string]any{})
		bad[field] = uuid.NewString()
		c.f.call("PUT", path+"/environments/"+f.binding, c.developer, bad, 422)
	}
	c.f.call("PUT", path+"/environments/invalid", c.developer, bindingUpdate(1, map[string]any{}), 422)
	c.f.call("PUT", path+"/environments/"+uuid.NewString(), c.developer, bindingUpdate(1, map[string]any{}), 404)
	other := c.app(t, "foreign-binding")
	c.f.call("PUT", "/api/apps/"+other+"/environments/"+f.binding, c.developer, bindingUpdate(1, map[string]any{}), 404)
	outsider := c.f.account("outsider-binding@example.test", false)
	outsideToken := c.f.login(outsider.Email)
	c.f.call("PUT", path+"/environments/"+f.binding, outsideToken, bindingUpdate(1, map[string]any{}), 404)
	// A base edit must not make any existing merged environment invalid.
	c.f.call("PUT", path+"/environments/"+f.binding, c.developer, bindingUpdate(1, map[string]any{"ingress": map[string]any{"enabled": true}}), 200)
	assertCode(t, c.f.call("PUT", path+"/config", c.developer, map[string]any{"expectedVersion": 3, "section": "base", "chartConfig": map[string]any{"workloadKind": "Deployment", "chartVersion": "1.0.0"}, "deployValues": map[string]any{"service": map[string]any{"enabled": false}}, "secretRefs": []any{}}, 422), "validation_failed")
	listed := decode[[]application.Binding](t, c.f.call("GET", path+"/environments", c.developer, nil, 200))
	if len(listed) != 1 || listed[0].Version != 2 {
		t.Fatal("failed updates changed binding revision")
	}
	c.f.call("PATCH", path, c.developer, map[string]any{"archived": true}, 200)
	assertCode(t, c.f.call("PUT", path+"/environments/"+f.binding, c.developer, bindingUpdate(2, map[string]any{}), 409), "application_archived")
	assertCode(t, c.f.call("POST", path+"/environments", c.developer, bindingInput(c, c.environmentID, "archived-target", map[string]any{}), 409), "application_archived")
}

func TestEnvironmentBindingConcurrentUpdates(t *testing.T) {
	c := controlSetup(t)
	id := c.app(t, "concurrent-binding")
	c.configure(t, id)
	c.grant(t, "demo")
	path := "/api/apps/" + id + "/environments"
	b := decode[application.Binding](t, c.f.call("POST", path, c.developer, bindingInput(c, c.environmentID, "concurrent-binding", map[string]any{}), 201))
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 2; i <= 3; i++ {
		payload, err := json.Marshal(bindingUpdate(1, map[string]any{"replicaCount": i}))
		if err != nil {
			t.Fatal(err)
		}
		wg.Go(func() {
			r := httptest.NewRequest("PUT", path+"/"+b.ID, bytes.NewReader(payload))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Authorization", "Bearer "+c.developer)
			w := httptest.NewRecorder()
			c.f.handler.ServeHTTP(w, r)
			codes <- w.Code
		})
	}
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatal("binding version did not serialize concurrent updates", counts)
	}
	var n int
	if err := c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_events WHERE action='application.binding.update'").Scan(&n); err != nil || n != 1 {
		t.Fatal("binding update audit not atomic", n, err)
	}
}

func TestEnvironmentBindingOverridePermissions(t *testing.T) {
	c := controlSetup(t)
	id := c.app(t, "override-permissions")
	c.configure(t, id)
	c.grant(t, "demo")
	path := "/api/apps/" + id + "/environments"
	in := bindingInput(c, c.environmentID, "override-permissions", map[string]any{"service": map[string]any{"enabled": true}})
	c.f.call("POST", path, c.developer, in, 403)
	b := decode[application.Binding](t, c.f.call("POST", path, c.admin, in, 201))
	// Even disabling the old Service needs its resource.write permission.
	c.f.call("PUT", path+"/"+b.ID, c.developer, bindingUpdate(1, map[string]any{}), 403)
	grant := decode[platform.Grant](t, c.f.call("POST", "/api/clusters/"+c.clusterID+"/resource-grants", c.admin, map[string]any{"principalType": "project", "principalId": c.projectID, "namespace": "demo", "resources": []string{"core/services"}, "actions": []string{"resource.write"}}, 201))
	c.f.call("PUT", path+"/"+b.ID, c.developer, bindingUpdate(1, map[string]any{}), 200)
	c.f.call("DELETE", "/api/clusters/"+c.clusterID+"/resource-grants/"+grant.ID, c.admin, nil, 204)
	c.f.call("PUT", path+"/"+b.ID, c.developer, bindingUpdate(2, map[string]any{"service": map[string]any{"enabled": true}}), 403)
}

func TestEnvironmentOverridesMigrationPreservesData(t *testing.T) {
	f := setupRelease(t, "Deployment")
	ctx := context.Background()
	p := f.preview(t, 3)
	var before []byte
	if err := f.c.f.pool.QueryRow(ctx, "SELECT snapshot FROM deployment_previews WHERE id=$1", p.PreviewID).Scan(&before); err != nil {
		t.Fatal(err)
	}
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
		t.Fatal("v9 to v8 downgrade without derived history", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err != nil {
		t.Fatal("v8 to v7 downgrade of empty overrides", err)
	}
	if err := database.CheckSchema(ctx, f.c.f.pool); err == nil {
		t.Fatal("current binary accepted v7 database")
	}
	if err := database.Migrate(f.c.f.dsn, false); err != nil {
		t.Fatal("upgrade from v7 to current schema", err)
	}
	if err := database.CheckSchema(ctx, f.c.f.pool); err != nil {
		t.Fatal(err)
	}
	var after []byte
	if err := f.c.f.pool.QueryRow(ctx, "SELECT snapshot FROM deployment_previews WHERE id=$1", p.PreviewID).Scan(&after); err != nil || !bytes.Equal(before, after) {
		t.Fatal("upgrade changed an immutable release preview", err)
	}
	f.c.f.call("PUT", "/api/apps/"+f.app+"/environments/"+f.binding, f.c.developer, bindingUpdate(1, map[string]any{"replicaCount": 2}), 200)
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
		t.Fatal("v9 to v8 downgrade before override constraint check", err)
	}
	if err := database.Migrate(f.c.f.dsn, true); err == nil {
		t.Fatal("downgrade silently lost environment overrides")
	}
	var replicas int
	if err := f.c.f.pool.QueryRow(ctx, "SELECT (override_values->>'replicaCount')::integer FROM app_environment_bindings WHERE id=$1", f.binding).Scan(&replicas); err != nil || replicas != 2 {
		t.Fatal("failed downgrade changed override data", err)
	}
}

func TestEnvironmentBindingReleasePermissions(t *testing.T) {
	f := setupRelease(t, "Deployment")
	c := f.c
	path := "/api/apps/" + f.app
	// Service and Ingress are enabled exclusively by the binding, not base values.
	c.f.call("PUT", path+"/config", c.developer, map[string]any{"expectedVersion": 3, "section": "base", "chartConfig": map[string]any{"workloadKind": "Deployment", "chartVersion": "1.0.0"}, "deployValues": map[string]any{"service": map[string]any{"enabled": false}, "ingress": map[string]any{"enabled": false}}, "secretRefs": []any{}}, 200)
	overrides := map[string]any{"service": map[string]any{"enabled": true}, "ingress": map[string]any{"enabled": true, "host": "override.example.test"}}
	c.f.call("PUT", path+"/environments/"+f.binding, c.developer, bindingUpdate(1, overrides), 200)
	p := f.preview(t, 4)
	f.apps.UseReleases(releaseReady{})
	f.confirm(t, p, "environment-permission-replay", 202)
	c.f.call("DELETE", "/api/clusters/"+c.clusterID+"/resource-grants/"+f.grant, c.admin, nil, 204)
	c.f.call("POST", "/api/clusters/"+c.clusterID+"/resource-grants", c.admin, map[string]any{"principalType": "project", "principalId": c.projectID, "namespace": "demo", "resources": []string{"apps/deployments", "core/configmaps", "core/secrets"}, "actions": []string{"resource.write"}}, 201)
	assertCode(t, c.f.call("POST", path+"/deployment-previews", c.developer, application.DeploymentPreviewInput{BindingID: f.binding, ArtifactID: f.artifact, ExpectedConfigVersion: 4}, 403), "permission_denied")
	assertCode(t, f.confirm(t, p, "environment-permission-replay", 403), "permission_denied")
	setup := decode[application.Setup](t, c.f.call("GET", path+"/setup", c.developer, nil, 200))
	if len(setup.DeployableBindingIDs) != 0 {
		t.Fatal("setup ignored resources enabled only by environment overrides")
	}
	w := decode[application.Workflow](t, c.f.call("GET", path+"/pipelines", c.developer, nil, 200))
	items := []map[string]any{}
	for _, p := range w.Items {
		items = append(items, map[string]any{"id": p.ID, "kind": p.Kind, "bindingId": p.BindingID, "enabled": p.Enabled, "definition": p.Definition})
	}
	c.f.call("PUT", path+"/pipelines", c.developer, map[string]any{"expectedVersion": w.Version, "items": items}, 403)
}

func TestEnvironmentBindingHealthInvalidationKeepsCurrentDeployment(t *testing.T) {
	// This uses an isolated HTTP Kubernetes fixture, not a real cluster.
	f := setupApplicationResources(t, "Deployment")
	f.resources(t, 200)
	f.health(t, "healthy")
	b := decode[application.Binding](t, f.c.f.call("PUT", "/api/apps/"+f.app+"/environments/"+f.binding, f.c.developer, bindingUpdate(1, map[string]any{"replicaCount": 2}), 200))
	if b.CurrentDeploymentID == nil || *b.CurrentDeploymentID != f.plan.DeploymentID {
		t.Fatal("editing a draft override changed the current successful deployment")
	}
	f.health(t, "unknown")
	// Saved draft values are not deployed. A fresh resource observation must
	// still read the current deployment snapshot and its actual live replicas.
	f.resources(t, 200)
	f.health(t, "healthy")
}
