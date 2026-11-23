package integration_test

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/kubernetes"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/release"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// The subprocess opens only its parent's disposable database. It does not
// migrate, bootstrap accounts, run schedulers, or load ambient kubeconfig.
func TestExecutionRecoveryWorkerProcess(t *testing.T) {
	kind := os.Getenv("PODRY_TEST_RECOVERY_CHILD")
	if kind == "" {
		t.Skip("internal subprocess entry point")
	}
	dsn := os.Getenv("PODRY_TEST_RECOVERY_DATABASE")
	databaseURL, parseErr := url.Parse(dsn)
	if parseErr != nil || !strings.HasPrefix(databaseURL.Path, "/podry_test_") {
		t.Fatal("subprocess requires its parent's random test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	defer cancel()
	pool, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal("subprocess database unavailable")
	}
	defer pool.Close()
	vault, err := credential.New(testCredentialKey)
	if err != nil {
		t.Fatal("subprocess vault unavailable")
	}
	var claimed bool
	switch kind {
	case "build":
		var settings build.Settings
		if json.Unmarshal([]byte(os.Getenv("PODRY_TEST_RECOVERY_SETTINGS")), &settings) != nil || settings.Validate() != nil {
			t.Fatal("invalid subprocess build settings")
		}
		claimed, err = build.New(pool, vault, settings).ProcessOne(ctx)
	case "release":
		claimed, err = release.New(pool, vault, release.Settings{Enabled: true, Concurrency: 1}, release.NewHelm()).ProcessOne(ctx)
	default:
		t.Fatal("invalid subprocess mode")
	}
	if err != nil {
		t.Fatal("subprocess execution step failed")
	}
	raw, _ := json.Marshal(map[string]bool{"claimed": claimed})
	if os.WriteFile(os.Getenv("PODRY_TEST_RECOVERY_RESULT"), raw, 0600) != nil {
		t.Fatal("subprocess result unavailable")
	}
}

type recoveryChild struct {
	cmd    *exec.Cmd
	done   chan error
	result string
}

func startRecoveryChild(t *testing.T, dsn, kind string, settings build.Settings) *recoveryChild {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal("test executable unavailable")
	}
	c := &recoveryChild{cmd: exec.Command(executable, "-test.run=^TestExecutionRecoveryWorkerProcess$", "-test.timeout=45s"), done: make(chan error, 1), result: filepath.Join(t.TempDir(), "step.json")}
	// Credentials travel in the child's environment, never command arguments or
	// captured public output. Suppress raw SDK/DB diagnostics at this boundary.
	for _, value := range os.Environ() {
		key := strings.SplitN(value, "=", 2)[0]
		if !strings.HasPrefix(strings.ToUpper(key), "PODRY_TEST_") {
			c.cmd.Env = append(c.cmd.Env, value)
		}
	}
	raw, _ := json.Marshal(settings)
	c.cmd.Env = append(c.cmd.Env, "PODRY_TEST_RECOVERY_CHILD="+kind, "PODRY_TEST_RECOVERY_DATABASE="+dsn, "PODRY_TEST_RECOVERY_SETTINGS="+string(raw), "PODRY_TEST_RECOVERY_RESULT="+c.result)
	c.cmd.Stdout, c.cmd.Stderr = io.Discard, io.Discard
	if err = c.cmd.Start(); err != nil {
		t.Fatal("worker subprocess could not start")
	}
	go func() { c.done <- c.cmd.Wait() }()
	t.Cleanup(func() { _ = c.cmd.Process.Kill() })
	return c
}

func (c *recoveryChild) wait(t *testing.T, killed bool) bool {
	t.Helper()
	select {
	case err := <-c.done:
		if killed {
			var exit *exec.ExitError
			if !errors.As(err, &exit) {
				t.Fatal("worker was not terminated by the process kill")
			}
			if _, err = os.Stat(c.result); !os.IsNotExist(err) {
				t.Fatal("killed worker unexpectedly saved a step result")
			}
			return false
		}
		if err != nil {
			t.Fatal("worker subprocess returned a failed step")
		}
		var result struct{ Claimed bool }
		raw, err := os.ReadFile(c.result)
		if err != nil || json.Unmarshal(raw, &result) != nil {
			t.Fatal("worker subprocess result missing")
		}
		return result.Claimed
	case <-time.After(50 * time.Second):
		_ = c.cmd.Process.Kill()
		t.Fatal("worker subprocess did not exit within its budget")
		return false
	}
}

