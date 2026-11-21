package integration_test

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/platform"
)

// A deterministic key for isolated test databases only.
const testCredentialKey = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE="

func fakeKubePayload(t *testing.T) map[string]any {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Podry integration CA"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{"apiServer": "https://127.0.0.1:6443", "token": "isolated-kube-token", "certificateAuthorityData": base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))}
}

type controlFixture struct {
	f             *fixture
	admin         string
	developer     string
	dev           auth.User
	projectID     string
	teamID        string
	registryID    string
	clusterID     string
	environmentID string
}

func controlSetup(t *testing.T) *controlFixture {
	f := setup(t)
	admin := f.account("admin@example.test", true)
	dev := f.account("developer@example.test", false)
	at := f.login(admin.Email)
	dt := f.login(dev.Email)
	team := decode[map[string]string](t, f.call("POST", "/api/teams", at, map[string]any{"name": "Test team"}, 201))
	f.call("POST", "/api/teams/"+team["id"]+"/members", at, map[string]any{"userId": dev.ID, "role": "developer"}, 201)
	p := decode[map[string]string](t, f.call("POST", "/api/projects", at, map[string]any{"name": "Test project", "teamId": team["id"]}, 201))
	f.call("POST", "/api/projects/"+p["id"]+"/members", at, map[string]any{"userId": dev.ID, "role": "developer"}, 201)
	registry := decode[platform.Registry](t, f.call("POST", "/api/registries", at, map[string]any{"name": "Public registry", "endpoint": "https://registry.example.test", "credentialId": nil}, 201))
	cred := decode[platform.Credential](t, f.call("POST", "/api/credentials", at, map[string]any{"name": "Test cluster credential", "kind": "kubeconfig", "teamId": nil, "payload": fakeKubePayload(t)}, 201))
	cluster := decode[platform.Cluster](t, f.call("POST", "/api/clusters", at, map[string]any{"name": "Registered cluster", "apiServer": "https://127.0.0.1:6443", "credentialId": cred.ID}, 201))
	env := decode[platform.Environment](t, f.call("POST", "/api/environments", at, map[string]any{"name": "Development", "production": false}, 201))
	return &controlFixture{f, at, dt, dev, p["id"], team["id"], registry.ID, cluster.ID, env.ID}
}
func (c *controlFixture) app(t *testing.T, name string) string {
	t.Helper()
	a := decode[application.Application](t, c.f.call("POST", "/api/apps", c.developer, map[string]any{"projectId": c.projectID, "name": name, "sourceMode": "git"}, 201))
	return a.ID
}
func (c *controlFixture) configure(t *testing.T, id string) {
	c.configureTo(t, id, 3)
}
func (c *controlFixture) configureTo(t *testing.T, id string, sections int) {
	t.Helper()
	inputs := []map[string]any{
		{"section": "git", "gitConfig": map[string]any{"repositoryUrl": "https://git.example.test/team/repo.git", "branch": "main", "accountMode": "public", "credentialId": nil}},
		{"section": "build", "buildConfig": map[string]any{"dockerfile": "Dockerfile", "context": ".", "registryId": c.registryID, "imageRepository": "team/demo", "platform": "linux/amd64", "timeoutSeconds": 600, "buildArgs": map[string]string{}}},
		{"section": "base", "chartConfig": map[string]any{"workloadKind": "Deployment", "chartVersion": "1.0.0"}, "deployValues": map[string]any{"replicaCount": 1, "containerPort": 8080}, "secretRefs": []any{}},
	}
	for i, in := range inputs[:sections] {
		in["expectedVersion"] = i
		c.f.call("PUT", "/api/apps/"+id+"/config", c.developer, in, 200)
	}
}

