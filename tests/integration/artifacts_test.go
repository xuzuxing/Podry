package integration_test

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/audit"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
	"github.com/xuzuxing/podry/internal/registry"
	"github.com/xuzuxing/podry/internal/server"
)

type imageRegistry struct {
	mu            sync.Mutex
	server        *httptest.Server
	body          string
	status, calls int
	private       bool
	hook          func()
}

func imageBody(annotation string) string {
	return `{"schemaVersion":2,"config":{"mediaType":"application/vnd.oci.image.config.v1+json","digest":"sha256:` + strings.Repeat("a", 64) + `","size":2},"layers":[],"annotations":{"fixture":"` + annotation + `"}}`
}
func (r *imageRegistry) input(id string) application.ArtifactInput {
	return application.ArtifactInput{RegistryID: id, ImageRef: strings.TrimPrefix(r.server.URL, "https://") + "/team/demo:latest"}
}
func newImageRegistry(t *testing.T, apps *application.Service) *imageRegistry {
	t.Helper()
	r := &imageRegistry{body: imageBody("one")}
	r.server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.mu.Lock()
		r.calls++
		body, status, private, hook := r.body, r.status, r.private, r.hook
		r.hook = nil
		r.mu.Unlock()
		if hook != nil {
			hook()
		}
		if private {
			u, p, ok := req.BasicAuth()
			if !ok || u != "fixture-reader" || p != "fixture-password" {
				w.WriteHeader(401)
				return
			}
		}
		if status != 0 {
			w.WriteHeader(status)
			return
		}
		w.Header().Set("Content-Type", "application/vnd.oci.image.manifest.v1+json")
		fmt.Fprint(w, body)
	}))
	t.Cleanup(r.server.Close)
	apps.UseImageReader(&registry.Client{Transport: r.server.Client().Transport})
	return r
}
func imageApps(t *testing.T, c *controlFixture) *application.Service {
	t.Helper()
	vault, err := credential.New(testCredentialKey)
	if err != nil {
		t.Fatal(err)
	}
	apps := application.New(c.f.pool, vault, nil, testJWT)
	c.f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: c.f.auth, Project: project.New(c.f.pool), Audit: audit.New(c.f.pool), Platform: platform.New(c.f.pool, vault), Application: apps})
	return apps
}
func registerImageRegistry(t *testing.T, c *controlFixture, r *imageRegistry, private bool) (string, string) {
	t.Helper()
	var credentialID *string
	if private {
		cr := decode[platform.Credential](t, c.f.call("POST", "/api/credentials", c.admin, map[string]any{"name": "Image reader", "kind": "registry", "teamId": nil, "payload": map[string]any{"username": "fixture-reader", "password": "fixture-password"}}, 201))
		credentialID = &cr.ID
	}
	r.mu.Lock()
	r.private = private
	r.mu.Unlock()
	reg := decode[platform.Registry](t, c.f.call("POST", "/api/registries", c.admin, map[string]any{"name": "Local TLS image registry", "endpoint": r.server.URL, "credentialId": credentialID}, 201))
	if credentialID == nil {
		return reg.ID, ""
	}
	return reg.ID, *credentialID
}
func assertNoImports(t *testing.T, c *controlFixture) {
	t.Helper()
	for _, query := range []string{"SELECT count(*) FROM artifacts WHERE source='external'", "SELECT count(*) FROM idempotency_records WHERE operation_id='importArtifact'", "SELECT count(*) FROM audit_events WHERE action='artifact.import'"} {
		var n int
		if err := c.f.pool.QueryRow(context.Background(), query).Scan(&n); err != nil || n != 0 {
			t.Fatal("failed import left state", query, n, err)
		}
	}
}

