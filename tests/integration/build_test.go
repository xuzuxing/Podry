package integration_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/audit"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/gitremote"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
	"github.com/xuzuxing/podry/internal/server"
	"github.com/xuzuxing/podry/tests/gitfixture"
)

type buildAPI struct {
	mu                                                                      sync.Mutex
	server                                                                  *httptest.Server
	objects                                                                 map[string]map[string]any
	creates, starts                                                         int
	dropCreate, dropSecret, dropStart, missing, complete, failed, badResult bool
	digest                                                                  string
}

func bm(v any) map[string]any { m, _ := v.(map[string]any); return m }
func newBuildAPI(t *testing.T, digest string) *buildAPI {
	k := &buildAPI{objects: map[string]map[string]any{}, digest: digest}
	k.server = httptest.NewTLSServer(http.HandlerFunc(k.serve))
	t.Cleanup(k.server.Close)
	return k
}
func (k *buildAPI) serve(w http.ResponseWriter, r *http.Request) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if r.Header.Get("Authorization") != "Bearer build-fixture-token" {
		http.Error(w, "denied", 401)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	write := func(v any) { _ = json.NewEncoder(w).Encode(v) }
	if r.Method == "POST" {
		var o map[string]any
		if json.NewDecoder(r.Body).Decode(&o) != nil {
			w.WriteHeader(400)
			return
		}
		m := bm(o["metadata"])
		name, _ := m["name"].(string)
		path := r.URL.Path + "/" + name
		if k.objects[path] != nil {
			w.WriteHeader(409)
			return
		}
		m["uid"] = uuid.NewString()
		m["resourceVersion"] = "1"
		k.objects[path] = o
		if o["kind"] == "Job" {
			k.creates++
			if k.dropCreate {
				k.dropCreate = false
				conn, _, e := w.(http.Hijacker).Hijack()
				if e == nil {
					_ = conn.Close()
				}
				return
			}
		}
		if o["kind"] == "Secret" && k.dropSecret {
			k.dropSecret = false
			conn, _, e := w.(http.Hijacker).Hijack()
			if e == nil {
				_ = conn.Close()
			}
			return
		}
		w.WriteHeader(201)
		write(o)
		return
	}
	if r.Method == "PATCH" {
		o := k.objects[r.URL.Path]
		if o == nil {
			w.WriteHeader(404)
			return
		}
		var patch map[string]any
		_ = json.NewDecoder(r.Body).Decode(&patch)
		if bm(patch["metadata"])["uid"] != bm(o["metadata"])["uid"] {
			w.WriteHeader(409)
			return
		}
		bm(o["spec"])["suspend"] = false
		k.starts++
		if k.dropStart {
			k.dropStart = false
			conn, _, e := w.(http.Hijacker).Hijack()
			if e == nil {
				_ = conn.Close()
			}
			return
		}
		write(o)
		return
	}
	if r.Method != "GET" {
		w.WriteHeader(405)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/pods") {
		if k.missing {
			w.WriteHeader(404)
			return
		}
		for _, o := range k.objects {
			if o["kind"] == "Job" {
				write(map[string]any{"items": []any{k.pod(o)}})
				return
			}
		}
		write(map[string]any{"items": []any{}})
		return
	}
	if strings.HasSuffix(r.URL.Path, "/pods/build-pod/log") {
		fmt.Fprintf(w, "2026-11-20T10:00:00Z %s fixture output\n", r.URL.Query().Get("container"))
		return
	}
	if strings.HasSuffix(r.URL.Path, "/pods/build-pod") {
		for _, o := range k.objects {
			if o["kind"] == "Job" {
				write(k.pod(o))
				return
			}
		}
	}
	o := k.objects[r.URL.Path]
	if o == nil || k.missing {
		w.WriteHeader(404)
		return
	}
	if o["kind"] == "Job" && k.complete {
		o["status"] = map[string]any{"conditions": []any{map[string]any{"type": "Complete", "status": "True"}}}
	}
	if o["kind"] == "Job" && k.failed {
		o["status"] = map[string]any{"conditions": []any{map[string]any{"type": "Failed", "status": "True"}}}
	}
	write(o)
}
func (k *buildAPI) pod(j map[string]any) map[string]any {
	m := bm(j["metadata"])
	a := bm(m["annotations"])
	var spec build.ExecutionSpec
	for _, o := range k.objects {
		if o["kind"] == "ConfigMap" {
			_ = json.Unmarshal([]byte(bm(o["data"])["input.json"].(string)), &spec)
		}
	}
	registryURL, _ := url.Parse(spec.RegistryEndpoint)
	repo := registryURL.Host + "/" + spec.ImageRepository
	result := build.RunnerResult{Version: 1, AttemptID: fmt.Sprint(a["podry.io/attempt-id"]), ImageRepository: repo, Digest: k.digest}
	if k.badResult {
		result.AttemptID = "wrong-attempt"
	}
	raw, _ := json.Marshal(result)
	return map[string]any{"metadata": map[string]any{"name": "build-pod", "uid": "pod-uid", "ownerReferences": []any{map[string]any{"uid": m["uid"], "kind": "Job", "controller": true}}}, "status": map[string]any{"containerStatuses": []any{map[string]any{"name": "build", "state": map[string]any{"terminated": map[string]any{"exitCode": 0, "message": string(raw)}}}}}}
}