func TestBuildOnlyWorkflowWithoutRegisteredCluster(t *testing.T) {
	f := setup(t)
	admin := f.account("admin@example.test", true)
	token := f.login(admin.Email)
	team := decode[map[string]string](t, f.call("POST", "/api/teams", token, map[string]any{"name": "No cluster team"}, 201))
	p := decode[map[string]string](t, f.call("POST", "/api/projects", token, map[string]any{"teamId": team["id"], "name": "No cluster project"}, 201))
	r := decode[platform.Registry](t, f.call("POST", "/api/registries", token, map[string]any{"name": "Public registry", "endpoint": "https://registry.example.test", "credentialId": nil}, 201))
	c := &controlFixture{f: f, admin: token, developer: token, projectID: p["id"], teamID: team["id"], registryID: r.ID}
	id := c.app(t, "build-only-app")
	c.configureTo(t, id, 2)
	in := map[string]any{"template": "build_only", "expectedConfigVersion": 2, "expectedWorkflowVersion": 0, "ci": map[string]any{"manual": true, "push": false, "branch": "main", "webhookCredentialId": nil}}
	result := decode[application.TemplateResult](t, f.keyed("POST", "/api/apps/"+id+"/workflow-templates", token, "build-without-cluster", in, 201))
	if len(result.Workflow.Items) != 1 || result.Workflow.Items[0].Kind != "ci" || len(result.Bindings) != 0 || result.Setup.CanBuild {
		t.Fatal("unexpected build-only workflow")
	}
	partial := c.app(t, "incomplete-app")
	c.configureTo(t, partial, 1)
	in["expectedConfigVersion"] = 1
	assertCode(t, f.keyed("POST", "/api/apps/"+partial+"/workflow-templates", token, "missing-prerequisites", in, 422), "prerequisite_missing")
	ctx := context.Background()
	for _, query := range []string{"SELECT count(*) FROM clusters", "SELECT count(*) FROM credentials", "SELECT count(*) FROM deployment_targets"} {
		var n int
		if err := f.pool.QueryRow(ctx, query).Scan(&n); err != nil || n != 0 {
			t.Fatal("build-only flow depended on cluster or credentials", query, err)
		}
	}
	f.call("GET", "/api/apps/"+id+"/pipelines", token, nil, 200)
	f.call("GET", "/api/apps/"+id+"/environments", token, nil, 200)
	f.call("GET", "/api/apps/"+id+"/setup", token, nil, 200)
	listed := decode[map[string]any](t, f.call("GET", "/api/apps?keyword=BUILD-ONLY&pageSize=1", token, nil, 200))
	if listed["total"] != float64(1) {
		t.Fatal("application keyword/pagination failed")
	}
	f.call("GET", "/api/apps?keyword=missing", token, nil, 200)
}