func TestImageApplicationWorkflowImportPreview(t *testing.T) {
	c := controlSetup(t)
	apps := imageApps(t, c)
	reg := newImageRegistry(t, apps)
	registryID, _ := registerImageRegistry(t, c, reg, false)
	app := decode[application.Application](t, c.f.call("POST", "/api/apps", c.developer, map[string]any{"projectId": c.projectID, "name": "image-demo", "sourceMode": "image"}, 201))
	path := "/api/apps/" + app.ID
	setup := decode[application.Setup](t, c.f.call("GET", path+"/setup", c.developer, nil, 200))
	if setup.Total != 2 || setup.CanBuild {
		t.Fatal(setup)
	}
	c.f.call("PUT", path+"/config", c.developer, map[string]any{"expectedVersion": 0, "section": "git", "gitConfig": map[string]any{"repositoryUrl": "https://git.example.test/repo", "branch": "main", "accountMode": "public", "credentialId": nil}}, 422)
	c.f.call("PUT", path+"/config", c.developer, map[string]any{"expectedVersion": 0, "section": "base", "chartConfig": map[string]any{"workloadKind": "Deployment", "chartVersion": "1.0.0"}, "deployValues": map[string]any{"containerPort": 8080}, "secretRefs": []any{}}, 200)
	c.f.call("POST", "/api/clusters/"+c.clusterID+"/resource-grants", c.admin, map[string]any{"principalType": "project", "principalId": c.projectID, "namespace": "demo", "resources": []string{"*"}, "actions": []string{"resource.view", "resource.write"}}, 201)
	in := map[string]any{"template": "external_image", "expectedConfigVersion": 1, "expectedWorkflowVersion": 0, "deployment": map[string]any{"binding": bindingInput(c, c.environmentID, "image-demo", map[string]any{}), "definition": map[string]any{"triggerMode": "manual", "upstreamPipelineId": nil, "deployTimeoutSeconds": 600}}}
	workflow := decode[application.TemplateResult](t, c.f.keyed("POST", path+"/workflow-templates", c.developer, "image-template-key", in, 201))
	if workflow.Setup.Total != 2 || workflow.Setup.Completed != 2 || workflow.Setup.CanBuild || len(workflow.Workflow.Items) != 1 || workflow.Workflow.Items[0].Kind != "cd" || workflow.Workflow.Items[0].Definition["upstreamPipelineId"] != nil {
		t.Fatal(workflow)
	}
	reg.mu.Lock()
	calls := reg.calls
	reg.mu.Unlock()
	if calls != 0 {
		t.Fatal("saving configuration contacted registry")
	}
	artifact := decode[build.Artifact](t, c.f.keyed("POST", path+"/artifacts", c.developer, "image-import-key", reg.input(registryID), 201))
	if artifact.BuildID != nil || artifact.Source != "external" || artifact.Digest != fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(imageBody("one")))) {
		t.Fatal(artifact)
	}
	listed := decode[httpx.PageResult[build.Artifact]](t, c.f.call("GET", path+"/artifacts", c.developer, nil, 200))
	if len(listed.Items) != 1 || !reflect.DeepEqual(listed.Items[0], artifact) {
		t.Fatal(listed)
	}
	p := decode[application.DeploymentPreview](t, c.f.call("POST", path+"/deployment-previews", c.developer, application.DeploymentPreviewInput{BindingID: workflow.Bindings[0].ID, ArtifactID: artifact.ID, ExpectedConfigVersion: 1}, 201))
	if p.ImageRef != artifact.ImageRef || !strings.Contains(p.Diff.After, artifact.ImageRef) {
		t.Fatal(p)
	}
	assertCode(t, c.f.keyed("POST", path+"/deployments", c.developer, "image-disabled-release", application.PreviewConfirm{PreviewID: p.PreviewID}, 503), "deployment_execution_unavailable")
	apps.UseReleases(releaseReady{})
	setup = decode[application.Setup](t, c.f.call("GET", path+"/setup", c.developer, nil, 200))
	if len(setup.DeployableBindingIDs) != 1 {
		t.Fatal(setup)
	}
	c.f.keyed("POST", path+"/deployments", c.developer, "image-ready-release", application.PreviewConfirm{PreviewID: p.PreviewID}, 202)
	for _, table := range []string{"builds", "build_attempts"} {
		var n int
		if err := c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&n); err != nil || n != 0 {
			t.Fatal("image import fabricated CI", table, n, err)
		}
	}
	if _, err := c.f.pool.Exec(context.Background(), "UPDATE artifacts SET digest=$2 WHERE id=$1", artifact.ID, "sha256:"+strings.Repeat("b", 64)); err == nil {
		t.Fatal("imported artifact mutable")
	}
	// Add a second CD without introducing a CI or upstream dependency.
	in["template"] = "add_deploy"
	in["expectedWorkflowVersion"] = 1
	in["deployment"].(map[string]any)["binding"] = bindingInput(c, environment(t, c, "Image production"), "image-prod", map[string]any{})
	extra := decode[application.TemplateResult](t, c.f.keyed("POST", path+"/workflow-templates", c.developer, "image-add-deployment", in, 201))
	if len(extra.Workflow.Items) != 2 {
		t.Fatal(extra)
	}
	// Downgrade assertions come last: current services require the current schema.
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
	if err := database.Migrate(c.f.dsn, true); err == nil {
		t.Fatal("downgrade discarded external image history")
	}
}