type buildFixture struct {
	c            *controlFixture
	remote       *gitfixture.Fixture
	apps         *application.Service
	worker       *build.Service
	kube         *buildAPI
	app, sha     string
	registry     *httptest.Server
	registryFail bool
}

func setupBuild(t *testing.T) *buildFixture {
	return setupBuildWithHTTP(t, false)
}

func setupBuildWithHTTP(t *testing.T, plainHTTP bool) *buildFixture {
	t.Helper()
	c := controlSetup(t)
	remote := gitfixture.New(t)
	if plainHTTP {
		remote.Server = httptest.NewServer(remote.Server.Config.Handler)
		t.Cleanup(remote.Server.Close)
	}
	b := &buildFixture{c: c, remote: remote, sha: remote.Main[2].String()}
	manifest := []byte(`{"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{},"layers":[]}`)
	sum := sha256.Sum256(manifest)
	digest := "sha256:" + hex.EncodeToString(sum[:])
	registryHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if b.registryFail {
			w.WriteHeader(503)
			return
		}
		if !strings.HasSuffix(r.URL.Path, "/manifests/"+digest) {
			w.WriteHeader(404)
			return
		}
		w.Header().Set("Docker-Content-Digest", digest)
		w.Header().Set("Content-Type", "application/vnd.oci.image.manifest.v1+json")
		_, _ = w.Write(manifest)
	})
	var reg *httptest.Server
	if plainHTTP {
		reg = httptest.NewServer(registryHandler)
	} else {
		reg = httptest.NewTLSServer(registryHandler)
	}
	t.Cleanup(reg.Close)
	b.registry = reg
	b.kube = newBuildAPI(t, digest)
	policy := credential.URLPolicy{}
	vault, _ := credential.New(testCredentialKey)
	if plainHTTP {
		r, _ := url.Parse(reg.URL)
		g, _ := url.Parse(remote.URL())
		policy.AllowedHTTPHosts = []string{r.Host, g.Host}
		c.f.call("POST", "/api/registries", c.admin, map[string]any{"name": "unapproved HTTP", "endpoint": reg.URL, "credentialId": nil}, 422)
		c.f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: c.f.auth, Project: project.New(c.f.pool), Audit: audit.New(c.f.pool), Platform: platform.New(c.f.pool, vault).WithURLPolicy(policy)})
	}
	cr := decode[platform.Credential](t, c.f.call("POST", "/api/credentials", c.admin, map[string]any{"name": "Build fixture cluster", "kind": "kubeconfig", "teamId": nil, "payload": map[string]any{"apiServer": b.kube.server.URL, "token": "build-fixture-token", "insecureSkipTLSVerify": true}}, 201))
	cluster := decode[platform.Cluster](t, c.f.call("POST", "/api/clusters", c.admin, map[string]any{"name": "Build fixture", "apiServer": b.kube.server.URL, "credentialId": cr.ID}, 201))
	registry := decode[platform.Registry](t, c.f.call("POST", "/api/registries", c.admin, map[string]any{"name": "Build result registry", "endpoint": reg.URL, "credentialId": nil}, 201))
	worker := build.New(c.f.pool, vault, build.Settings{Enabled: true, ClusterID: cluster.ID, Namespace: "build-test", BuilderEndpoint: "tcp://buildkit.test:1234", RunnerImage: "registry.test/podry-runner@sha256:" + strings.Repeat("a", 64), Platform: "linux/amd64", Concurrency: 1, DataDir: t.TempDir()})
	worker.RegistryTransport = reg.Client().Transport
	b.worker = worker
	apps := application.New(c.f.pool, vault, gitremote.New(remote.Server.Client()).WithURLPolicy(policy), testJWT).UseBuilds(worker).WithURLPolicy(policy)
	b.apps = apps
	c.f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: c.f.auth, Project: project.New(c.f.pool), Audit: audit.New(c.f.pool), Platform: platform.New(c.f.pool, vault).WithURLPolicy(policy), Application: apps})
	b.app = c.app(t, "real-build-api")
	saveGit(t, c, b.app, remote.URL(), 0, nil)
	c.f.call("PUT", "/api/apps/"+b.app+"/config", c.developer, map[string]any{"expectedVersion": 1, "section": "build", "buildConfig": map[string]any{"dockerfile": "Dockerfile", "context": ".", "registryId": registry.ID, "imageRepository": "team/demo", "platform": "linux/amd64", "timeoutSeconds": 600, "buildArgs": map[string]string{}}}, 200)
	// Use the HTTP path so actor/token state and template validation are exercised.
	c.f.keyed("POST", "/api/apps/"+b.app+"/workflow-templates", c.developer, "build-fixture-template", map[string]any{"template": "build_only", "expectedConfigVersion": 2, "expectedWorkflowVersion": 0, "ci": map[string]any{"manual": true, "push": false, "branch": "main", "webhookCredentialId": nil}}, 201)
	return b
}
func (b *buildFixture) trigger(t *testing.T, key string, want int) json.RawMessage {
	t.Helper()
	raw, _ := json.Marshal(application.BuildInput{CommitSHA: b.sha, ExpectedConfigVersion: 2})
	r := httptest.NewRequest("POST", "/api/apps/"+b.app+"/builds", bytes.NewReader(raw))
	r.Header.Set("Authorization", "Bearer "+b.c.developer)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Idempotency-Key", key)
	w := httptest.NewRecorder()
	b.c.f.handler.ServeHTTP(w, r)
	if w.Code != want {
		t.Fatalf("build trigger: %d wanted %d: %s", w.Code, want, w.Body.String())
	}
	return w.Body.Bytes()
}
func (b *buildFixture) step(t *testing.T) {
	t.Helper()
	if _, e := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET next_poll_at=now()-interval '1 second'"); e != nil {
		t.Fatal(e)
	}
	ok, e := b.worker.ProcessOne(context.Background())
	if e != nil || !ok {
		t.Fatalf("worker step: claimed=%v error=%v", ok, e)
	}
}
func TestBuildPersistentExecutionArtifactsAndLogs(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "persistent-build-1", 202))
	if out.Status != "queued" {
		t.Fatal("not queued")
	}
	for range 3 {
		b.step(t)
	}
	if b.kube.creates != 1 || b.kube.starts != 1 {
		t.Fatal("Job was not created once and resumed")
	}
	b.kube.complete = true
	b.step(t)
	got := decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+out.ID, b.c.developer, nil, 200))
	if got.Status != "succeeded" || got.ArtifactID == nil {
		t.Fatal("verified artifact not atomically recorded")
	}
	b.c.f.call("GET", "/api/apps/"+b.app+"/artifacts", b.c.developer, nil, 200)
	if _, e := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET next_poll_at=now()-interval '1 second'"); e != nil {
		t.Fatal(e)
	}
	if e := b.worker.ArchiveOne(context.Background()); e != nil {
		t.Fatal(e)
	}
	attempts := decode[[]build.Attempt](t, b.c.f.call("GET", "/api/builds/"+out.ID+"/attempts", b.c.developer, nil, 200))
	if len(attempts) != 1 || attempts[0].LogAvailability != "archived" {
		t.Fatal("log archive unavailable")
	}
	r := httptest.NewRequest("GET", "/api/builds/"+out.ID+"/logs?follow=false", nil)
	r.Header.Set("Authorization", "Bearer "+b.c.developer)
	w := httptest.NewRecorder()
	b.c.f.handler.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"type":"end"`) || !strings.Contains(w.Body.String(), "fixture output") {
		t.Fatalf("logs: %d %s", w.Code, w.Body.String())
	}
}
func TestBuildReplayAndAmbiguousCreateRecovery(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "recovery-build-1", 202))
	b.kube.dropCreate = true
	b.step(t)
	got := decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+out.ID, b.c.developer, nil, 200))
	if got.Status != "unknown" {
		t.Fatal("ambiguous create must remain unknown")
	}
	b.worker.Settings.RunnerImage = "registry.test/new-runner@sha256:" + strings.Repeat("b", 64)
	for range 3 {
		b.step(t)
	}
	if b.kube.creates != 1 || b.kube.starts != 1 {
		t.Fatal("ambiguous creation was duplicated")
	}
	b.remote.Server.Close()
	again := decode[build.Build](t, b.trigger(t, "recovery-build-1", 202))
	if again.ID != out.ID {
		t.Fatal("replay changed build identity")
	}
	assertCode(t, b.c.f.call("PATCH", "/api/apps/"+b.app, b.c.developer, map[string]any{"archived": true}, 409), "active_builds")
	b.kube.missing = true
	b.step(t)
	if b.kube.creates != 1 {
		t.Fatal("deleted Job was resubmitted")
	}
}
func TestBuildRegistryFailureRevocationAndNoPhantomBuilds(t *testing.T) {
	b := setupBuild(t)
	original := b.sha
	b.sha = strings.Repeat("f", 40)
	assertCode(t, b.trigger(t, "invalid-commit-key", 422), "git_commit_not_found")
	b.sha = original
	var count int
	if e := b.c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM builds").Scan(&count); e != nil || count != 0 {
		t.Fatal("preflight produced phantom build")
	}
	out := decode[build.Build](t, b.trigger(t, "registry-retry-key", 202))
	for range 3 {
		b.step(t)
	}
	b.kube.complete = true
	b.registryFail = true
	b.step(t)
	got := decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+out.ID, b.c.developer, nil, 200))
	if got.Status != "unknown" || got.ArtifactID != nil {
		t.Fatal("Registry failure produced artifact")
	}
	b.registryFail = false
	b.step(t)
	got = decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+out.ID, b.c.developer, nil, 200))
	if got.Status != "succeeded" || got.ArtifactID == nil {
		t.Fatal("Registry reconciliation did not converge")
	}
	next := decode[build.Build](t, b.trigger(t, "revoked-build-key", 202))
	b.c.f.call("DELETE", "/api/projects/"+b.c.projectID+"/members/"+b.c.dev.ID, b.c.admin, nil, 204)
	b.step(t)
	got = decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+next.ID, b.c.admin, nil, 200))
	if got.Status != "failed" || b.kube.creates != 1 {
		t.Fatal("revoked authorization started new work")
	}
}

func TestBuildLeaseFencingAndImmutableExecution(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "lease-fencing-key", 202))
	q := sqlcdb.New(b.c.f.pool)
	ctx := context.Background()
	owner1, owner2 := "worker-one", "worker-two"
	first, e := q.ClaimBuildAttempt(ctx, &owner1)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = q.ClaimBuildAttempt(ctx, &owner2); !errors.Is(e, pgx.ErrNoRows) {
		t.Fatal("active lease was claimed twice")
	}
	if _, e = b.c.f.pool.Exec(ctx, "UPDATE build_attempts SET lease_expires_at=now()-interval '1 second' WHERE id=$1", first.ID); e != nil {
		t.Fatal(e)
	}
	second, e := q.ClaimBuildAttempt(ctx, &owner2)
	if e != nil || second.Revision <= first.Revision {
		t.Fatal("lease fencing revision did not advance")
	}
	_, e = q.TransitionBuildAttempt(ctx, sqlcdb.TransitionBuildAttemptParams{ID: first.ID, Revision: first.Revision, LeaseOwner: &owner1, Stage: "finished", Status: "failed", LogAvailability: "unavailable"})
	if !errors.Is(e, pgx.ErrNoRows) {
		t.Fatal("stale worker overwrote current attempt")
	}
	if _, e = b.c.f.pool.Exec(ctx, "UPDATE build_attempts SET execution_spec='{}' WHERE id=$1", first.ID); e == nil {
		t.Fatal("execution spec was mutable")
	}
	got := decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+out.ID, b.c.developer, nil, 200))
	if got.Status != "queued" {
		t.Fatal("stale worker changed Build status")
	}
}

func TestBuildPartialPreparationFrozenCredentialsAndIdentity(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "partial-preparation-key", 202))
	b.step(t)
	b.kube.dropSecret = true
	b.step(t)
	rows, e := sqlcdb.New(b.c.f.pool).ListBuildAttempts(context.Background(), out.ID)
	if e != nil || len(rows) != 1 {
		t.Fatal("attempt missing")
	}
	var spec build.ExecutionSpec
	_ = json.Unmarshal(rows[0].ExecutionSpec, &spec)
	b.c.f.call("PUT", "/api/credentials/"+spec.ClusterCredential.ID, b.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"apiServer": b.kube.server.URL, "token": "new-current-token", "insecureSkipTLSVerify": true}}, 200)
	vault, _ := credential.New(testCredentialKey)
	settings := b.worker.Settings
	settings.RunnerImage = "registry.test/other@sha256:" + strings.Repeat("b", 64)
	b.worker = build.New(b.c.f.pool, vault, settings)
	b.worker.RegistryTransport = b.registry.Client().Transport
	b.step(t)
	b.step(t)
	if b.kube.creates != 1 || b.kube.starts != 1 {
		t.Fatal("partial preparation created another Job")
	}
	for _, o := range b.kube.objects {
		if o["kind"] == "Job" {
			template := bm(bm(o["spec"])["template"])
			pod := bm(template["spec"])
			containers := pod["containers"].([]any)
			if bm(containers[0])["image"] != spec.RunnerImage || pod["automountServiceAccountToken"] != false || pod["restartPolicy"] != "Never" {
				t.Fatal("frozen runner or isolation changed")
			}
		}
	}
	// A same-name replacement must not be adopted or resumed.
	for _, o := range b.kube.objects {
		if o["kind"] == "Job" {
			bm(o["metadata"])["uid"] = "replacement-job"
		}
	}
	b.step(t)
	got := decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+out.ID, b.c.developer, nil, 200))
	if got.Status != "unknown" {
		t.Fatal("replacement Job was trusted")
	}
}

func TestBuildResultValidationAndHistoryAuthorization(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "invalid-runner-result-key", 202))
	for range 3 {
		b.step(t)
	}
	b.kube.complete = true
	b.kube.badResult = true
	b.step(t)
	got := decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+out.ID, b.c.developer, nil, 200))
	if got.Status != "failed" || got.ArtifactID != nil {
		t.Fatal("invalid runner result produced artifact")
	}
	user := b.c.f.account("unrelated-build-user@example.test", false)
	token := b.c.f.login(user.Email)
	b.c.f.call("GET", "/api/builds/"+out.ID, token, nil, 404)
	b.c.f.call("GET", "/api/apps/"+b.app+"/builds", token, nil, 404)
	b.c.f.call("GET", "/api/apps/"+b.app+"/artifacts", token, nil, 404)
	if _, e := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET next_poll_at=$1", time.Now().Add(-time.Second)); e != nil {
		t.Fatal(e)
	}
	b.c.f.keyed("POST", "/api/apps/"+b.app+"/builds", b.c.developer, "invalid-runner-result-key", application.BuildInput{CommitSHA: b.remote.Main[0].String(), ExpectedConfigVersion: 2}, 409)
}

func TestBuildStartedJobSurvivesRevocationAfterLostResponse(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "lost-start-response-key", 202))
	b.step(t)
	b.step(t)
	b.kube.dropStart = true
	b.step(t)
	b.c.f.call("DELETE", "/api/projects/"+b.c.projectID+"/members/"+b.c.dev.ID, b.c.admin, nil, 204)
	b.step(t)
	b.kube.complete = true
	b.step(t)
	got := decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+out.ID, b.c.admin, nil, 200))
	if got.Status != "succeeded" || got.ArtifactID == nil || b.kube.starts != 1 {
		t.Fatal("existing external outcome was hidden or started twice after revocation")
	}
}

func TestBuildLogCursorArchiveIntegrityAndExpiry(t *testing.T) {
	b := setupBuild(t)
	out := decode[build.Build](t, b.trigger(t, "log-cursor-key", 202))
	for range 3 {
		b.step(t)
	}
	read := func(token, cursor string, want int) string {
		t.Helper()
		r := httptest.NewRequest("GET", "/api/builds/"+out.ID+"/logs?follow=false&cursor="+url.QueryEscape(cursor), nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		b.c.f.handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("log response: got %d want %d: %s", w.Code, want, w.Body.String())
		}
		return w.Body.String()
	}
	raw := read(b.c.developer, "", 200)
	var first struct {
		Cursor string `json:"cursor"`
	}
	if e := json.Unmarshal([]byte(strings.Split(raw, "\n")[0]), &first); e != nil || first.Cursor == "" {
		t.Fatal("log cursor missing")
	}
	resumed := read(b.c.developer, first.Cursor, 200)
	if strings.Contains(resumed, "source fixture output") || !strings.Contains(resumed, "build fixture output") {
		t.Fatal("cursor duplicated or skipped log records")
	}
	read(b.c.developer, first.Cursor+"x", 422)
	read(b.c.admin, first.Cursor, 422)
	b.kube.complete = true
	b.step(t)
	if _, e := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET next_poll_at=now()-interval '1 second'"); e != nil {
		t.Fatal(e)
	}
	if e := b.worker.ArchiveOne(context.Background()); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(read(b.c.developer, first.Cursor, 200), "build fixture output") {
		t.Fatal("archive cursor changed")
	}
	rows, e := sqlcdb.New(b.c.f.pool).ListBuildAttempts(context.Background(), out.ID)
	if e != nil || len(rows) != 1 {
		t.Fatal("attempt missing")
	}
	path := filepath.Join(b.worker.Settings.DataDir, "logs", "builds", rows[0].ID+".ndjson")
	if e := os.WriteFile(path, []byte("corrupted"), 0600); e != nil {
		t.Fatal(e)
	}
	read(b.c.developer, "", 404)
	if _, e := b.c.f.pool.Exec(context.Background(), "UPDATE log_archives SET expires_at=now()-interval '1 second'"); e != nil {
		t.Fatal(e)
	}
	if e := b.worker.PurgeExpiredArchives(context.Background()); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Stat(path); !errors.Is(e, os.ErrNotExist) {
		t.Fatal("expired archive was not removed")
	}
	read(b.c.developer, "", 404)
	got := decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+out.ID, b.c.developer, nil, 200))
	if got.Status != "succeeded" || got.ArtifactID == nil {
		t.Fatal("archive loss removed successful artifact")
	}
}

func TestBuildRunnerRepositoryBoundaries(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if e := os.WriteFile(filepath.Join(root, "Dockerfile"), []byte("FROM scratch\n"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, _, e := build.RepositoryPaths(root, ".", "Dockerfile"); e != nil {
		t.Fatal(e)
	}
	for _, path := range []string{"../outside", "/tmp", `C:\\temp`, "a/../../b"} {
		if _, _, e := build.RepositoryPaths(root, path, "Dockerfile"); e == nil {
			t.Fatalf("accepted escaping context %q", path)
		}
	}
	if e := os.Symlink(outside, filepath.Join(root, "escape")); e != nil {
		t.Fatal(e)
	}
	if _, _, e := build.RepositoryPaths(root, ".", "Dockerfile"); e == nil {
		t.Fatal("accepted escaping nested symlink")
	}
	if e := os.Remove(filepath.Join(root, "escape")); e != nil {
		t.Fatal(e)
	}
	if e := os.Symlink(filepath.Join(root, "Dockerfile"), filepath.Join(root, "safe")); e != nil {
		t.Fatal(e)
	}
	if _, _, e := build.RepositoryPaths(root, ".", "safe"); e != nil {
		t.Fatal("rejected contained symlink", e)
	}
}