// The loopback proxy withholds one *successful* upstream response. Real K3s
// commits or reads the object first; the parent then kills the worker process.
// No fake executor, lease edits or direct execution-state edits are involved.
type recoveryProxy struct {
	server   *httptest.Server
	entered  chan unstructured.Unstructured
	writes   atomic.Int32
	posts    atomic.Int32
	consumed atomic.Bool
	armed    atomic.Bool
}

func newRecoveryProxy(t *testing.T, payload map[string]any, namespace, mode string) *recoveryProxy {
	t.Helper()
	p, err := credential.ParseKubernetes(payload)
	if err != nil {
		t.Fatal("live proxy credentials rejected")
	}
	target, _ := url.Parse(p.APIServer)
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: p.InsecureSkipTLSVerify}
	if len(p.CAData) > 0 {
		tlsConfig.RootCAs = x509.NewCertPool()
		tlsConfig.RootCAs.AppendCertsFromPEM(p.CAData)
	}
	if len(p.ClientCertificate.Certificate) > 0 {
		tlsConfig.Certificates = []tls.Certificate{p.ClientCertificate}
	}
	transport := &http.Transport{TLSClientConfig: tlsConfig, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 10 * time.Second}
	t.Cleanup(transport.CloseIdleConnections)
	f := &recoveryProxy{entered: make(chan unstructured.Unstructured, 1)}
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		r.Host = target.Host
		// client-go negotiates protobuf for typed Secrets. Ask the real API for
		// JSON so the fault injector can inspect identity without decoding or
		// exposing Helm's secret payload. The SDK still decodes the response.
		r.Header.Set("Accept", "application/json")
		r.Header.Del("Authorization")
		if p.Token != "" {
			r.Header.Set("Authorization", "Bearer "+p.Token)
		}
	}
	proxy.Transport = transport
	proxy.ErrorLog = log.New(io.Discard, "", 0)
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) { w.WriteHeader(502) }
	proxy.ModifyResponse = func(r *http.Response) error {
		path := r.Request.URL.Path
		create := r.Request.Method == "POST" && r.StatusCode == 201 &&
			(((mode == "build" || mode == "release-workload") && strings.HasSuffix(path, "/jobs")) || (mode == "release" && strings.HasSuffix(path, "/secrets")))
		observe := mode == "build-observe" && f.armed.Load() && r.Request.Method == "GET" && r.StatusCode == 200 && strings.Contains(path, "/jobs/")
		if !create && !observe {
			return nil
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
		_ = r.Body.Close()
		if err != nil {
			return errors.New("response read unavailable")
		}
		r.Body = io.NopCloser(bytes.NewReader(raw))
		var object unstructured.Unstructured
		if json.Unmarshal(raw, &object) != nil || object.GetNamespace() != namespace || object.GetUID() == "" {
			return errors.New("response identity unavailable")
		}
		if mode == "release" && object.Object["type"] != "helm.sh/release.v1" {
			return nil
		}
		if f.consumed.CompareAndSwap(false, true) {
			f.entered <- object
			<-r.Request.Context().Done()
			return errors.New("withheld response")
		}
		return nil
	}
	f.server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer recovery-frozen-token" {
			w.WriteHeader(401)
			return
		}
		// Permit discovery reads, but all resource requests must be namespaced
		// to this run. Writes cannot escape through URL/query manipulation.
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		inNamespace := false
		for i, part := range parts {
			if part == "namespaces" && i+1 < len(parts) && parts[i+1] == namespace {
				inNamespace = true
			}
		}
		read := r.Method == "GET" || r.Method == "HEAD"
		discovery := r.URL.Path == "/version" || r.URL.Path == "/api" || r.URL.Path == "/apis" ||
			(len(parts) == 2 && parts[0] == "api") || (len(parts) <= 3 && parts[0] == "apis") ||
			strings.HasPrefix(r.URL.Path, "/openapi/")
		if !inNamespace && (!read || !discovery) {
			w.WriteHeader(403)
			return
		}
		if !read {
			f.writes.Add(1)
			if r.Method == "POST" {
				f.posts.Add(1)
			}
		}
		proxy.ServeHTTP(w, r)
	}))
	t.Cleanup(f.server.Close)
	return f
}

