package integration_test

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"testing/fstest"
	"time"

	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/audit"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/gitremote"
	"github.com/xuzuxing/podry/internal/kubernetes"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
	"github.com/xuzuxing/podry/internal/release"
	"github.com/xuzuxing/podry/internal/server"
	"github.com/xuzuxing/podry/tests/gitfixture"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// Replace only a positively identified test Job, after its original UID has
// been persisted by the production worker. The replacement copies ownership
// annotations/labels, so name/hash/labels alone cannot detect this fault.
func recoveryReplaceJob(t *testing.T, client *kubernetes.Client, original unstructured.Unstructured) unstructured.Unstructured {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	base := "/apis/batch/v1/namespaces/" + original.GetNamespace() + "/jobs"
	path := base + "/" + original.GetName()
	var current unstructured.Unstructured
	if client.Get(ctx, path, nil, &current) != nil || current.GetUID() != original.GetUID() {
		t.Fatal("refusing to replace a changed test Job")
	}
	_, _, err := client.ResourceWrite(ctx, "DELETE", path, map[string]any{"apiVersion": "v1", "kind": "DeleteOptions", "propagationPolicy": "Foreground", "preconditions": map[string]any{"uid": string(current.GetUID()), "resourceVersion": current.GetResourceVersion()}}, false)
	if err != nil {
		t.Fatal("conditional test Job deletion failed")
	}
	removed := false
	for ctx.Err() == nil {
		var after unstructured.Unstructured
		err = client.Get(ctx, path, nil, &after)
		if kubernetes.IsMissing(err) {
			removed = true
			break
		}
		if err != nil || after.GetUID() != original.GetUID() {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if !removed {
		t.Fatal("original test Job removal unconfirmed")
	}
	copy := current.DeepCopy()
	copy.Object["metadata"] = map[string]any{"name": current.GetName(), "namespace": current.GetNamespace()}
	copy.SetLabels(current.GetLabels())
	copy.SetAnnotations(current.GetAnnotations())
	unstructured.RemoveNestedField(copy.Object, "status")
	unstructured.RemoveNestedField(copy.Object, "spec", "selector")
	// A replacement stays suspended and never starts additional user code.
	_ = unstructured.SetNestedField(copy.Object, true, "spec", "suspend")
	for _, key := range []string{"batch.kubernetes.io/controller-uid", "batch.kubernetes.io/job-name", "controller-uid", "job-name"} {
		unstructured.RemoveNestedField(copy.Object, "spec", "template", "metadata", "labels", key)
	}
	var replacement unstructured.Unstructured
	if client.Write(ctx, "POST", base, copy.Object, &replacement) != nil || replacement.GetUID() == "" || replacement.GetUID() == original.GetUID() {
		t.Fatal("same-name test Job replacement failed")
	}
	return replacement
}

func recoveryBuildDue(t *testing.T, b *buildFixture, id string) {
	t.Helper()
	if _, err := b.c.f.pool.Exec(context.Background(), "UPDATE build_attempts SET next_poll_at=clock_timestamp() WHERE build_id=$1", id); err != nil {
		t.Fatal("test polling schedule unavailable")
	}
}

// The explicit host must route from runner Pods to this test process. It carries
// only generated anonymous Git data; no user repository or credential is used.
func recoveryRunningBuild(t *testing.T, host string) *buildFixture {
	t.Helper()
	b := setupBuildWithHTTP(t, true)
	remote := gitfixture.NewWithRootFiles(t, map[string]string{"Dockerfile": "FROM scratch\n"})
	listener, err := net.Listen("tcp", net.JoinHostPort(host, "0"))
	if err != nil {
		t.Fatal("runner Git fixture listener unavailable")
	}
	httpGit := httptest.NewUnstartedServer(remote.Server.Config.Handler)
	_ = httpGit.Listener.Close()
	httpGit.Listener = listener
	httpGit.Start()
	t.Cleanup(httpGit.Close)
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	httpGit.URL = "http://" + net.JoinHostPort(host, port)
	remote.Server = httpGit
	b.remote, b.sha = remote, remote.Main[2].String()
	u, _ := url.Parse(httpGit.URL)
	r, _ := url.Parse(b.registry.URL)
	policy := credential.URLPolicy{AllowedHTTPHosts: []string{u.Host, r.Host}}
	vault, _ := credential.New(testCredentialKey)
	// Cluster-local fixture traffic must not inherit an ambient HTTP proxy.
	transport := &http.Transport{Proxy: nil}
	t.Cleanup(transport.CloseIdleConnections)
	b.apps = application.New(b.c.f.pool, vault, gitremote.New(&http.Client{Transport: transport, Timeout: 20 * time.Second}).WithURLPolicy(policy), testJWT).UseBuilds(b.worker).WithURLPolicy(policy)
	b.c.f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: b.c.f.auth, Project: project.New(b.c.f.pool), Audit: audit.New(b.c.f.pool), Platform: platform.New(b.c.f.pool, vault).WithURLPolicy(policy), Application: b.apps})
	saveGit(t, b.c, b.app, remote.URL(), 2, nil)
	config := decode[application.Config](t, b.c.f.call("GET", "/api/apps/"+b.app+"/config", b.c.developer, nil, 200))
	check := "test -f Dockerfile\nsleep 240\nexit 1"
	config.BuildConfig.CheckScript = &check
	b.c.f.call("PUT", "/api/apps/"+b.app+"/config", b.c.developer, map[string]any{"expectedVersion": 3, "section": "build", "buildConfig": config.BuildConfig}, 200)
	return b
}