func TestArtifactImportReplayConcurrencyAndMutableTags(t *testing.T) {
	c := controlSetup(t)
	apps := imageApps(t, c)
	reg := newImageRegistry(t, apps)
	rid, _ := registerImageRegistry(t, c, reg, true)
	app := c.app(t, "import-history")
	path := "/api/apps/" + app + "/artifacts"
	input := reg.input(rid)
	var wg sync.WaitGroup
	results := make(chan build.Artifact, 2)
	for range 2 {
		wg.Go(func() {
			results <- decode[build.Artifact](t, c.f.keyed("POST", path, c.developer, "concurrent-image-import", input, 201))
		})
	}
	wg.Wait()
	close(results)
	var first build.Artifact
	for result := range results {
		if first.ID != "" && !reflect.DeepEqual(first, result) {
			t.Fatal("duplicate same-key imports")
		}
		first = result
	}
	var n int
	if err := c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM artifacts").Scan(&n); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	reg.mu.Lock()
	reg.body = imageBody("two")
	reg.mu.Unlock()
	second := decode[build.Artifact](t, c.f.keyed("POST", path, c.developer, "changed-image-tag", input, 201))
	if second.Digest == first.Digest {
		t.Fatal("mutable tag not re-resolved")
	}
	reg.mu.Lock()
	reg.status = 503
	calls := reg.calls
	reg.mu.Unlock()
	replay := decode[build.Artifact](t, c.f.keyed("POST", path, c.developer, "concurrent-image-import", input, 201))
	if !reflect.DeepEqual(first, replay) {
		t.Fatal("replay changed")
	}
	reg.mu.Lock()
	after := reg.calls
	reg.mu.Unlock()
	if after != calls {
		t.Fatal("replay contacted unavailable registry")
	}
	input.ImageRef = strings.TrimSuffix(input.ImageRef, ":latest") + ":other"
	assertCode(t, c.f.keyed("POST", path, c.developer, "concurrent-image-import", input, 409), "idempotency_conflict")
}

func TestArtifactImportValidationAndNetworkFailure(t *testing.T) {
	c := controlSetup(t)
	apps := imageApps(t, c)
	reg := newImageRegistry(t, apps)
	rid, _ := registerImageRegistry(t, c, reg, false)
	app := c.app(t, "import-errors")
	path := "/api/apps/" + app + "/artifacts"
	input := reg.input(rid)
	bad := input
	bad.ImageRef = "other.test/team/demo:latest"
	c.f.keyed("POST", path, c.developer, "wrong-authority-key", bad, 422)
	c.f.call("POST", path, c.developer, input, 422) // Required idempotency key.
	c.f.keyed("POST", path, c.developer, "unknown-fields-key", map[string]any{"registryId": rid, "imageRef": input.ImageRef, "password": "must-not-be-accepted"}, 422)
	reg.mu.Lock()
	reg.status = 404
	reg.mu.Unlock()
	assertCode(t, c.f.keyed("POST", path, c.developer, "missing-manifest-key", input, 422), "registry_manifest_not_found")
	reg.mu.Lock()
	reg.status = 0
	reg.mu.Unlock()
	bad = input
	bad.ImageRef = strings.TrimSuffix(input.ImageRef, ":latest") + "@sha256:" + strings.Repeat("b", 64)
	assertCode(t, c.f.keyed("POST", path, c.developer, "digest-mismatch-key", bad, 503), "artifact_digest_mismatch")
	assertNoImports(t, c)
}

func TestArtifactImportRechecksAfterRemoteRead(t *testing.T) {
	for _, scenario := range []string{"rotation", "permission", "archive", "registry"} {
		t.Run(scenario, func(t *testing.T) {
			c := controlSetup(t)
			apps := imageApps(t, c)
			reg := newImageRegistry(t, apps)
			rid, cred := registerImageRegistry(t, c, reg, true)
			app := c.app(t, "import-race")
			path := "/api/apps/" + app + "/artifacts"
			want := 409
			reg.mu.Lock()
			reg.hook = func() {
				switch scenario {
				case "rotation":
					c.f.call("PUT", "/api/credentials/"+cred, c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"username": "fixture-reader", "password": "rotated-password"}}, 200)
				case "permission":
					c.f.call("DELETE", "/api/projects/"+c.projectID+"/members/"+c.dev.ID, c.admin, nil, 204)
				case "archive":
					c.f.call("PATCH", "/api/apps/"+app, c.developer, map[string]any{"archived": true}, 200)
				case "registry":
					if _, err := c.f.pool.Exec(context.Background(), "UPDATE registries SET endpoint='https://changed.example.test' WHERE id=$1", rid); err != nil {
						t.Error(err)
					}
				}
			}
			reg.mu.Unlock()
			if scenario == "permission" {
				want = 404
			}
			c.f.keyed("POST", path, c.developer, "remote-change-key", reg.input(rid), want)
			assertNoImports(t, c)
		})
	}
}

