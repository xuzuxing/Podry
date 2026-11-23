package integration_test

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/chart"
	"github.com/xuzuxing/podry/internal/cleanup"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/kubernetes"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/release"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// This opt-in test writes only in a freshly created namespace and a disposable
// PostgreSQL database. Business execution/retention records are controlled seeds;
// Jobs, Pods, logs, garbage collection and all cleanup-worker I/O are real.
// It does not claim CI execution, Helm submission or seven days of wall time.
func TestResourceCleanupLive(t *testing.T) {
	if os.Getenv("PODRY_TEST_CLEANUP_LIVE") != "1" {
		t.Skip("PODRY_TEST_CLEANUP_LIVE=1 is required for cluster writes")
	}
	var payload map[string]any
	if json.Unmarshal([]byte(os.Getenv("PODRY_TEST_KUBE_PAYLOAD")), &payload) != nil {
		t.Fatal("PODRY_TEST_KUBE_PAYLOAD is required")
	}
	image := os.Getenv("PODRY_TEST_CLEANUP_IMAGE")
	if !regexp.MustCompile(`^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$`).MatchString(image) {
		t.Fatal("PODRY_TEST_CLEANUP_IMAGE must be a pinned, anonymous finite Job image")
	}
	// setupRelease always creates/migrates a fresh random database. Never use an
	// existing application's records or enable the global cleanup scheduler.
	f := setupRelease(t, "Job")
	ctx := context.Background()
	client, err := kubernetes.New(payload)
	if err != nil {
		t.Fatal("live cluster configuration rejected")
	}
	defer client.Close()
	runID := uuid.NewString()
	ns := "podry-cleanup-live-" + runID[:8]
	core := "/api/v1/namespaces/" + ns
	jobs := "/apis/batch/v1/namespaces/" + ns + "/jobs"
	apps := "/apis/apps/v1/namespaces/" + ns
	write := func(method, path string, obj any) unstructured.Unstructured {
		t.Helper()
		var out unstructured.Unstructured
		if err := client.Write(ctx, method, path, obj, &out); err != nil {
			t.Fatal("live fixture write failed at " + path)
		}
		return out
	}
	get := func(path string) unstructured.Unstructured {
		t.Helper()
		var out unstructured.Unstructured
		if err := client.Get(ctx, path, nil, &out); err != nil {
			t.Fatal("live fixture read failed at " + path)
		}
		return out
	}
	missing := func(path string) bool {
		t.Helper()
		var out unstructured.Unstructured
		err := client.Get(ctx, path, nil, &out)
		if err != nil && !kubernetes.IsMissing(err) {
			t.Fatal("live absence check failed")
		}
		return kubernetes.IsMissing(err)
	}
	seed := func(query string, args ...any) {
		t.Helper()
		if _, err := f.c.f.pool.Exec(ctx, query, args...); err != nil {
			t.Fatal("isolated cleanup record setup failed: " + err.Error())
		}
	}
	wait := func(name string, check func() bool) {
		t.Helper()
		deadline := time.Now().Add(120 * time.Second)
		for time.Now().Before(deadline) {
			if check() {
				return
			}
			time.Sleep(time.Second)
		}
		t.Fatal("timed out: " + name + "; retain namespace " + ns + " for inspection")
	}
	identity := func(o unstructured.Unstructured) map[string]any {
		return map[string]any{"kind": o.GetKind(), "name": o.GetName(), "uid": string(o.GetUID())}
	}
	namespace := write("POST", "/api/v1/namespaces", map[string]any{"apiVersion": "v1", "kind": "Namespace", "metadata": map[string]any{"name": ns, "labels": map[string]any{"podry.io/cleanup-live-run": runID}}})
	t.Log("isolated cleanup namespace:", ns)
	var finalEvidence map[string]any
	// Conditional namespace deletion is the last action, only after acceptance
	// succeeds. On failure leave exact resources/finalizers for inspection.
	t.Cleanup(func() {
		if t.Failed() {
			t.Log("retained failed acceptance namespace:", ns)
			return
		}
		c, err := kubernetes.New(payload)
		if err != nil {
			t.Error("could not reopen namespace cleanup client")
			return
		}
		defer c.Close()
		var current unstructured.Unstructured
		path := "/api/v1/namespaces/" + ns
		if err := c.Get(ctx, path, nil, &current); err != nil || current.GetUID() != namespace.GetUID() {
			t.Error("namespace identity changed; retained")
			return
		}
		_, _, err = c.ResourceWrite(ctx, "DELETE", path, map[string]any{"apiVersion": "v1", "kind": "DeleteOptions", "preconditions": map[string]any{"uid": string(current.GetUID()), "resourceVersion": current.GetResourceVersion()}}, false)
		if err != nil {
			t.Error("conditional namespace deletion failed")
			return
		}
		removed := false
		deadline := time.Now().Add(60 * time.Second)
		for time.Now().Before(deadline) {
			var after unstructured.Unstructured
			if err := c.Get(ctx, path, nil, &after); kubernetes.IsMissing(err) {
				removed = true
				break
			} else if err != nil || after.GetUID() != namespace.GetUID() {
				t.Error("namespace deletion could not be confirmed")
				return
			}
			time.Sleep(time.Second)
		}
		if !removed {
			t.Error("namespace deletion timed out; retained for inspection")
			return
		}
		finalEvidence["namespaceRemoved"] = true
		finalEvidence["finishedAt"] = time.Now().UTC()
		if output := os.Getenv("PODRY_TEST_CLEANUP_EVIDENCE"); output != "" {
			raw, _ := json.MarshalIndent(finalEvidence, "", "  ")
			if os.WriteFile(output+".tmp", append(raw, '\n'), 0600) != nil || os.Rename(output+".tmp", output) != nil {
				t.Error("public evidence write failed")
			}
		}
	})
	cred := decode[platform.Credential](t, f.c.f.call("POST", "/api/credentials", f.c.admin, map[string]any{"name": "Cleanup live cluster", "kind": "kubeconfig", "teamId": nil, "payload": payload}, 201))
	cluster := decode[platform.Cluster](t, f.c.f.call("POST", "/api/clusters", f.c.admin, map[string]any{"name": "Cleanup live cluster", "apiServer": payload["apiServer"], "credentialId": cred.ID}, 201))
	seed("UPDATE deployment_targets SET cluster_id=$2,namespace=$3 WHERE id=(SELECT target_id FROM app_environment_bindings WHERE id=$1)", f.binding, cluster.ID, ns)
	seed("UPDATE resource_grants SET cluster_id=$2,namespace=$3 WHERE id=$1", f.grant, cluster.ID, ns)
	slash := strings.LastIndex(image, "@sha256:")
	f.c.f.call("PUT", "/api/apps/"+f.app+"/config", f.c.developer, map[string]any{"expectedVersion": 3, "section": "base", "chartConfig": map[string]any{"workloadKind": "Job", "chartVersion": "1.2.0"}, "deployValues": map[string]any{"job": map[string]any{"backoffLimit": 0, "activeDeadlineSeconds": 120}}, "secretRefs": []any{map[string]any{"credentialId": f.secret, "version": 1, "targetKey": "DATABASE_URL"}}}, 200)
	vault, _ := credential.New(testCredentialKey)
	dataDir := t.TempDir()
	builds := build.New(f.c.f.pool, vault, build.Settings{DataDir: dataDir})
	worker := cleanup.New(f.c.f.pool, builds, release.New(f.c.f.pool, vault, release.Settings{}, release.NewHelm()), cleanupSettings())
	q := sqlcdb.New(f.c.f.pool)
	evidence := map[string]any{"schemaVersion": 1, "runId": runID, "namespace": ns, "namespaceUid": string(namespace.GetUID()), "imageRef": image, "startedAt": time.Now().UTC(), "scope": "real K3s cleanup worker with isolated seeded execution records and accelerated retention; no CI or Helm submission"}
	finalEvidence = evidence
	counts := func() map[string]int {
		t.Helper()
		out := map[string]int{}
		for _, table := range []string{"builds", "build_attempts", "artifacts", "release_requests", "release_snapshots", "deployments", "deployment_resources"} {
			var n int
			if err := f.c.f.pool.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&n); err != nil {
				t.Fatal("history count failed")
			}
			out[table] = n
		}
		return out
	}

	// A real completed Job carries the frozen build identity. Its business
	// execution is seeded, and its actual Pod log is the archive input.
	var originalBuildID string
	if err := f.c.f.pool.QueryRow(ctx, "SELECT build_id FROM artifacts WHERE id=$1", f.artifact).Scan(&originalBuildID); err != nil {
		t.Fatal(err)
	}
	originalBuild, err := q.GetBuild(ctx, originalBuildID)
	if err != nil {
		t.Fatal(err)
	}
	buildID := uuid.NewString()
	seed("INSERT INTO builds(id,app_id,pipeline_id,config_version,commit_sha,status,requested_by) VALUES($1,$2,$3,$4,$5,'succeeded',$6)", buildID, f.app, originalBuild.PipelineID, originalBuild.ConfigVersion, originalBuild.CommitSha, f.c.dev.ID)
	attemptID := uuid.NewString()
	spec := build.ExecutionSpec{Version: 1, BuildID: buildID, AttemptID: attemptID, AppID: f.app, RequestedBy: f.c.dev.ID, ClusterID: cluster.ID, APIServer: payload["apiServer"].(string), ClusterCredential: build.CredentialRef{ID: cred.ID, Version: 1}, Namespace: ns, JobName: "podry-build-" + attemptID, CommitSHA: strings.Repeat("a", 40), RunnerImage: image, Platform: "linux/amd64", TimeoutSeconds: 120}
	annotations := map[string]any{"podry.io/attempt-id": attemptID, "podry.io/execution-hash": build.Hash(spec)}
	buildJob := write("POST", jobs, map[string]any{"apiVersion": "batch/v1", "kind": "Job", "metadata": map[string]any{"name": spec.JobName, "namespace": ns, "annotations": annotations, "finalizers": []any{"podry.io/cleanup-live-hold"}}, "spec": map[string]any{"backoffLimit": 0, "activeDeadlineSeconds": 120, "template": map[string]any{"spec": map[string]any{"restartPolicy": "Never", "automountServiceAccountToken": false, "containers": []any{map[string]any{"name": "build", "image": image}}}}}})
	buildPath := jobs + "/" + spec.JobName
	wait("build fixture Job completion", func() bool { j := get(buildPath); return kubernetes.CleanupJobExited(&j, false) })
	for _, kind := range []string{"Secret", "ConfigMap"} {
		plural, suffix := "secrets", "-auth"
		if kind == "ConfigMap" {
			plural, suffix = "configmaps", "-spec"
		}
		write("POST", core+"/"+plural, map[string]any{"apiVersion": "v1", "kind": kind, "metadata": map[string]any{"name": spec.JobName + suffix, "namespace": ns, "annotations": annotations, "ownerReferences": []any{map[string]any{"apiVersion": "batch/v1", "kind": "Job", "name": spec.JobName, "uid": string(buildJob.GetUID()), "controller": true, "blockOwnerDeletion": false}}}})
	}
	rawSpec, _ := json.Marshal(spec)
	seed("INSERT INTO build_attempts(id,build_id,attempt_no,status,build_cluster_id,namespace,job_name,job_uid,execution_spec,execution_hash,stage,finished_at,log_availability) VALUES($1,$2,1,'succeeded',$3,$4,$5,$6,$7,$8,'finished',clock_timestamp()-interval '2 days','runtime')", attemptID, buildID, cluster.ID, ns, spec.JobName, string(buildJob.GetUID()), rawSpec, build.Hash(spec))
	f.artifact = uuid.NewString()
	seed("INSERT INTO artifacts(id,app_id,build_id,attempt_id,image_repository,digest) VALUES($1,$2,$3,$4,$5,$6)", f.artifact, f.app, buildID, attemptID, image[:slash], image[slash+1:])
	seed("UPDATE builds SET artifact_id=$2 WHERE id=$1", buildID, f.artifact)
	beforeBuild := counts()
	cleanupBuildStep(t, worker, true)
	attemptKey := sqlcdb.GetBuildAttemptParams{BuildID: buildID, AttemptNo: 1}
	attempt, err := q.GetBuildAttempt(ctx, attemptKey)
	unarchivedJob := get(buildPath)
	if err != nil || attempt.CleanupErrorCode == nil || *attempt.CleanupErrorCode != "cleanup_logs_unarchived" || attempt.ResourcesCleanedAt != nil || unarchivedJob.GetDeletionTimestamp() != nil {
		t.Fatal("unarchived build cleanup was not blocked")
	}
	if attempt.CleanupAttempts != 1 || time.Until(attempt.NextCleanupAt) < 4*time.Minute {
		t.Fatal("build deferral retry was not persisted")
	}
	pods, err := client.CleanupJobPods(ctx, ns, string(buildJob.GetUID()))
	if err != nil || len(pods) != 1 {
		t.Fatal("completed build Pod identity unavailable")
	}
	stream, err := client.Open(ctx, core+"/pods/"+pods[0].GetName()+"/log", nil)
	if err != nil {
		t.Fatal("build fixture log unavailable")
	}
	actualLog, err := io.ReadAll(io.LimitReader(stream, 65537))
	stream.Close()
	if err != nil || len(actualLog) == 0 || len(actualLog) > 65536 {
		t.Fatal("build fixture log budget/availability failed")
	}
	archive, _ := json.Marshal(build.LogLine{Phase: "build", Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Message: strings.TrimSpace(string(actualLog))})
	archive = append(archive, '\n')
	key := "logs/builds/" + attemptID + ".ndjson"
	if os.MkdirAll(filepath.Join(dataDir, "logs", "builds"), 0700) != nil || os.WriteFile(filepath.Join(dataDir, filepath.FromSlash(key)), archive, 0600) != nil {
		t.Fatal("archive write failed")
	}
	seed("INSERT INTO log_archives(id,build_attempt_id,storage_key,byte_size,sha256,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '5 days')", uuid.NewString(), attemptID, key, len(archive), chart.Hash(archive))
	seed("UPDATE build_attempts SET log_availability='archived',next_cleanup_at=clock_timestamp()-interval '1 second' WHERE id=$1", attemptID)
	cleanupBuildStep(t, worker, true)
	attempt, err = q.GetBuildAttempt(ctx, attemptKey)
	if err != nil || attempt.CleanupErrorCode == nil || *attempt.CleanupErrorCode != "cleanup_deletion_unconfirmed" || attempt.ResourcesCleanedAt != nil {
		t.Fatal("held Job deletion was treated as complete")
	}
	held := get(buildPath)
	if held.GetUID() != buildJob.GetUID() || held.GetDeletionTimestamp() == nil {
		t.Fatal("held Job identity/deletion evidence changed")
	}
	finalizers := []string{}
	for _, value := range held.GetFinalizers() {
		if value != "podry.io/cleanup-live-hold" {
			finalizers = append(finalizers, value)
		}
	}
	write("PATCH", buildPath, map[string]any{"metadata": map[string]any{"uid": string(held.GetUID()), "resourceVersion": held.GetResourceVersion(), "finalizers": finalizers}})
	wait("build foreground collection", func() bool { return missing(buildPath) })
	seed("UPDATE build_attempts SET next_cleanup_at=clock_timestamp()-interval '1 second' WHERE id=$1", attemptID)
	cleanupBuildStep(t, worker, true)
	attempt, err = q.GetBuildAttempt(ctx, attemptKey)
	if err != nil || attempt.ResourcesCleanedAt == nil || attempt.CleanupErrorCode != nil {
		t.Fatal("build cleanup did not finish after finalizer release")
	}
	for _, path := range []string{buildPath, core + "/secrets/" + spec.JobName + "-auth", core + "/configmaps/" + spec.JobName + "-spec"} {
		if !missing(path) {
			t.Fatal("owned build resource remains")
		}
	}
	remaining, err := client.CleanupJobPods(ctx, ns, string(buildJob.GetUID()))
	lines, logErr := builds.ReadLogs(ctx, attempt)
	if err != nil || len(remaining) != 0 || logErr != nil || len(lines) != 1 || lines[0].Message != strings.TrimSpace(string(actualLog)) {
		t.Fatal("collected build lost archive or left Pods")
	}
	if build.Hash(beforeBuild) != build.Hash(counts()) {
		t.Fatal("build business history changed")
	}
	evidence["build"] = map[string]any{"attemptId": attemptID, "job": identity(buildJob), "pod": identity(pods[0]), "archiveSha256": chart.Hash(archive), "unarchivedBlocked": true, "finalizerBlocked": true, "cleanupAttempts": attempt.CleanupAttempts, "resourcesAbsent": true, "archiveReadableAfterCleanup": true, "historyCounts": beforeBuild}
	t.Log("build cleanup: archive gate, finalizer deferral, foreground collection and retained logs passed")

	// Freeze two independent real manifests through public preview/confirm, but
	// seed their success/current pointers from completed Jobs instead of Helm.
	f.apps.UseReleases(releaseReady{})
	createRelease := func(key string) (release.Plan, []unstructured.Unstructured) {
		t.Helper()
		r := decode[application.ReleaseRequest](t, f.confirm(t, f.preview(t, 4), key, 202))
		d, err := q.GetDeployment(ctx, *r.DeploymentID)
		if err != nil {
			t.Fatal(err)
		}
		snapshot, err := q.GetReleaseSnapshot(ctx, d.SnapshotID)
		if err != nil {
			t.Fatal(err)
		}
		plan, err := release.Decode(snapshot.Snapshot, snapshot.SnapshotSha256)
		if err != nil {
			t.Fatal("fixture snapshot integrity failed")
		}
		objects := []unstructured.Unstructured{}
		for _, o := range manifestObjects(t, plan.Chart.Manifest) {
			created := write("POST", resourceURL(o)[:strings.LastIndex(resourceURL(o), "/")], o)
			objects = append(objects, created)
			seed("INSERT INTO deployment_resources(deployment_id,api_version,kind,namespace,name,uid) VALUES($1,$2,$3,$4,$5,$6)", d.ID, created.GetAPIVersion(), created.GetKind(), ns, created.GetName(), string(created.GetUID()))
		}
		for _, o := range objects {
			if o.GetKind() == "Job" {
				wait("release fixture Job completion", func() bool { j := get(jobs + "/" + o.GetName()); return kubernetes.CleanupJobExited(&j, false) })
			}
		}
		seed("UPDATE deployments SET status='succeeded',finished_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL WHERE id=$1", d.ID)
		seed("UPDATE deployment_targets SET active_deployment_id=NULL WHERE id=$1", d.TargetID)
		seed("UPDATE app_environment_bindings SET current_deployment_id=$2 WHERE id=$1", f.binding, d.ID)
		return plan, objects
	}
	old, oldObjects := createRelease("cleanup-live-old")
	seed("UPDATE deployments SET finished_at=clock_timestamp()-interval '8 days' WHERE id=$1", old.DeploymentID)
	cleanupReleaseStep(t, worker, false) // Current release cannot become a candidate.
	current, currentObjects := createRelease("cleanup-live-current")
	var oldSecret unstructured.Unstructured
	for _, o := range oldObjects {
		if o.GetKind() == "Secret" {
			oldSecret = o
		}
	}
	if oldSecret.GetUID() == "" {
		t.Fatal("version Secret fixture missing")
	}
	holder := write("POST", apps+"/replicasets", map[string]any{"apiVersion": "apps/v1", "kind": "ReplicaSet", "metadata": map[string]any{"name": "retained-secret-consumer", "namespace": ns}, "spec": map[string]any{"replicas": 0, "selector": map[string]any{"matchLabels": map[string]any{"cleanup-consumer": runID}}, "template": map[string]any{"metadata": map[string]any{"labels": map[string]any{"cleanup-consumer": runID}}, "spec": map[string]any{"automountServiceAccountToken": false, "containers": []any{map[string]any{"name": "app", "image": image, "envFrom": []any{map[string]any{"secretRef": map[string]any{"name": oldSecret.GetName()}}}}}}}}})
	// Sentinels exercise preservation, without representing a real Helm release.
	sentinels := []unstructured.Unstructured{
		write("POST", core+"/secrets", map[string]any{"apiVersion": "v1", "kind": "Secret", "metadata": map[string]any{"name": "helm-storage-sentinel", "namespace": ns, "labels": map[string]any{"owner": "helm"}}, "type": "helm.sh/release.v1"}),
		write("POST", core+"/configmaps", map[string]any{"apiVersion": "v1", "kind": "ConfigMap", "metadata": map[string]any{"name": "borrowed-settings", "namespace": ns}, "data": map[string]any{"mode": "cleanup-acceptance"}}),
	}
	beforeRelease := counts()
	wait("old Job collection and referenced Secret deferral", func() bool {
		seed("UPDATE deployments SET next_cleanup_at=clock_timestamp()-interval '1 second' WHERE id=$1", old.DeploymentID)
		cleanupReleaseStep(t, worker, true)
		d, err := q.GetDeployment(ctx, old.DeploymentID)
		if err != nil || d.ResourcesCleanedAt != nil {
			t.Fatal("referenced release resources were marked clean")
		}
		return d.CleanupErrorCode != nil && *d.CleanupErrorCode == "cleanup_resource_referenced"
	})
	if secret := get(core + "/secrets/" + oldSecret.GetName()); secret.GetUID() != oldSecret.GetUID() || secret.GetDeletionTimestamp() != nil {
		t.Fatal("zero-replica consumer did not protect exact old Secret")
	}
	remove := func(path string, expected unstructured.Unstructured) {
		t.Helper()
		o := get(path)
		if o.GetUID() != expected.GetUID() {
			t.Fatal("test fixture replacement detected; refusing removal")
		}
		if err := client.DeleteCollected(ctx, path, &o); err != nil {
			// Foreground deletion is normally asynchronous on a real API server.
			var after unstructured.Unstructured
			if getErr := client.Get(ctx, path, nil, &after); !kubernetes.IsMissing(getErr) && (getErr != nil || after.GetUID() != expected.GetUID() || after.GetDeletionTimestamp() == nil) {
				t.Fatal("conditional fixture removal failed")
			}
		}
		wait("conditional fixture removal", func() bool { return missing(path) })
	}
	remove(apps+"/replicasets/"+holder.GetName(), holder)
	wait("obsolete release cleanup", func() bool {
		seed("UPDATE deployments SET next_cleanup_at=clock_timestamp()-interval '1 second' WHERE id=$1", old.DeploymentID)
		cleanupReleaseStep(t, worker, true)
		d, err := q.GetDeployment(ctx, old.DeploymentID)
		return err == nil && d.ResourcesCleanedAt != nil && d.CleanupErrorCode == nil
	})
	for _, o := range oldObjects {
		if !missing(resourceURL(o.Object)) {
			t.Fatal("obsolete resource remains")
		}
	}
	for _, o := range append(currentObjects, sentinels...) {
		if actual := get(resourceURL(o.Object)); actual.GetUID() != o.GetUID() || actual.GetDeletionTimestamp() != nil {
			t.Fatal("current or borrowed resource identity changed")
		}
	}
	if build.Hash(beforeRelease) != build.Hash(counts()) {
		t.Fatal("release business history changed")
	}
	binding, err := q.GetReleaseBinding(ctx, sqlcdb.GetReleaseBindingParams{ID: f.binding, AppID: f.app})
	if err != nil || binding.CurrentDeploymentID == nil || *binding.CurrentDeploymentID != current.DeploymentID {
		t.Fatal("current deployment pointer changed")
	}
	cleanupReleaseStep(t, worker, false)
	cleanupBuildStep(t, worker, false)
	var succeeded, deferred int
	if err := f.c.f.pool.QueryRow(ctx, "SELECT count(*) FILTER(WHERE result='succeeded'),count(*) FILTER(WHERE result='unknown') FROM audit_events WHERE action IN ('build.resources.cleanup','deployment.resources.cleanup')").Scan(&succeeded, &deferred); err != nil || succeeded != 2 || deferred < 3 {
		t.Fatal("cleanup success/deferral audit evidence missing")
	}
	evidence["release"] = map[string]any{"obsoleteDeploymentId": old.DeploymentID, "currentDeploymentId": current.DeploymentID, "oldSecret": identity(oldSecret), "zeroReplicaConsumer": identity(holder), "currentProtected": true, "referenceProtected": true, "obsoleteResourcesAbsent": true, "currentResources": []any{identity(currentObjects[0]), identity(currentObjects[1])}, "helmStorageSentinelPreserved": true, "borrowedConfigMapPreserved": true, "historyCounts": beforeRelease}
	evidence["audits"] = map[string]any{"succeeded": succeeded, "deferred": deferred}
	evidence["result"], evidence["finishedAt"] = "passed", time.Now().UTC()
	t.Log("release cleanup: current protection, zero-replica Secret reference, old Job/Secret collection, history and audits passed")
}