func TestUpgradeIdentityDatabasePreservesExistingRows(t *testing.T) {
	dsn, pool := testDatabase(t)
	ctx := context.Background()
	for i := 0; i < 16; i++ {
		if err := database.Migrate(dsn, true); err != nil {
			t.Fatal(err)
		}
	}
	if err := database.CheckSchema(ctx, pool); err == nil {
		t.Fatal("old version was accepted by current server")
	}
	u, err := auth.New(pool, testJWT, 15*time.Minute).CreateUser(ctx, "existing@example.test", "Existing administrator", testPassword, true)
	if err != nil {
		t.Fatal(err)
	}
	q := sqlcdb.New(pool)
	team, err := q.CreateTeam(ctx, "Existing team")
	if err != nil {
		t.Fatal(err)
	}
	p, err := q.CreateProject(ctx, sqlcdb.CreateProjectParams{TeamID: team.ID, Name: "Existing project"})
	if err != nil {
		t.Fatal(err)
	}
	if err = database.Migrate(dsn, false); err != nil {
		t.Fatal(err)
	}
	if err = database.CheckSchema(ctx, pool); err != nil {
		t.Fatal(err)
	}
	retained, err := q.GetProject(ctx, p.ID)
	if err != nil || retained.TeamID != team.ID {
		t.Fatal("upgrade lost existing project", err)
	}
	user, err := q.GetUser(ctx, u.ID)
	if err != nil || !user.IsSuperAdmin {
		t.Fatal("upgrade lost existing administrator", err)
	}
}
func (c *controlFixture) grant(t *testing.T, namespace string) platform.Grant {
	t.Helper()
	return decode[platform.Grant](t, c.f.call("POST", "/api/clusters/"+c.clusterID+"/resource-grants", c.admin, map[string]any{"principalType": "project", "principalId": c.projectID, "namespace": namespace, "resources": []string{"apps/deployments", "core/configmaps"}, "actions": []string{"resource.write", "resource.view"}}, 201))
}
func (c *controlFixture) template() map[string]any {
	return map[string]any{"template": "build_deploy", "expectedConfigVersion": 3, "expectedWorkflowVersion": 0, "ci": map[string]any{"manual": true, "push": false, "branch": "main", "webhookCredentialId": nil}, "deployment": map[string]any{"binding": map[string]any{"environmentId": c.environmentID, "target": map[string]any{"clusterId": c.clusterID, "namespace": "demo", "releaseName": "demo-app"}, "overrideValues": map[string]any{}, "autoDeploy": false}, "definition": map[string]any{"triggerMode": "manual", "upstreamPipelineId": nil, "deployTimeoutSeconds": 600}}}
}
func (f *fixture) keyed(method, path, token, key string, body any, want int) json.RawMessage {
	f.t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		f.t.Fatal(err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	req.RemoteAddr = "127.0.0.1:20000"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Idempotency-Key", key)
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, req)
	if w.Code != want {
		f.t.Fatalf("keyed %s: got %d want %d: %s", path, w.Code, want, w.Body.String())
	}
	return w.Body.Bytes()
}
func TestCredentialEncryptionRotationAndScope(t *testing.T) {
	c := controlSetup(t)
	f := c.f
	ctx := context.Background()
	in := map[string]any{"name": "Git access", "kind": "git", "teamId": c.teamID, "payload": map[string]any{"username": "git", "token": "secret-one-must-not-leak"}}
	f.call("POST", "/api/credentials", c.developer, in, 403)
	row := decode[platform.Credential](t, f.call("POST", "/api/credentials", c.admin, in, 201))
	rotated := decode[platform.Credential](t, f.call("PUT", "/api/credentials/"+row.ID, c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"username": "git", "token": "secret-two-must-not-leak"}}, 200))
	if rotated.Version != 2 {
		t.Fatal("rotation did not append a version")
	}
	assertCode(t, f.call("PUT", "/api/credentials/"+row.ID, c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"username": "git", "token": "third"}}, 409), "revision_conflict")
	var encrypted []byte
	var keyID string
	if err := f.pool.QueryRow(ctx, "SELECT encrypted_payload,key_id FROM secret_versions WHERE credential_id=$1 AND version=1", row.ID).Scan(&encrypted, &keyID); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encrypted, []byte("secret-one")) {
		t.Fatal("secret stored in plaintext")
	}
	vault, err := credential.New(testCredentialKey)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := vault.Open(row.ID, 1, keyID, encrypted)
	if err != nil || payload["token"] != "secret-one-must-not-leak" {
		t.Fatal("version one is not decryptable", err)
	}
	if _, err = vault.Open(row.ID, 2, keyID, encrypted); err == nil {
		t.Fatal("AAD version swap was accepted")
	}
	encrypted[len(encrypted)-1] ^= 1
	if _, err = vault.Open(row.ID, 1, keyID, encrypted); err == nil {
		t.Fatal("tampered ciphertext was accepted")
	}
	outsider := f.account("outsider@example.test", false)
	ot := f.login(outsider.Email)
	listed := f.call("GET", "/api/credentials", ot, nil, 200)
	if bytes.Contains(listed, []byte(row.ID)) {
		t.Fatal("team credential leaked to outsider")
	}
	if _, err = f.pool.Exec(ctx, "UPDATE secret_versions SET key_id='tampered' WHERE credential_id=$1", row.ID); err == nil {
		t.Fatal("immutable secret version was updated")
	}
	if _, err = f.pool.Exec(ctx, "DELETE FROM secret_versions WHERE credential_id=$1", row.ID); err == nil {
		t.Fatal("immutable secret version was deleted")
	}
	var audits string
	if err = f.pool.QueryRow(ctx, "SELECT coalesce(jsonb_agg(target)::text,'') FROM audit_events").Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(audits, "must-not-leak") {
		t.Fatal("credential leaked into audit")
	}
	in["kind"] = "kubeconfig"
	in["payload"] = map[string]any{"exec": map[string]any{"command": "dangerous"}}
	f.call("POST", "/api/credentials", c.admin, in, 422)
	if _, err = credential.New("invalid-key"); err == nil {
		t.Fatal("invalid key accepted")
	}
	empty, _ := credential.New("")
	if _, _, err = empty.Seal(uuid.NewString(), 1, map[string]any{}); err == nil {
		t.Fatal("absent key accepted")
	}
}
func TestClusterRegistrationGrantsWithoutKubernetes(t *testing.T) {
	c := controlSetup(t)
	f := c.f
	f.call("GET", "/api/clusters/"+c.clusterID, c.developer, nil, 404)
	grant := c.grant(t, "demo")
	cluster := decode[platform.Cluster](t, f.call("GET", "/api/clusters/"+c.clusterID, c.developer, nil, 200))
	if cluster.ConnectionStatus != "unknown" || cluster.LastCheckedAt != nil {
		t.Fatal("registration fabricated a connection result")
	}
	f.call("POST", "/api/clusters/"+c.clusterID+"/connection-tests", c.admin, nil, 200)
	cluster = decode[platform.Cluster](t, f.call("GET", "/api/clusters/"+c.clusterID, c.admin, nil, 200))
	if cluster.LastCheckedAt == nil || cluster.ConnectionStatus != "unavailable" {
		t.Fatal("performed connection test did not record unavailable observation")
	}
	f.call("GET", "/api/clusters/"+c.clusterID+"/resource-grants", c.developer, nil, 403)
	f.call("DELETE", "/api/clusters/"+c.clusterID+"/resource-grants/"+grant.ID, c.admin, nil, 204)
	f.call("GET", "/api/clusters/"+c.clusterID, c.developer, nil, 404)
	f.call("POST", "/api/environments", c.admin, map[string]any{"name": "unsafe", "production": true, "autoDeployAllowed": true}, 422)
	f.call("POST", "/api/registries", c.admin, map[string]any{"name": "bad", "endpoint": "https://user:pass@registry.test", "credentialId": nil}, 422)
	f.call("PATCH", "/api/clusters/"+c.clusterID, c.admin, map[string]any{"name": "Renamed"}, 200)
	f.call("POST", "/api/clusters/"+c.clusterID+"/resource-grants", c.admin, map[string]any{"principalType": "user", "principalId": c.dev.ID, "namespace": "demo", "resources": []string{"bad/group/resource"}, "actions": []string{"resource.write"}}, 422)
}
func TestApplicationConfigurationVersionsAndAuthorization(t *testing.T) {
	c := controlSetup(t)
	f := c.f
	ctx := context.Background()
	id := c.app(t, "demo-app")
	zero := decode[application.Config](t, f.call("GET", "/api/apps/"+id+"/config", c.developer, nil, 200))
	if zero.Version != 0 || zero.ChartConfig != nil {
		t.Fatal("new application is not virtual version zero")
	}
	var n int
	if err := f.pool.QueryRow(ctx, "SELECT count(*) FROM app_config_versions WHERE app_id=$1", id).Scan(&n); err != nil || n != 0 {
		t.Fatal("virtual configuration was persisted")
	}
	c.configure(t, id)
	old := decode[application.Config](t, f.call("GET", "/api/apps/"+id+"/config?version=1", c.developer, nil, 200))
	if old.GitConfig == nil || old.BuildConfig != nil || old.ChartConfig != nil {
		t.Fatal("history is not a full immutable snapshot")
	}
	latest := decode[application.Config](t, f.call("GET", "/api/apps/"+id+"/config", c.developer, nil, 200))
	if latest.Version != 3 || latest.GitConfig == nil || latest.BuildConfig == nil || latest.ChartConfig == nil {
		t.Fatal("section merge lost fields")
	}
	base := map[string]any{"expectedVersion": 3, "section": "base", "chartConfig": map[string]any{"workloadKind": "Job", "chartVersion": "1.0.0"}, "deployValues": map[string]any{}, "secretRefs": []any{}}
	f.call("PUT", "/api/apps/"+id+"/config", c.developer, base, 409)
	base["chartConfig"] = map[string]any{"workloadKind": "Deployment", "chartVersion": "1.0.0"}
	base["deployValues"] = map[string]any{"image": "evil:latest"}
	f.call("PUT", "/api/apps/"+id+"/config", c.developer, base, 422)
	base["deployValues"] = map[string]any{"env": map[string]any{"DB_PASSWORD": "plaintext"}}
	f.call("PUT", "/api/apps/"+id+"/config", c.developer, base, 422)
	if _, err := f.pool.Exec(ctx, "UPDATE app_config_versions SET git_config='{}' WHERE app_id=$1", id); err == nil {
		t.Fatal("configuration version mutation was accepted")
	}
	stale := map[string]any{"expectedVersion": 0, "section": "git", "gitConfig": latest.GitConfig}
	assertCode(t, f.call("PUT", "/api/apps/"+id+"/config", c.developer, stale, 409), "revision_conflict")
	// A role change must take effect without issuing a new token.
	f.call("POST", "/api/projects/"+c.projectID+"/members", c.admin, map[string]any{"userId": c.dev.ID, "role": "viewer"}, 201)
	f.call("PATCH", "/api/apps/"+id, c.developer, map[string]any{"description": "denied"}, 403)
	f.call("GET", "/api/apps/"+id, c.developer, nil, 200)
	f.call("DELETE", "/api/teams/"+c.teamID+"/members/"+c.dev.ID, c.admin, nil, 204)
	f.call("GET", "/api/apps/"+id, c.developer, nil, 404)
}
func TestWorkflowAtomicTemplateIdempotencyAndTargetAuthorization(t *testing.T) {
	c := controlSetup(t)
	f := c.f
	ctx := context.Background()
	id := c.app(t, "workflow-app")
	c.configure(t, id)
	in := c.template()
	path := "/api/apps/" + id + "/workflow-templates"
	// Cluster-scoped permission (namespace="") must never authorize a namespaced deployment.
	wrongGrant := c.grant(t, "")
	f.keyed("POST", path, c.developer, "atomic-template-key", in, 403)
	f.call("DELETE", "/api/clusters/"+c.clusterID+"/resource-grants/"+wrongGrant.ID, c.admin, nil, 204)
	grant := c.grant(t, "*")
	// Force a late failure after CI insertion; the whole transaction and key must disappear.
	bad := c.template()
	bad["deployment"].(map[string]any)["definition"].(map[string]any)["upstreamPipelineId"] = uuid.NewString()
	f.keyed("POST", path, c.developer, "atomic-template-key", bad, 422)
	for _, query := range []string{"SELECT count(*) FROM pipelines", "SELECT count(*) FROM app_environment_bindings", "SELECT count(*) FROM deployment_targets", "SELECT count(*) FROM idempotency_records"} {
		var n int
		if err := f.pool.QueryRow(ctx, query).Scan(&n); err != nil || n != 0 {
			t.Fatal("partial template or reservation survived", query, err)
		}
	}
	first := decode[application.TemplateResult](t, f.keyed("POST", path, c.developer, "atomic-template-key", in, 201))
	if first.Workflow.Version != 1 || len(first.Workflow.Items) != 2 || len(first.Bindings) != 1 || first.Setup.Completed != 4 || first.Setup.CanBuild {
		t.Fatal("unexpected template projection")
	}
	other := c.app(t, "target-conflict-app")
	c.configure(t, other)
	assertCode(t, f.keyed("POST", "/api/apps/"+other+"/workflow-templates", c.developer, "conflicting-target-key", c.template(), 409), "target_conflict")
	var partialPipelines int
	if err := f.pool.QueryRow(ctx, "SELECT count(*) FROM pipelines WHERE app_id=$1", other).Scan(&partialPipelines); err != nil || partialPipelines != 0 {
		t.Fatal("target conflict left a partial CI", err)
	}
	replay := decode[application.TemplateResult](t, f.keyed("POST", path, c.developer, "atomic-template-key", in, 201))
	if replay.Bindings[0].ID != first.Bindings[0].ID {
		t.Fatal("idempotent replay created another binding")
	}
	altered := c.template()
	altered["expectedConfigVersion"] = 2
	f.keyed("POST", path, c.developer, "atomic-template-key", altered, 409)
	f.keyed("POST", path, c.developer, "other-template-key", in, 409)
	// Replays still require current target permissions.
	f.call("DELETE", "/api/clusters/"+c.clusterID+"/resource-grants/"+grant.ID, c.admin, nil, 204)
	f.keyed("POST", path, c.developer, "atomic-template-key", in, 403)
	c.grant(t, "demo")
	w := first.Workflow
	items := []map[string]any{}
	for _, p := range w.Items {
		items = append(items, map[string]any{"id": p.ID, "kind": p.Kind, "bindingId": p.BindingID, "enabled": false, "definition": p.Definition})
	}
	updated := decode[application.Workflow](t, f.call("PUT", "/api/apps/"+id+"/pipelines", c.developer, map[string]any{"expectedVersion": 1, "items": items}, 200))
	if updated.Version != 2 {
		t.Fatal("workflow version not advanced")
	}
	f.call("PUT", "/api/apps/"+id+"/pipelines", c.developer, map[string]any{"expectedVersion": 1, "items": items}, 409)
	f.call("PATCH", "/api/apps/"+id, c.developer, map[string]any{"archived": true}, 200)
	f.call("PUT", "/api/apps/"+id+"/pipelines", c.developer, map[string]any{"expectedVersion": 2, "items": items}, 409)
}
func TestConcurrentApplicationConfigAndTemplate(t *testing.T) {
	c := controlSetup(t)
	f := c.f
	id := c.app(t, "concurrent-app")
	c.configure(t, id)
	c.grant(t, "demo")
	// Concurrent HTTP saves at the same version yield exactly one append.
	latest := decode[application.Config](t, f.call("GET", "/api/apps/"+id+"/config", c.developer, nil, 200))
	body := map[string]any{"expectedVersion": 3, "section": "git", "gitConfig": latest.GitConfig}
	raw, _ := json.Marshal(body)
	codes := make(chan int, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := httptest.NewRequest("PUT", "/api/apps/"+id+"/config", bytes.NewReader(raw))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Authorization", "Bearer "+c.developer)
			w := httptest.NewRecorder()
			f.handler.ServeHTTP(w, r)
			codes <- w.Code
		}()
	}
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatal("concurrent version check failed", counts)
	}
	in := c.template()
	in["expectedConfigVersion"] = 4
	payload, _ := json.Marshal(in)
	results := make(chan []byte, 4)
	status := make(chan int, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := httptest.NewRequest("POST", "/api/apps/"+id+"/workflow-templates", bytes.NewReader(payload))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Authorization", "Bearer "+c.developer)
			r.Header.Set("Idempotency-Key", "concurrent-template-key")
			w := httptest.NewRecorder()
			f.handler.ServeHTTP(w, r)
			status <- w.Code
			results <- w.Body.Bytes()
		}()
	}
	wg.Wait()
	close(status)
	close(results)
	for code := range status {
		if code != 201 {
			t.Fatal("concurrent template failed", code)
		}
	}
	var binding string
	for result := range results {
		out := decode[application.TemplateResult](t, result)
		if binding == "" {
			binding = out.Bindings[0].ID
		} else if binding != out.Bindings[0].ID {
			t.Fatal("concurrent template duplicated target")
		}
	}
}