func TestArtifactImportFrozenCredentialScopeAndReplay(t *testing.T) {
	f := setupRelease(t, "Deployment")
	c := f.c
	reg := newImageRegistry(t, f.apps)
	rid, cred := registerImageRegistry(t, c, reg, true)
	input := reg.input(rid)
	path := "/api/apps/" + f.app
	artifact := decode[build.Artifact](t, c.f.keyed("POST", path+"/artifacts", c.developer, "scoped-image-key", input, 201))
	f.artifact = artifact.ID
	var version int
	var storedID string
	if err := c.f.pool.QueryRow(context.Background(), "SELECT registry_credential_id,registry_credential_version FROM artifacts WHERE id=$1", artifact.ID).Scan(&storedID, &version); err != nil || storedID != cred || version != 1 {
		t.Fatal("missing provenance", storedID, version, err)
	}
	source := successfulRelease(t, f, 3)
	preview := f.preview(t, 3)
	c.f.call("PUT", "/api/credentials/"+cred, c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"username": "fixture-reader", "password": "rotated-password"}}, 200)
	// Isolated fault injection; restore the immutable trigger before continuing.
	if _, err := c.f.pool.Exec(context.Background(), "ALTER TABLE secret_versions DISABLE TRIGGER secret_versions_immutable"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.f.pool.Exec(context.Background(), "UPDATE secret_versions SET key_id='unavailable-fixture-key' WHERE credential_id=$1", cred); err != nil {
		t.Fatal(err)
	}
	if _, err := c.f.pool.Exec(context.Background(), "ALTER TABLE secret_versions ENABLE TRIGGER secret_versions_immutable"); err != nil {
		t.Fatal(err)
	}
	reg.server.Close()
	if replay := decode[build.Artifact](t, c.f.keyed("POST", path+"/artifacts", c.developer, "scoped-image-key", input, 201)); !reflect.DeepEqual(artifact, replay) {
		t.Fatal("replay requires latest secret decrypt")
	}
	// Release planning reuses the verified digest without Registry access or secret decryption.
	f.preview(t, 3)
	rollbackPath := "/api/deployments/" + *source.DeploymentID + "/rollback"
	rollback := decode[application.ReleaseRequest](t, c.f.keyed("POST", rollbackPath, c.developer, "external-rollback-key", application.RollbackInput{Reason: "restore image"}, 202))
	if actionSnapshot(t, f, rollback).ImageRef != artifact.ImageRef {
		t.Fatal("rollback lost imported digest")
	}
	binding := addPromotionTarget(t, f, 3)
	promotePath := "/api/deployments/" + *source.DeploymentID + "/promote"
	promoteIn := application.PromoteInput{BindingID: binding, ExpectedConfigVersion: 3}
	promoted := decode[application.ReleaseRequest](t, c.f.keyed("POST", promotePath, c.developer, "external-promote-key", promoteIn, 202))
	if actionSnapshot(t, f, promoted).ImageRef != artifact.ImageRef {
		t.Fatal("promotion lost imported digest")
	}
	otherTeam := decode[map[string]string](t, c.f.call("POST", "/api/teams", c.admin, map[string]any{"name": "Other team"}, 201))
	if _, err := c.f.pool.Exec(context.Background(), "UPDATE credentials SET team_id=$2 WHERE id=$1", cred, otherTeam["id"]); err != nil {
		t.Fatal(err)
	}
	c.f.keyed("POST", path+"/artifacts", c.developer, "scoped-image-key", input, 404)
	c.f.call("POST", path+"/deployment-previews", c.developer, application.DeploymentPreviewInput{BindingID: f.binding, ArtifactID: artifact.ID, ExpectedConfigVersion: 3}, 404)
	f.confirm(t, preview, "revoked-image-confirm", 404)
	c.f.keyed("POST", rollbackPath, c.developer, "external-rollback-key", application.RollbackInput{Reason: "restore image"}, 404)
	c.f.keyed("POST", promotePath, c.developer, "external-promote-key", promoteIn, 404)
}

func TestArtifactMigrationPreservesBuildOrigin(t *testing.T) {
	f := setupRelease(t, "Deployment")
	ctx := context.Background()
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
		t.Fatal(err)
	}
	if database.CheckSchema(ctx, f.c.f.pool) == nil {
		t.Fatal("accepted v10")
	}
	if err := database.Migrate(f.c.f.dsn, false); err != nil {
		t.Fatal(err)
	}
	f.preview(t, 3)
	for _, args := range [][]any{
		{uuid.NewString(), f.app, "external", nil, nil},
		{uuid.NewString(), f.app, "build", f.c.registryID, f.c.dev.ID},
	} {
		if _, err := f.c.f.pool.Exec(ctx, "INSERT INTO artifacts(id,app_id,source,image_repository,digest,registry_id,imported_by) VALUES($1,$2,$3,'registry.example.test/demo','sha256:'||repeat('a',64),$4,$5)", args...); err == nil {
			t.Fatal("accepted invalid artifact origin")
		}
	}
}