func recoveryCheckRunning(t *testing.T, client *kubernetes.Client, ns, uid string) unstructured.Unstructured {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	for ctx.Err() == nil {
		var list unstructured.UnstructuredList
		if client.Get(ctx, "/api/v1/namespaces/"+ns+"/pods", url.Values{"labelSelector": {"controller-uid=" + uid}}, &list) != nil {
			t.Fatal("runner Pod observation unavailable")
		}
		for _, pod := range list.Items {
			statuses, _, _ := unstructured.NestedSlice(pod.Object, "status", "initContainerStatuses")
			source, check := false, false
			for _, raw := range statuses {
				status := bm(raw)
				if status["name"] == "source" {
					source = bm(bm(status["state"])["terminated"])["exitCode"] == int64(0) || bm(bm(status["state"])["terminated"])["exitCode"] == float64(0)
				}
				if status["name"] == "check" {
					check = bm(status["state"])["running"] != nil
				}
			}
			if source && check {
				for _, owner := range pod.GetOwnerReferences() {
					if string(owner.UID) == uid && owner.Kind == "Job" && owner.Controller != nil && *owner.Controller {
						return pod
					}
				}
			}
		}
		time.Sleep(time.Second)
	}
	t.Fatal("controlled runner source did not finish and enter the check phase")
	return unstructured.Unstructured{}
}

