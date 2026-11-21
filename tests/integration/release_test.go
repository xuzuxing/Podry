package integration_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/audit"
	"github.com/xuzuxing/podry/internal/chart"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
	"github.com/xuzuxing/podry/internal/server"
	"k8s.io/apimachinery/pkg/util/yaml"
	"testing/fstest"
)

type releaseReady struct{}

func (releaseReady) Ready(application.Target) error { return nil }

type releaseFixture struct {
	c                                     *controlFixture
	apps                                  *application.Service
	app, binding, artifact, secret, grant string
}

func setupRelease(t *testing.T, kind string) *releaseFixture {
	t.Helper()
	c := controlSetup(t)
	f := c.f
	vault, e := credential.New(testCredentialKey)
	if e != nil {
		t.Fatal(e)
	}
	apps := application.New(f.pool, vault, nil, testJWT)
	f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: f.auth, Project: project.New(f.pool), Audit: audit.New(f.pool), Platform: platform.New(f.pool, vault), Application: apps})
	out := &releaseFixture{c: c, apps: apps, app: c.app(t, "release-demo")}
	c.configureTo(t, out.app, 2)
	secret := decode[platform.Credential](t, f.call("POST", "/api/credentials", c.admin, map[string]any{"name": "Runtime secret", "kind": "secret", "teamId": c.teamID, "payload": map[string]any{"data": map[string]any{"DATABASE_URL": "private-db-value-never-return", "OTHER": "also-private"}}}, 201))
	out.secret = secret.ID
	values := map[string]any{"env": map[string]any{"MODE": "test"}}
	if kind == "Deployment" {
		values["containerPort"] = 8080
		values["service"] = map[string]any{"enabled": true, "port": 80}
		values["ingress"] = map[string]any{"enabled": true, "host": "demo.example.test"}
	}
	f.call("PUT", "/api/apps/"+out.app+"/config", c.developer, map[string]any{"expectedVersion": 2, "section": "base", "chartConfig": map[string]any{"workloadKind": kind, "chartVersion": "1.0.0"}, "deployValues": values, "secretRefs": []any{map[string]any{"credentialId": secret.ID, "version": 1, "targetKey": "DATABASE_URL"}}}, 200)
	grant := decode[platform.Grant](t, f.call("POST", "/api/clusters/"+c.clusterID+"/resource-grants", c.admin, map[string]any{"principalType": "project", "principalId": c.projectID, "namespace": "demo", "resources": []string{"*"}, "actions": []string{"resource.view", "resource.write"}}, 201))
	out.grant = grant.ID
	template := decode[application.TemplateResult](t, f.keyed("POST", "/api/apps/"+out.app+"/workflow-templates", c.developer, "release-template-key", map[string]any{"template": "build_deploy", "expectedConfigVersion": 3, "expectedWorkflowVersion": 0, "ci": map[string]any{"manual": true, "push": false, "branch": "main", "webhookCredentialId": nil}, "deployment": map[string]any{"binding": map[string]any{"environmentId": c.environmentID, "target": map[string]any{"clusterId": c.clusterID, "namespace": "demo", "releaseName": "release-demo"}, "overrideValues": map[string]any{}, "autoDeploy": false}, "definition": map[string]any{"triggerMode": "manual", "upstreamPipelineId": nil, "deployTimeoutSeconds": 600}}}, 201))
	out.binding = template.Bindings[0].ID
	var pipeline string
	for _, p := range template.Workflow.Items {
		if p.Kind == "ci" {
			pipeline = p.ID
		}
	}
	// Seed an isolated verified build artifact. These tests never connect to the
	// user's Gitea/Registry/cluster; execution is covered by the separate B4 fixture.
	buildID, attemptID := uuid.NewString(), uuid.NewString()
	out.artifact = uuid.NewString()
	ctx := context.Background()
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{"INSERT INTO builds(id,app_id,pipeline_id,config_version,commit_sha,status,requested_by) VALUES($1,$2,$3,3,$4,'succeeded',$5)", []any{buildID, out.app, pipeline, strings.Repeat("a", 40), c.dev.ID}},
		{"INSERT INTO build_attempts(id,build_id,attempt_no,status,build_cluster_id,namespace,job_name,execution_spec,execution_hash,stage) VALUES($1,$2,1,'succeeded',$3,'build','fixture-job','{}',$4,'finished')", []any{attemptID, buildID, c.clusterID, strings.Repeat("a", 64)}},
		{"INSERT INTO artifacts(id,app_id,build_id,attempt_id,image_repository,digest) VALUES($1,$2,$3,$4,'registry.example.test/team/demo',$5)", []any{out.artifact, out.app, buildID, attemptID, "sha256:" + strings.Repeat("b", 64)}},
		{"UPDATE builds SET artifact_id=$2 WHERE id=$1", []any{buildID, out.artifact}},
	} {
		if _, e = f.pool.Exec(ctx, statement.sql, statement.args...); e != nil {
			t.Fatal(e)
		}
	}
	return out
}
func (f *releaseFixture) preview(t *testing.T, version int32) application.DeploymentPreview {
	t.Helper()
	return decode[application.DeploymentPreview](t, f.c.f.call("POST", "/api/apps/"+f.app+"/deployment-previews", f.c.developer, application.DeploymentPreviewInput{BindingID: f.binding, ArtifactID: f.artifact, ExpectedConfigVersion: version}, 201))
}
func (f *releaseFixture) confirm(t *testing.T, p application.DeploymentPreview, key string, want int) json.RawMessage {
	t.Helper()
	return f.c.f.keyed("POST", "/api/apps/"+f.app+"/deployments", f.c.developer, key, application.PreviewConfirm{PreviewID: p.PreviewID}, want)
}
func manifestObjects(t *testing.T, text string) []map[string]any {
	t.Helper()
	decoder := yaml.NewYAMLOrJSONDecoder(strings.NewReader(text), 4096)
	objects := []map[string]any{}
	for {
		var obj map[string]any
		if e := decoder.Decode(&obj); e == io.EOF {
			break
		} else if e != nil {
			t.Fatal(e)
		}
		if len(obj) > 0 {
			objects = append(objects, obj)
		}
	}
	return objects
}
func TestReleasePreviewOfflineRenderAndExecutionGate(t *testing.T) {
	f := setupRelease(t, "Deployment")
	p := f.preview(t, 3)
	body, _ := json.Marshal(p)
	if strings.Contains(string(body), "private-db-value") || strings.Contains(string(body), "also-private") || p.Diff.Before != "" || !strings.Contains(p.ImageRef, "@sha256:") || len(p.Warnings) < 1 {
		t.Fatal("preview leaked secrets or claimed live diff")
	}
	objects := manifestObjects(t, p.Diff.After)
	if len(objects) != 4 {
		t.Fatalf("expected Deployment/Service/Ingress/Secret, got %d", len(objects))
	}
	for _, obj := range objects {
		if bm(obj["metadata"])["namespace"] != "demo" {
			t.Fatal("wrong namespace")
		}
		if obj["kind"] == "Deployment" {
			pod := bm(bm(obj["spec"])["template"])
			container := bm(bm(pod["spec"])["containers"].([]any)[0])
			if container["image"] != p.ImageRef || bm(obj["spec"])["replicas"] != float64(1) {
				t.Fatal("digest/default replicas missing")
			}
		}
		if obj["kind"] == "Secret" {
			if bm(obj["data"])["DATABASE_URL"] != base64.StdEncoding.EncodeToString([]byte("<redacted>")) {
				t.Fatal("secret preview is not redacted")
			}
		}
	}
	raw := f.confirm(t, p, "disabled-release-key", 503)
	if !strings.Contains(string(raw), "deployment_execution_unavailable") {
		t.Fatal(string(raw))
	}
	var n int
	for _, table := range []string{"release_snapshots", "release_requests", "deployments"} {
		if e := f.c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&n); e != nil || n != 0 {
			t.Fatal("disabled executor left a task", table, e)
		}
	}
	if e := f.c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM deployment_previews WHERE consumed_at IS NOT NULL").Scan(&n); e != nil || n != 0 {
		t.Fatal("disabled executor consumed preview", e)
	}
	if e := f.c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM idempotency_records WHERE operation_id='createReleaseRequest'").Scan(&n); e != nil || n != 0 {
		t.Fatal("disabled executor retained idempotency reservation", e)
	}
	var snapshot []byte
	if e := f.c.f.pool.QueryRow(context.Background(), "SELECT snapshot FROM deployment_previews WHERE id=$1", p.PreviewID).Scan(&snapshot); e != nil {
		t.Fatal(e)
	}
	var plan struct {
		Chart chart.Result `json:"chart"`
	}
	if e := json.Unmarshal(snapshot, &plan); e != nil {
		t.Fatal(e)
	}
	if chart.Hash(plan.Chart.Package) != plan.Chart.SHA256 || chart.Hash([]byte(p.Diff.After)) != plan.Chart.ManifestSHA256 {
		t.Fatal("snapshot checksum mismatch")
	}
	if strings.Contains(string(snapshot), "private-db-value") {
		t.Fatal("snapshot contains plaintext secret")
	}
}
func TestReleaseConfirmationAtomicReplayAndHistory(t *testing.T) {
	f := setupRelease(t, "Deployment")
	f.apps.UseReleases(releaseReady{})
	p := f.preview(t, 3)
	// PostgreSQL serializes the same preview and idempotency key into one request.
	var wg sync.WaitGroup
	results := make(chan application.ReleaseRequest, 2)
	for range 2 {
		wg.Go(func() {
			results <- decode[application.ReleaseRequest](t, f.confirm(t, p, "concurrent-confirm-key", 202))
		})
	}
	wg.Wait()
	close(results)
	var first application.ReleaseRequest
	for r := range results {
		if first.RequestID != "" && r.RequestID != first.RequestID {
			t.Fatal("duplicate request")
		}
		first = r
	}
	if first.DeploymentID == nil || first.RequestID == *first.DeploymentID || first.Status != "queued" {
		t.Fatal("task identities/status invalid")
	}
	f.confirm(t, p, "second-confirm-key", 409)
	f.apps.UseReleases(nil)
	f.confirm(t, p, "concurrent-confirm-key", 202)
	f.c.f.call("GET", "/api/release-requests/"+first.RequestID, f.c.developer, nil, 200)
	d := decode[application.Deployment](t, f.c.f.call("GET", "/api/deployments/"+*first.DeploymentID, f.c.developer, nil, 200))
	if d.ImageRef != p.ImageRef || d.Status != "queued" || d.HelmRevision != nil {
		t.Fatal("invented execution status")
	}
	f.c.f.call("GET", "/api/apps/"+f.app+"/deployments?bindingId="+f.binding, f.c.developer, nil, 200)
	f.c.f.call("PATCH", "/api/apps/"+f.app, f.c.developer, map[string]any{"archived": true}, 409)
	for _, table := range []string{"release_snapshots", "release_requests", "deployments"} {
		var n int
		if e := f.c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&n); e != nil || n != 1 {
			t.Fatal(table, n, e)
		}
	}
	if _, e := f.c.f.pool.Exec(context.Background(), "UPDATE release_snapshots SET snapshot='{}' WHERE id=$1", first.SnapshotID); e == nil {
		t.Fatal("immutable release snapshot updated")
	}
	if _, e := f.c.f.pool.Exec(context.Background(), "UPDATE deployment_previews SET snapshot='{}' WHERE id=$1", p.PreviewID); e == nil {
		t.Fatal("immutable preview updated")
	}
	outsider := f.c.f.account("outsider@example.test", false)
	token := f.c.f.login(outsider.Email)
	f.c.f.call("GET", "/api/deployments/"+*first.DeploymentID, token, nil, 404)
	f.c.f.call("GET", "/api/release-requests/"+first.RequestID, token, nil, 404)
}
func TestReleasePreviewExpiryConfigurationAndCDChanges(t *testing.T) {
	f := setupRelease(t, "Deployment")
	f.apps.UseReleases(releaseReady{})
	p := f.preview(t, 3)
	expired := uuid.NewString()
	_, e := f.c.f.pool.Exec(context.Background(), "INSERT INTO deployment_previews(id,app_id,binding_id,artifact_id,config_version,binding_version,snapshot,snapshot_sha256,created_by,created_at,expires_at) SELECT $1,app_id,binding_id,artifact_id,config_version,binding_version,snapshot,snapshot_sha256,created_by,now()-interval '20 minutes',now()-interval '10 minutes' FROM deployment_previews WHERE id=$2", expired, p.PreviewID)
	if e != nil {
		t.Fatal(e)
	}
	f.confirm(t, application.DeploymentPreview{PreviewID: expired}, "expired-preview-key", 410)
	f.c.f.call("PUT", "/api/apps/"+f.app+"/config", f.c.developer, map[string]any{"expectedVersion": 3, "section": "base", "chartConfig": map[string]any{"workloadKind": "Deployment", "chartVersion": "1.0.0"}, "deployValues": map[string]any{"replicaCount": 2}, "secretRefs": []any{}}, 200)
	f.confirm(t, p, "changed-config-key", 409)
	current := f.preview(t, 4)
	workflow := decode[application.Workflow](t, f.c.f.call("GET", "/api/apps/"+f.app+"/pipelines", f.c.developer, nil, 200))
	items := []map[string]any{}
	for _, pipeline := range workflow.Items {
		items = append(items, map[string]any{"id": pipeline.ID, "kind": pipeline.Kind, "bindingId": pipeline.BindingID, "enabled": pipeline.Kind != "cd", "definition": pipeline.Definition})
	}
	f.c.f.call("PUT", "/api/apps/"+f.app+"/pipelines", f.c.developer, map[string]any{"expectedVersion": workflow.Version, "items": items}, 200)
	f.confirm(t, current, "changed-cd-key-1", 409)
}
func TestReleasePreviewActorGrantScopeAndSecretRotation(t *testing.T) {
	f := setupRelease(t, "Deployment")
	f.apps.UseReleases(releaseReady{})
	p := f.preview(t, 3)
	// An administrator cannot consume another actor's preview.
	f.c.f.keyed("POST", "/api/apps/"+f.app+"/deployments", f.c.admin, "other-actor-confirm", application.PreviewConfirm{PreviewID: p.PreviewID}, 403)
	other := f.c.app(t, "another-app")
	f.c.configure(t, other)
	f.c.f.call("POST", "/api/apps/"+other+"/deployment-previews", f.c.developer, application.DeploymentPreviewInput{BindingID: f.binding, ArtifactID: f.artifact, ExpectedConfigVersion: 3}, 404)
	otherWorkflow := decode[application.TemplateResult](t, f.c.f.keyed("POST", "/api/apps/"+other+"/workflow-templates", f.c.developer, "other-release-template", map[string]any{"template": "build_deploy", "expectedConfigVersion": 3, "expectedWorkflowVersion": 0, "ci": map[string]any{"manual": true, "push": false, "branch": "main", "webhookCredentialId": nil}, "deployment": map[string]any{"binding": map[string]any{"environmentId": f.c.environmentID, "target": map[string]any{"clusterId": f.c.clusterID, "namespace": "demo", "releaseName": "another-demo"}, "overrideValues": map[string]any{}, "autoDeploy": false}, "definition": map[string]any{"triggerMode": "manual", "upstreamPipelineId": nil, "deployTimeoutSeconds": 600}}}, 201))
	f.c.f.call("POST", "/api/apps/"+other+"/deployment-previews", f.c.developer, application.DeploymentPreviewInput{BindingID: otherWorkflow.Bindings[0].ID, ArtifactID: f.artifact, ExpectedConfigVersion: 3}, 404)
	f.c.f.call("PUT", "/api/credentials/"+f.secret, f.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"data": map[string]any{"DATABASE_URL": "rotated-private-value"}}}, 200)
	r := decode[application.ReleaseRequest](t, f.confirm(t, p, "frozen-secret-confirm", 202))
	var raw []byte
	if e := f.c.f.pool.QueryRow(context.Background(), "SELECT snapshot FROM release_snapshots WHERE id=$1", r.SnapshotID).Scan(&raw); e != nil {
		t.Fatal(e)
	}
	var snap struct {
		SecretRefs []application.SecretRef `json:"secretRefs"`
	}
	if e := json.Unmarshal(raw, &snap); e != nil || len(snap.SecretRefs) != 1 || snap.SecretRefs[0].Version != 1 {
		t.Fatal("secret version drift", e)
	}
	p = f.preview(t, 3)
	f.c.f.call("DELETE", "/api/clusters/"+f.c.clusterID+"/resource-grants/"+f.grant, f.c.admin, nil, 204)
	f.confirm(t, p, "revoked-grant-key", 403)
	// Replaying an accepted request also checks the revoked target grant.
	f.confirm(t, application.DeploymentPreview{PreviewID: rPreviewID(t, f, r)}, "frozen-secret-confirm", 403)
}
func rPreviewID(t *testing.T, f *releaseFixture, r application.ReleaseRequest) string {
	t.Helper()
	var id string
	if e := f.c.f.pool.QueryRow(context.Background(), "SELECT preview_id FROM release_snapshots WHERE id=$1", r.SnapshotID).Scan(&id); e != nil {
		t.Fatal(e)
	}
	return id
}
func TestReleaseJobPreviewReservesUniqueExecutionNames(t *testing.T) {
	f := setupRelease(t, "Job")
	one, two := f.preview(t, 3), f.preview(t, 3)
	jobName := func(p application.DeploymentPreview) string {
		for _, obj := range manifestObjects(t, p.Diff.After) {
			if obj["kind"] == "Job" {
				spec := bm(obj["spec"])
				pod := bm(bm(spec["template"])["spec"])
				if spec["completions"] != float64(1) || spec["parallelism"] != float64(1) || spec["backoffLimit"] != float64(0) || pod["restartPolicy"] != "Never" {
					t.Fatal("Job execution defaults invalid")
				}
				return bm(obj["metadata"])["name"].(string)
			}
		}
		t.Fatal("missing Job")
		return ""
	}
	if jobName(one) == jobName(two) {
		t.Fatal("two release previews reserved the same Job identity")
	}
}