func (p *recoveryProxy) killAfterCommit(t *testing.T, child *recoveryChild) unstructured.Unstructured {
	t.Helper()
	select {
	case object := <-p.entered:
		if child.cmd.Process.Kill() != nil {
			t.Fatal("could not kill the worker after upstream commit")
		}
		child.wait(t, true)
		return object
	case <-time.After(30 * time.Second):
		t.Fatal("worker did not reach the committed-response boundary")
		return unstructured.Unstructured{}
	case <-child.done:
		t.Fatal("worker exited before the committed-response boundary")
		return unstructured.Unstructured{}
	}
}

func recoveryLeaseExpires(t *testing.T, until time.Time) {
	t.Helper()
	if remaining := time.Until(until); remaining <= 0 || remaining > 65*time.Second {
		t.Fatal("live recovery requires the original unmodified active lease")
	}
	// Real wall time: never shorten a production lease in this acceptance.
	for time.Now().Before(until.Add(500 * time.Millisecond)) {
		time.Sleep(250 * time.Millisecond)
	}
}

func recoveryNamespace(t *testing.T, payload map[string]any) (*kubernetes.Client, string, map[string]any) {
	t.Helper()
	client, err := kubernetes.New(payload)
	if err != nil {
		t.Fatal("live cluster credentials rejected")
	}
	t.Cleanup(client.Close)
	runID := uuid.NewString()
	namespace := "podry-recovery-live-" + runID[:8]
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	var original unstructured.Unstructured
	if client.Write(ctx, "POST", "/api/v1/namespaces", map[string]any{"apiVersion": "v1", "kind": "Namespace", "metadata": map[string]any{"name": namespace, "labels": map[string]any{"podry.io/recovery-live-run": runID}}}, &original) != nil {
		t.Fatal("could not create isolated recovery namespace")
	}
	evidence := map[string]any{"namespace": namespace, "namespaceUid": string(original.GetUID()), "runId": runID}
	t.Cleanup(func() {
		if t.Failed() {
			t.Log("retained recovery fixture:", namespace)
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 75*time.Second)
		defer cancel()
		path := "/api/v1/namespaces/" + namespace
		var current unstructured.Unstructured
		if client.Get(ctx, path, nil, &current) != nil || current.GetUID() != original.GetUID() || current.GetLabels()["podry.io/recovery-live-run"] != runID {
			t.Error("recovery namespace identity changed; retained")
			return
		}
		_, _, err := client.ResourceWrite(ctx, "DELETE", path, map[string]any{"apiVersion": "v1", "kind": "DeleteOptions", "preconditions": map[string]any{"uid": string(current.GetUID()), "resourceVersion": current.GetResourceVersion()}}, false)
		if err != nil {
			t.Error("recovery namespace conditional deletion failed")
			return
		}
		for ctx.Err() == nil {
			var after unstructured.Unstructured
			err = client.Get(ctx, path, nil, &after)
			if kubernetes.IsMissing(err) {
				evidence["namespaceRemoved"] = true
				return
			}
			if err != nil || after.GetUID() != original.GetUID() {
				break
			}
			time.Sleep(time.Second)
		}
		t.Error("recovery namespace removal unconfirmed")
	})
	return client, namespace, evidence
}