func TestWorkloadExecutionRecoveryLive(t *testing.T) {
	if os.Getenv("PODRY_TEST_WORKLOAD_RECOVERY_LIVE") != "1" {
		t.Skip("PODRY_TEST_WORKLOAD_RECOVERY_LIVE=1 is required for isolated cluster writes")
	}
	var payload map[string]any
	if json.Unmarshal([]byte(os.Getenv("PODRY_TEST_KUBE_PAYLOAD")), &payload) != nil {
		t.Fatal("live kubeconfig payload required")
	}
	host := os.Getenv("PODRY_TEST_RECOVERY_RUNNER_HOST")
	if net.ParseIP(host) == nil || net.ParseIP(host).IsUnspecified() || net.ParseIP(host).IsLoopback() {
		t.Fatal("explicit test process IP reachable from runner Pods required")
	}
	runner := os.Getenv("PODRY_TEST_RECOVERY_RUNNER_IMAGE")
	evidence := map[string]any{"schemaVersion": 1, "startedAt": time.Now().UTC(), "scope": "real process kills, controlled runner source/check, partial Helm workload and same-name UID replacements; generated Git and Registry fixtures; no BuildKit/push or successful release"}
	t.Run("running_check_kill_and_replaced_uid", func(t *testing.T) {
		b := recoveryRunningBuild(t, host)
		client, ns, result := recoveryNamespace(t, payload)
		evidence["build"] = result
		proxy := newRecoveryProxy(t, payload, ns, "build-observe")
		cr, cluster := recoveryCluster(t, b.c, proxy)
		b.worker.Settings.ClusterID, b.worker.Settings.Namespace, b.worker.Settings.RunnerImage = cluster.ID, ns, runner
		if b.worker.Settings.Validate() != nil {
			t.Fatal("explicit pinned runner image required")
		}
		out := decode[build.Build](t, b.c.f.keyed("POST", "/api/apps/"+b.app+"/builds", b.c.developer, "running-recovery-build", application.BuildInput{CommitSHA: b.sha, ExpectedConfigVersion: 4}, 202))
		for range 3 {
			recoveryBuildDue(t, b, out.ID)
			if !startRecoveryChild(t, b.c.f.dsn, "build", b.worker.Settings).wait(t, false) {
				t.Fatal("runner preparation step not claimed")
			}
		}
		q, ctx := sqlcdb.New(b.c.f.pool), context.Background()
		before, err := q.GetBuildAttempt(ctx, sqlcdb.GetBuildAttemptParams{BuildID: out.ID, AttemptNo: 1})
		if err != nil || before.Stage != "observing" || before.Status != "running" || before.JobUid == nil {
			t.Fatal("runner was not started by the worker")
		}
		pod := recoveryCheckRunning(t, client, ns, *before.JobUid)
		proxy.armed.Store(true)
		recoveryBuildDue(t, b, out.ID)
		object := proxy.killAfterCommit(t, startRecoveryChild(t, b.c.f.dsn, "build", b.worker.Settings))
		row, err := q.GetBuildAttempt(ctx, sqlcdb.GetBuildAttemptParams{BuildID: out.ID, AttemptNo: 1})
		if err != nil || row.LeaseOwner == nil || row.LeaseExpiresAt == nil || row.Stage != "observing" || row.Status != "running" || string(object.GetUID()) != *before.JobUid {
			t.Fatal("running process kill lost the original execution identity")
		}
		if startRecoveryChild(t, b.c.f.dsn, "build", b.worker.Settings).wait(t, false) {
			t.Fatal("second process stole a running build lease")
		}
		recoveryRotate(t, b.c, cr, proxy)
		b.c.f.call("DELETE", "/api/projects/"+b.c.projectID+"/members/"+b.c.dev.ID, b.c.admin, nil, 204)
		writes := proxy.writes.Load()
		if writes != 4 || proxy.posts.Load() != 3 {
			t.Fatal("running build preparation did not create exactly one Job, ConfigMap, Secret and start patch")
		}
		recoveryLeaseExpires(t, *row.LeaseExpiresAt)
		if !startRecoveryChild(t, b.c.f.dsn, "build", b.worker.Settings).wait(t, false) {
			t.Fatal("new process did not reclaim running observation")
		}
		after, err := q.GetBuildAttempt(ctx, sqlcdb.GetBuildAttemptParams{BuildID: out.ID, AttemptNo: 1})
		stillRunning := recoveryCheckRunning(t, client, ns, *row.JobUid)
		if err != nil || after.Status != "running" || after.JobUid == nil || *after.JobUid != *row.JobUid || after.ExecutionHash != row.ExecutionHash || after.Revision <= row.Revision || stillRunning.GetUID() != pod.GetUID() || proxy.writes.Load() != writes || proxy.posts.Load() != 3 {
			t.Fatal("running recovery repeated execution or hid the in-flight outcome after revocation")
		}
		replacement := recoveryReplaceJob(t, client, object)
		for range 2 {
			recoveryBuildDue(t, b, out.ID)
			if !startRecoveryChild(t, b.c.f.dsn, "build", b.worker.Settings).wait(t, false) {
				t.Fatal("replacement identity not observed")
			}
			final, err := q.GetBuildAttempt(ctx, sqlcdb.GetBuildAttemptParams{BuildID: out.ID, AttemptNo: 1})
			if err != nil || final.Status != "unknown" || final.ErrorCode == nil || *final.ErrorCode != "job_identity_conflict" || final.JobUid == nil || *final.JobUid != *row.JobUid || proxy.writes.Load() != writes {
				t.Fatal("same-name replacement was adopted or mutated")
			}
		}
		var artifacts, builds, attempts int
		if b.c.f.pool.QueryRow(ctx, "SELECT (SELECT count(*) FROM artifacts),(SELECT count(*) FROM builds),(SELECT count(*) FROM build_attempts)").Scan(&artifacts, &builds, &attempts) != nil || artifacts != 0 || builds != 1 || attempts != 1 {
			t.Fatal("running recovery duplicated history or fabricated an artifact")
		}
		result["buildId"], result["attemptId"], result["originalJobUid"], result["replacementJobUid"], result["runningPodUid"] = out.ID, row.ID, *row.JobUid, string(replacement.GetUID()), string(pod.GetUID())
		result["status"], result["errorCode"], result["externalWrites"], result["externalCreates"], result["artifacts"] = "unknown", "job_identity_conflict", writes, proxy.posts.Load(), artifacts
		result["faultInjectorWrites"] = 2
		result["sourceCompleted"], result["checkRunningBeforeAndAfterRecovery"], result["samePodRecovered"], result["originalLeaseExpiredNaturally"], result["secondProcessBlocked"], result["frozenCredentialAfterRotation"], result["observationContinuedAfterRevocation"], result["uidConflictRepeated"], result["originalUidPreserved"] = true, true, true, true, true, true, true, true, true
	})
	t.Run("helm_workload_partial_kill_and_replaced_uid", func(t *testing.T) {
		f := setupRelease(t, "Job")
		client, ns, result := recoveryNamespace(t, payload)
		evidence["release"] = result
		proxy := newRecoveryProxy(t, payload, ns, "release-workload")
		_, cluster := recoveryCluster(t, f.c, proxy)
		ctx := context.Background()
		for _, stmt := range []struct {
			sql  string
			args []any
		}{
			{"UPDATE deployment_targets SET cluster_id=$2,namespace=$3 WHERE id=(SELECT target_id FROM app_environment_bindings WHERE id=$1)", []any{f.binding, cluster.ID, ns}},
			{"UPDATE resource_grants SET cluster_id=$2,namespace=$3 WHERE id=$1", []any{f.grant, cluster.ID, ns}},
		} {
			if _, err := f.c.f.pool.Exec(ctx, stmt.sql, stmt.args...); err != nil {
				t.Fatal("isolated release target setup failed")
			}
		}
		releaseWorker(t, f, release.NewHelm())
		first := decode[application.ReleaseRequest](t, f.confirm(t, f.preview(t, 3), "partial-workload-first", 202))
		second := decode[application.ReleaseRequest](t, f.confirm(t, f.preview(t, 3), "partial-workload-second", 202))
		object := proxy.killAfterCommit(t, startRecoveryChild(t, f.c.f.dsn, "release", build.Settings{}))
		q := sqlcdb.New(f.c.f.pool)
		row, err := q.GetDeployment(ctx, *first.DeploymentID)
		if err != nil || row.Status != "submitting" || row.LeaseUntil == nil || row.LeaseOwner == nil {
			t.Fatal("partial workload submission intent lost")
		}
		var records unstructured.UnstructuredList
		storagePath := "/api/v1/namespaces/" + ns + "/secrets"
		if client.Get(ctx, storagePath, url.Values{"labelSelector": {"owner=helm"}}, &records) != nil || len(records.Items) != 1 || records.Items[0].GetLabels()["status"] != "pending-install" {
			t.Fatal("workload fault did not retain the original pending Helm revision")
		}
		storage := records.Items[0]
		if startRecoveryChild(t, f.c.f.dsn, "release", build.Settings{}).wait(t, false) {
			t.Fatal("second process stole partial release lease")
		}
		writes := proxy.writes.Load()
		if writes != 3 || proxy.posts.Load() != 3 {
			t.Fatal("partial Helm submission did not create exactly one storage record, runtime Secret and Job")
		}
		recoveryLeaseExpires(t, *row.LeaseUntil)
		if !startRecoveryChild(t, f.c.f.dsn, "release", build.Settings{}).wait(t, false) {
			t.Fatal("partial release not reclaimed")
		}
		after, err := q.GetDeployment(ctx, row.ID)
		var remembered string
		if err != nil || after.Status != "unknown" || after.HelmRevision == nil || *after.HelmRevision != 1 || f.c.f.pool.QueryRow(ctx, "SELECT uid FROM deployment_resources WHERE deployment_id=$1 AND kind='Job'", row.ID).Scan(&remembered) != nil || remembered != string(object.GetUID()) || proxy.writes.Load() != writes {
			t.Fatal("first observation did not persist the original workload UID without resubmission")
		}
		replacement := recoveryReplaceJob(t, client, object)
		for range 2 {
			releasePoll(t, f, row.ID)
			if !startRecoveryChild(t, f.c.f.dsn, "release", build.Settings{}).wait(t, false) {
				t.Fatal("partial release UID conflict not observed")
			}
			final, err := q.GetDeployment(ctx, row.ID)
			if err != nil || final.Status != "unknown" || final.ErrorCode == nil || *final.ErrorCode != "release_resource_identity_conflict" || final.HelmRevision == nil || *final.HelmRevision != 1 || f.c.f.pool.QueryRow(ctx, "SELECT uid FROM deployment_resources WHERE deployment_id=$1 AND kind='Job'", row.ID).Scan(&remembered) != nil || remembered != string(object.GetUID()) || proxy.writes.Load() != writes {
				t.Fatal("recovery adopted replacement UID or repeated Helm writes")
			}
		}
		var active string
		var fencing int64
		if f.c.f.pool.QueryRow(ctx, "SELECT active_deployment_id::text,fencing_token FROM deployment_targets WHERE id=$1", row.TargetID).Scan(&active, &fencing) != nil || active != row.ID || fencing != row.FencingToken {
			t.Fatal("UID conflict released the original target hold")
		}
		releaseState(t, f, *second.DeploymentID, "queued")
		startRecoveryChild(t, f.c.f.dsn, "release", build.Settings{}).wait(t, false)
		releaseState(t, f, *second.DeploymentID, "queued")
		var current unstructured.Unstructured
		if client.Get(ctx, storagePath+"/"+storage.GetName(), nil, &current) != nil || current.GetUID() != storage.GetUID() || current.GetResourceVersion() != storage.GetResourceVersion() || proxy.writes.Load() != writes {
			t.Fatal("partial recovery changed Helm storage or submitted the queued release")
		}
		var pointer *string
		if f.c.f.pool.QueryRow(ctx, "SELECT current_deployment_id::text FROM app_environment_bindings WHERE id=$1", f.binding).Scan(&pointer) != nil || pointer != nil {
			t.Fatal("partial recovery advanced the success pointer")
		}
		for _, table := range []string{"release_requests", "release_snapshots", "deployments"} {
			var count int
			if f.c.f.pool.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&count) != nil || count != 2 {
				t.Fatal("partial recovery duplicated release history")
			}
		}
		result["deploymentId"], result["queuedDeploymentId"], result["originalJobUid"], result["replacementJobUid"], result["helmStorageUid"] = row.ID, *second.DeploymentID, string(object.GetUID()), string(replacement.GetUID()), string(storage.GetUID())
		result["status"], result["errorCode"], result["helmRevision"], result["fencingToken"], result["externalWrites"], result["externalCreates"] = "unknown", "release_resource_identity_conflict", 1, fencing, writes, proxy.posts.Load()
		result["faultInjectorWrites"] = 2
		result["originalUidPersistedBeforeReplacement"], result["originalUidPreserved"], result["uidConflictRepeated"], result["queuedTargetBlocked"], result["helmStorageUnchanged"], result["currentDeploymentUnchanged"], result["secondProcessBlocked"], result["originalLeaseExpiredNaturally"] = true, true, true, true, true, true, true, true
	})
	if t.Failed() {
		return
	}
	evidence["finishedAt"] = time.Now().UTC()
	if path := os.Getenv("PODRY_TEST_RECOVERY_EVIDENCE"); path != "" {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatal("recovery evidence must be a new file")
		}
		raw, _ := json.MarshalIndent(evidence, "", "  ")
		if os.WriteFile(path+".tmp", append(raw, '\n'), 0600) != nil || os.Rename(path+".tmp", path) != nil {
			t.Fatal("workload recovery evidence publication failed")
		}
	}
}