func recoveryCluster(t *testing.T, c *controlFixture, proxy *recoveryProxy) (platform.Credential, platform.Cluster) {
	t.Helper()
	cr := decode[platform.Credential](t, c.f.call("POST", "/api/credentials", c.admin, map[string]any{"name": "Recovery proxy", "kind": "kubeconfig", "teamId": nil, "payload": map[string]any{"apiServer": proxy.server.URL, "token": "recovery-frozen-token", "insecureSkipTLSVerify": true}}, 201))
	cl := decode[platform.Cluster](t, c.f.call("POST", "/api/clusters", c.admin, map[string]any{"name": "Recovery proxy", "apiServer": proxy.server.URL, "credentialId": cr.ID}, 201))
	return cr, cl
}

func recoveryRotate(t *testing.T, c *controlFixture, cr platform.Credential, proxy *recoveryProxy) {
	t.Helper()
	c.f.call("PUT", "/api/credentials/"+cr.ID, c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"apiServer": proxy.server.URL, "token": "current-token-must-not-replace-frozen-input", "insecureSkipTLSVerify": true}}, 200)
}

func TestExecutionRecoveryLive(t *testing.T) {
	if os.Getenv("PODRY_TEST_EXECUTION_RECOVERY_LIVE") != "1" {
		t.Skip("PODRY_TEST_EXECUTION_RECOVERY_LIVE=1 is required for isolated cluster writes")
	}
	var payload map[string]any
	if json.Unmarshal([]byte(os.Getenv("PODRY_TEST_KUBE_PAYLOAD")), &payload) != nil {
		t.Fatal("live kubeconfig payload required")
	}
	evidence := map[string]any{"schemaVersion": 1, "startedAt": time.Now().UTC(), "scope": "real OS process kills, PostgreSQL and K3s; build stopped while suspended; Helm stopped after pending storage commit; no Git/BuildKit/push or successful workload deployment"}
	t.Run("build_create_response_lost", func(t *testing.T) {
		b := setupBuild(t)
		client, ns, result := recoveryNamespace(t, payload)
		evidence["build"] = result
		proxy := newRecoveryProxy(t, payload, ns, "build")
		cr, cluster := recoveryCluster(t, b.c, proxy)
		b.worker.Settings.ClusterID, b.worker.Settings.Namespace = cluster.ID, ns
		out := decode[build.Build](t, b.trigger(t, "recovery-live-build", 202))
		q := sqlcdb.New(b.c.f.pool)
		child := startRecoveryChild(t, b.c.f.dsn, "build", b.worker.Settings)
		object := proxy.killAfterCommit(t, child)
		ctx := context.Background()
		row, err := q.GetBuildAttempt(ctx, sqlcdb.GetBuildAttemptParams{BuildID: out.ID, AttemptNo: 1})
		if err != nil || row.Stage != "creating" || row.JobUid != nil || row.LeaseOwner == nil || row.LeaseExpiresAt == nil {
			t.Fatal("process kill lost the original build creation intent")
		}
		if startRecoveryChild(t, b.c.f.dsn, "build", b.worker.Settings).wait(t, false) {
			t.Fatal("second process stole the active build lease")
		}
		recoveryRotate(t, b.c, cr, proxy)
		recoveryLeaseExpires(t, *row.LeaseExpiresAt)
		if !startRecoveryChild(t, b.c.f.dsn, "build", b.worker.Settings).wait(t, false) {
			t.Fatal("new process did not reclaim the expired build lease")
		}
		after, err := q.GetBuildAttempt(ctx, sqlcdb.GetBuildAttemptParams{BuildID: out.ID, AttemptNo: 1})
		if err != nil || after.Stage != "preparing" || after.JobUid == nil || *after.JobUid != string(object.GetUID()) || after.ExecutionHash != row.ExecutionHash || after.Revision <= row.Revision || proxy.posts.Load() != 1 || proxy.writes.Load() != 1 {
			t.Fatal("build recovery changed identity or repeated external submission")
		}
		b.c.f.call("DELETE", "/api/projects/"+b.c.projectID+"/members/"+b.c.dev.ID, b.c.admin, nil, 204)
		// Only the polling due time is accelerated; the creation lease above
		// expired naturally and no execution status/owner/revision is seeded.
		if _, err = b.c.f.pool.Exec(ctx, "UPDATE build_attempts SET next_poll_at=clock_timestamp() WHERE id=$1", row.ID); err != nil {
			t.Fatal(err)
		}
		if !startRecoveryChild(t, b.c.f.dsn, "build", b.worker.Settings).wait(t, false) {
			t.Fatal("revoked suspended build not processed")
		}
		final, err := q.GetBuildAttempt(ctx, sqlcdb.GetBuildAttemptParams{BuildID: out.ID, AttemptNo: 1})
		var job unstructured.Unstructured
		path := "/apis/batch/v1/namespaces/" + ns + "/jobs/" + object.GetName()
		if err != nil || final.Status != "failed" || final.ErrorCode == nil || *final.ErrorCode != "execution_authorization_revoked" || client.Get(ctx, path, nil, &job) != nil || job.GetUID() != object.GetUID() || bm(job.Object["spec"])["suspend"] != true || proxy.writes.Load() != 1 {
			t.Fatal("revoked build started or lost the suspended Job")
		}
		var artifacts int
		if b.c.f.pool.QueryRow(ctx, "SELECT count(*) FROM artifacts").Scan(&artifacts) != nil || artifacts != 0 {
			t.Fatal("crashed suspended build produced a phantom artifact")
		}
		result["jobUid"], result["buildId"], result["attemptId"] = string(object.GetUID()), out.ID, row.ID
		result["jobCreates"], result["externalWrites"], result["artifacts"] = proxy.posts.Load(), proxy.writes.Load(), artifacts
		result["status"], result["errorCode"] = final.Status, *final.ErrorCode
		result["originalLeaseExpiredNaturally"], result["secondProcessBlocked"], result["frozenCredentialAfterRotation"], result["revocationBlockedStart"] = true, true, true, true
	})
	t.Run("helm_pending_response_lost", func(t *testing.T) {
		f := setupRelease(t, "Job")
		client, ns, result := recoveryNamespace(t, payload)
		evidence["release"] = result
		proxy := newRecoveryProxy(t, payload, ns, "release")
		cr, cluster := recoveryCluster(t, f.c, proxy)
		ctx := context.Background()
		for _, statement := range []struct {
			sql  string
			args []any
		}{
			{"UPDATE deployment_targets SET cluster_id=$2,namespace=$3 WHERE id=(SELECT target_id FROM app_environment_bindings WHERE id=$1)", []any{f.binding, cluster.ID, ns}},
			{"UPDATE resource_grants SET cluster_id=$2,namespace=$3 WHERE id=$1", []any{f.grant, cluster.ID, ns}},
		} {
			if _, err := f.c.f.pool.Exec(ctx, statement.sql, statement.args...); err != nil {
				t.Fatal("isolated target setup failed")
			}
		}
		// Only readiness is used in the parent; all external execution happens
		// through the real Helm SDK inside the killable child process.
		releaseWorker(t, f, release.NewHelm())
		first := decode[application.ReleaseRequest](t, f.confirm(t, f.preview(t, 3), "recovery-live-release-first", 202))
		second := decode[application.ReleaseRequest](t, f.confirm(t, f.preview(t, 3), "recovery-live-release-second", 202))
		child := startRecoveryChild(t, f.c.f.dsn, "release", build.Settings{})
		object := proxy.killAfterCommit(t, child)
		q := sqlcdb.New(f.c.f.pool)
		row, err := q.GetDeployment(ctx, *first.DeploymentID)
		if err != nil || row.Status != "submitting" || row.LeaseOwner == nil || row.LeaseUntil == nil || object.GetLabels()["status"] != "pending-install" {
			t.Fatal("process kill lost the durable release submission")
		}
		if startRecoveryChild(t, f.c.f.dsn, "release", build.Settings{}).wait(t, false) {
			t.Fatal("second process stole an active physical target")
		}
		var active string
		var fencing int64
		if f.c.f.pool.QueryRow(ctx, "SELECT active_deployment_id::text,fencing_token FROM deployment_targets WHERE id=$1", row.TargetID).Scan(&active, &fencing) != nil || active != row.ID {
			t.Fatal("killed release lost its physical target")
		}
		recoveryRotate(t, f.c, cr, proxy)
		f.c.f.call("DELETE", "/api/clusters/"+cluster.ID+"/resource-grants/"+f.grant, f.c.admin, nil, 204)
		recoveryLeaseExpires(t, *row.LeaseUntil)
		writes := proxy.writes.Load()
		if !startRecoveryChild(t, f.c.f.dsn, "release", build.Settings{}).wait(t, false) {
			t.Fatal("new process did not observe the interrupted release")
		}
		after, err := q.GetDeployment(ctx, row.ID)
		var current unstructured.Unstructured
		if err != nil || after.Status != "unknown" || after.HelmRevision == nil || *after.HelmRevision != 1 || after.Revision <= row.Revision || proxy.writes.Load() != writes || proxy.posts.Load() != 1 || client.Get(ctx, "/api/v1/namespaces/"+ns+"/secrets/"+object.GetName(), nil, &current) != nil || current.GetUID() != object.GetUID() || current.GetResourceVersion() != object.GetResourceVersion() {
			t.Fatal("partial Helm recovery repeated submission or hid the original pending record")
		}
		var nextActive string
		var nextFencing int64
		if f.c.f.pool.QueryRow(ctx, "SELECT active_deployment_id::text,fencing_token FROM deployment_targets WHERE id=$1", row.TargetID).Scan(&nextActive, &nextFencing) != nil || nextActive != active || nextFencing != fencing {
			t.Fatal("unknown recovery released or replaced the target fencing")
		}
		releaseState(t, f, *second.DeploymentID, "queued")
		// Blocked next target must not trigger another Helm revision.
		startRecoveryChild(t, f.c.f.dsn, "release", build.Settings{}).wait(t, false)
		releaseState(t, f, *second.DeploymentID, "queued")
		if proxy.writes.Load() != writes {
			t.Fatal("queued release escaped the unknown target hold")
		}
		for _, table := range []string{"release_requests", "release_snapshots", "deployments"} {
			var count int
			if f.c.f.pool.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&count) != nil || count != 2 {
				t.Fatal("process recovery duplicated release history")
			}
		}
		var currentDeployment *string
		if f.c.f.pool.QueryRow(ctx, "SELECT current_deployment_id::text FROM app_environment_bindings WHERE id=$1", f.binding).Scan(&currentDeployment) != nil || currentDeployment != nil {
			t.Fatal("pending recovery moved the successful deployment pointer")
		}
		result["deploymentId"], result["queuedDeploymentId"], result["helmStorageUid"] = row.ID, *second.DeploymentID, string(object.GetUID())
		result["helmStorageCreates"], result["externalWrites"], result["status"], result["fencingToken"] = proxy.posts.Load(), writes, after.Status, nextFencing
		result["observedHelmRevision"], result["helmStatus"] = *after.HelmRevision, object.GetLabels()["status"]
		result["requests"], result["snapshots"], result["deployments"], result["currentDeploymentUnchanged"] = 2, 2, 2, true
		result["originalLeaseExpiredNaturally"], result["secondProcessBlocked"], result["frozenCredentialAfterRotation"], result["observationContinuedAfterRevocation"], result["queuedTargetBlocked"] = true, true, true, true, true
	})
	if t.Failed() {
		return
	}
	evidence["finishedAt"] = time.Now().UTC()
	if path := os.Getenv("PODRY_TEST_RECOVERY_EVIDENCE"); path != "" {
		raw, _ := json.MarshalIndent(evidence, "", "  ")
		if os.WriteFile(path+".tmp", append(raw, '\n'), 0600) != nil || os.Rename(path+".tmp", path) != nil {
			t.Fatal("recovery evidence publication failed")
		}
	}
}
