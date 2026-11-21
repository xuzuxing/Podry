package integration_test

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/release"
)

func autoEnvironment(t *testing.T, c *controlFixture) string {
	t.Helper()
	e := decode[platform.Environment](t, c.f.call("POST", "/api/environments", c.admin, map[string]any{"name": "Automatic development", "production": false, "autoDeployAllowed": true}, 201))
	if !e.AutoDeployAllowed || e.Production {
		t.Fatal(e)
	}
	return e.ID
}

func autoWorkflow(t *testing.T, f *releaseFixture, token string, enabled bool) {
	t.Helper()
	w := decode[application.Workflow](t, f.c.f.call("GET", "/api/apps/"+f.app+"/pipelines", token, nil, 200))
	var ci string
	for _, p := range w.Items {
		if p.Kind == "ci" {
			ci = p.ID
		}
	}
	items := []map[string]any{}
	for _, p := range w.Items {
		if p.BindingID != nil && *p.BindingID == f.binding {
			p.Enabled = enabled
			p.Definition = map[string]any{"triggerMode": "on_ci_success", "upstreamPipelineId": ci, "deployTimeoutSeconds": 600}
		}
		items = append(items, map[string]any{"id": p.ID, "kind": p.Kind, "bindingId": p.BindingID, "enabled": p.Enabled, "definition": p.Definition})
	}
	f.c.f.call("PUT", "/api/apps/"+f.app+"/pipelines", token, map[string]any{"expectedVersion": w.Version, "items": items}, 200)
}

func setupAutoDeploy(t *testing.T) *releaseFixture {
	t.Helper()
	f := setupRelease(t, "Deployment")
	c := f.c
	w := decode[application.Workflow](t, c.f.call("GET", "/api/apps/"+f.app+"/pipelines", c.developer, nil, 200))
	out := decode[application.TemplateResult](t, c.f.keyed("POST", "/api/apps/"+f.app+"/workflow-templates", c.developer, "automatic-template-key", map[string]any{"template": "add_deploy", "expectedConfigVersion": 3, "expectedWorkflowVersion": w.Version, "deployment": map[string]any{"binding": map[string]any{"environmentId": autoEnvironment(t, c), "target": map[string]any{"clusterId": c.clusterID, "namespace": "demo", "releaseName": "automatic-demo"}, "overrideValues": map[string]any{"env": map[string]any{"MODE": "auto"}}, "autoDeploy": true}, "definition": map[string]any{"triggerMode": "on_ci_success", "upstreamPipelineId": nil, "deployTimeoutSeconds": 600}}}, 201))
	for _, b := range out.Bindings {
		if b.ID != f.binding {
			f.binding = b.ID
			break
		}
	}
	f.apps.UseReleases(releaseReady{})
	return f
}

// Deliberately starts without an artifact, exercising the durable handoff
// independently from the separately tested Kubernetes build runner.
func autoBuild(t *testing.T, f *releaseFixture, ready bool) string {
	t.Helper()
	id := uuid.NewString()
	_, err := f.c.f.pool.Exec(context.Background(), `INSERT INTO builds(id,app_id,pipeline_id,config_version,commit_sha,requested_by)
 SELECT $1,$2,id,3,$3,$4 FROM pipelines WHERE app_id=$2 AND kind='ci'`, id, f.app, strings.Repeat("c", 40), f.c.dev.ID)
	if err != nil {
		t.Fatal(err)
	}
	if ready {
		completeAutoBuild(t, f, id)
	}
	return id
}

func completeAutoBuild(t *testing.T, f *releaseFixture, id string) {
	t.Helper()
	ctx := context.Background()
	attempt, artifact := uuid.NewString(), uuid.NewString()
	for _, s := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO build_attempts(id,build_id,attempt_no,status,build_cluster_id,namespace,job_name,execution_spec,execution_hash,stage)
 VALUES($1,$2,1,'succeeded',$3,'fixture',$4,'{}',$5,'finished')`, []any{attempt, id, f.c.clusterID, "auto-" + attempt, strings.Repeat("d", 64)}},
		{`INSERT INTO artifacts(id,app_id,build_id,attempt_id,image_repository,digest) VALUES($1,$2,$3,$4,'registry.example.test/team/demo',$5)`, []any{artifact, f.app, id, attempt, "sha256:" + strings.Repeat("e", 64)}},
		{`UPDATE builds SET status='succeeded',artifact_id=$2 WHERE id=$1`, []any{id, artifact}},
	} {
		if _, err := f.c.f.pool.Exec(ctx, s.sql, s.args...); err != nil {
			t.Fatal(err)
		}
	}
}

func autoStep(t *testing.T, s *application.Service, want bool) {
	t.Helper()
	got, err := s.ProcessAutoDeployOne(context.Background())
	if err != nil || got != want {
		t.Fatal("auto step", got, want, err)
	}
}
func autoState(t *testing.T, f *releaseFixture, id, status string) build.AutoDeployment {
	t.Helper()
	b := decode[build.Build](t, f.c.f.call("GET", "/api/builds/"+id, f.c.admin, nil, 200))
	if len(b.AutoDeployments) != 1 || b.AutoDeployments[0].Status != status {
		t.Fatalf("automatic state: %+v", b.AutoDeployments)
	}
	return b.AutoDeployments[0]
}
func autoPoll(t *testing.T, f *releaseFixture) {
	t.Helper()
	if _, err := f.c.f.pool.Exec(context.Background(), "UPDATE auto_deploy_intents SET next_poll_at=now()-interval '1 second' WHERE status IN ('waiting','blocked')"); err != nil {
		t.Fatal(err)
	}
}

func TestAutoDeployDurableWaitingDisabledRecoveryAndFrozenSnapshot(t *testing.T) {
	f := setupAutoDeploy(t)
	id := autoBuild(t, f, false)
	autoStep(t, f.apps, false)
	autoState(t, f, id, "waiting")
	completeAutoBuild(t, f, id)
	f.apps.UseReleases(nil)
	autoStep(t, f.apps, true)
	blocked := autoState(t, f, id, "blocked")
	if blocked.ErrorCode == nil || *blocked.ErrorCode != "deployment_execution_unavailable" || blocked.RequestID != nil {
		t.Fatal(blocked)
	}
	var n int
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM deployment_previews").Scan(&n); err != nil || n != 0 {
		t.Fatal("blocked intent created previews", n, err)
	}
	// Service reconstruction loses no intent and needs no incoming HTTP retry.
	vault, _ := credential.New(testCredentialKey)
	rebuilt := application.New(f.c.f.pool, vault, nil, testJWT).UseReleases(releaseReady{})
	autoPoll(t, f)
	autoStep(t, rebuilt, true)
	state := autoState(t, f, id, "dispatched")
	if state.RequestID == nil {
		t.Fatal(state)
	}
	r := decode[application.ReleaseRequest](t, f.c.f.call("GET", "/api/release-requests/"+*state.RequestID, f.c.admin, nil, 200))
	p := actionSnapshot(t, f, r)
	if p.ConfigVersion != 3 || p.BindingID != f.binding || bm(p.Chart.Values["env"])["MODE"] != "auto" || p.ImageRef != "registry.example.test/team/demo@sha256:"+strings.Repeat("e", 64) || p.SecretRefs[0].Version != 1 {
		t.Fatal(p)
	}
	autoStep(t, rebuilt, false)
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM release_requests").Scan(&n); err != nil || n != 1 {
		t.Fatal(n, err)
	}
}

func TestAutoDeployConcurrentDispatchAndAtomicRollback(t *testing.T) {
	f := setupAutoDeploy(t)
	id := autoBuild(t, f, true)
	ctx := context.Background()
	if _, err := f.c.f.pool.Exec(ctx, `CREATE FUNCTION reject_auto_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.action='deployment.auto.dispatched' THEN RAISE EXCEPTION 'fixture unavailable'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER reject_auto_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_auto_audit()`); err != nil {
		t.Fatal(err)
	}
	autoStep(t, f.apps, true)
	autoState(t, f, id, "blocked")
	var n int
	if err := f.c.f.pool.QueryRow(ctx, "SELECT (SELECT count(*) FROM deployment_previews)+(SELECT count(*) FROM release_snapshots)+(SELECT count(*) FROM release_requests)+(SELECT count(*) FROM deployments)").Scan(&n); err != nil || n != 0 {
		t.Fatal("partial transaction escaped", n, err)
	}
	if _, err := f.c.f.pool.Exec(ctx, "DROP TRIGGER reject_auto_audit ON audit_events"); err != nil {
		t.Fatal(err)
	}
	autoPoll(t, f)
	var wg sync.WaitGroup
	for range 5 {
		wg.Go(func() {
			if _, err := f.apps.ProcessAutoDeployOne(ctx); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	autoState(t, f, id, "dispatched")
	if err := f.c.f.pool.QueryRow(ctx, "SELECT count(*) FROM release_requests").Scan(&n); err != nil || n != 1 {
		t.Fatal("duplicate request", n, err)
	}
}

func TestAutoDeployPolicyVersionAndAuthorizationRevocation(t *testing.T) {
	for _, change := range []string{"workflow", "binding", "config", "grant", "disabled", "membership", "cd-disabled", "environment"} {
		t.Run(change, func(t *testing.T) {
			f := setupAutoDeploy(t)
			id := autoBuild(t, f, true)
			c := f.c
			switch change {
			case "workflow":
				autoWorkflow(t, f, c.developer, true)
			case "binding":
				c.f.call("PUT", "/api/apps/"+f.app+"/environments/"+f.binding, c.developer, map[string]any{"expectedVersion": 1, "overrideValues": map[string]any{}, "autoDeploy": false}, 200)
			case "config":
				c.f.call("PUT", "/api/apps/"+f.app+"/config", c.developer, map[string]any{"expectedVersion": 3, "section": "base", "chartConfig": map[string]any{"workloadKind": "Deployment", "chartVersion": "1.0.0"}, "deployValues": map[string]any{}, "secretRefs": []any{}}, 200)
			case "grant":
				c.f.call("DELETE", "/api/clusters/"+c.clusterID+"/resource-grants/"+f.grant, c.admin, nil, 204)
			case "disabled":
				if _, err := c.f.pool.Exec(context.Background(), "UPDATE users SET disabled_at=now() WHERE id=$1", c.dev.ID); err != nil {
					t.Fatal(err)
				}
			case "membership":
				c.f.call("DELETE", "/api/projects/"+c.projectID+"/members/"+c.dev.ID, c.admin, nil, 204)
			case "cd-disabled":
				autoWorkflow(t, f, c.developer, false)
			case "environment":
				if _, err := c.f.pool.Exec(context.Background(), "UPDATE environments SET auto_deploy_allowed=false WHERE id=(SELECT environment_id FROM app_environment_bindings WHERE id=$1)", f.binding); err != nil {
					t.Fatal(err)
				}
			}
			autoStep(t, f.apps, true)
			autoState(t, f, id, "skipped")
			autoStep(t, f.apps, false)
		})
	}
}

func TestAutoDeployNoHistoricalBackfillAndFailedBuildRetry(t *testing.T) {
	f := setupAutoDeploy(t)
	ctx := context.Background()
	var count int
	if err := f.c.f.pool.QueryRow(ctx, "SELECT count(*) FROM auto_deploy_intents").Scan(&count); err != nil || count != 0 {
		t.Fatal("old build backfilled", count, err)
	}
	id := autoBuild(t, f, false)
	if _, err := f.c.f.pool.Exec(ctx, "UPDATE builds SET status='failed' WHERE id=$1", id); err != nil {
		t.Fatal(err)
	}
	autoStep(t, f.apps, false)
	autoState(t, f, id, "waiting")
	// The original immutable delegation survives retry, but enabling a NEW CD
	// after admission never creates an intent for this historical build.
	completeAutoBuild(t, f, id)
	autoStep(t, f.apps, true)
	autoState(t, f, id, "dispatched")
}

func TestAutoDeployTargetBusyAndQueuedPolicyRecheck(t *testing.T) {
	f := setupAutoDeploy(t)
	first := autoBuild(t, f, true)
	autoStep(t, f.apps, true)
	one := autoState(t, f, first, "dispatched")
	second := autoBuild(t, f, true)
	autoStep(t, f.apps, true)
	blocked := autoState(t, f, second, "blocked")
	if blocked.ErrorCode == nil || *blocked.ErrorCode != "target_busy" {
		t.Fatal(blocked)
	}
	var submits atomic.Int32
	worker := releaseWorker(t, f, releaseExecutor{submit: func(context.Context, release.Input) (release.Observation, error) {
		submits.Add(1)
		return release.Observation{State: "succeeded"}, nil
	}})
	// Automatic admission was valid; disable the gate before the executor submits.
	f.c.f.call("PUT", "/api/apps/"+f.app+"/environments/"+f.binding, f.c.developer, map[string]any{"expectedVersion": 1, "overrideValues": map[string]any{}, "autoDeploy": false}, 409)
	autoWorkflow(t, f, f.c.developer, false)
	releaseStep(t, worker)
	r := decode[application.ReleaseRequest](t, f.c.f.call("GET", "/api/release-requests/"+*one.RequestID, f.c.admin, nil, 200))
	releaseState(t, f, *r.DeploymentID, "failed")
	if submits.Load() != 0 {
		t.Fatal("revoked policy reached external executor")
	}
	autoPoll(t, f)
	autoStep(t, f.apps, true)
	autoState(t, f, second, "skipped")
}

func TestAutoDeployExplicitDelegateAndSessionIndependence(t *testing.T) {
	f := setupAutoDeploy(t)
	autoWorkflow(t, f, f.c.admin, true)
	id := autoBuild(t, f, true)
	// Builder has no deploy permission now; explicit delegate remains admin.
	f.c.f.call("DELETE", "/api/projects/"+f.c.projectID+"/members/"+f.c.dev.ID, f.c.admin, nil, 204)
	f.c.f.call("POST", "/api/auth/logout", f.c.admin, nil, 204)
	autoStep(t, f.apps, true)
	var delegated bool
	var status string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT u.email='admin@example.test',i.status FROM auto_deploy_intents i JOIN release_requests r ON r.id=i.request_id JOIN users u ON u.id=r.requested_by WHERE i.build_id=$1", id).Scan(&delegated, &status); err != nil || !delegated || status != "dispatched" {
		t.Fatal(delegated, status, err)
	}
}

func TestAutoDeployMigrationAndProductionPolicy(t *testing.T) {
	c := controlSetup(t)
	downgradeHealthSchedule(t, c.f.dsn)
	if err := database.Migrate(c.f.dsn, true); err != nil {
		t.Fatal("empty v16 downgrade", err)
	}
	if err := database.CheckSchema(context.Background(), c.f.pool); err == nil {
		t.Fatal("old schema accepted")
	}
	if err := database.Migrate(c.f.dsn, false); err != nil {
		t.Fatal(err)
	}
	c.f.call("POST", "/api/environments", c.developer, map[string]any{"name": "Denied auto", "production": false, "autoDeployAllowed": true}, 403)
	c.f.call("POST", "/api/environments", c.admin, map[string]any{"name": "Unsafe production", "production": true, "autoDeployAllowed": true}, 422)
	id := autoEnvironment(t, c)
	if _, err := c.f.pool.Exec(context.Background(), "UPDATE environments SET production=true WHERE id=$1", id); err == nil {
		t.Fatal("database allowed production auto policy")
	}
	downgradeHealthSchedule(t, c.f.dsn)
	if err := database.Migrate(c.f.dsn, true); err == nil {
		t.Fatal("downgrade discarded explicit policy")
	}
}

func TestAutoDeployBuildWorkerAtomicArtifactHandoff(t *testing.T) {
	b := setupBuild(t)
	c := b.c
	c.f.call("PUT", "/api/apps/"+b.app+"/config", c.developer, map[string]any{"expectedVersion": 2, "section": "base", "chartConfig": map[string]any{"workloadKind": "Deployment", "chartVersion": "1.0.0"}, "deployValues": map[string]any{"containerPort": 8080}, "secretRefs": []any{}}, 200)
	c.f.call("POST", "/api/clusters/"+c.clusterID+"/resource-grants", c.admin, map[string]any{"principalType": "project", "principalId": c.projectID, "namespace": "demo", "resources": []string{"*"}, "actions": []string{"resource.write"}}, 201)
	w := decode[application.Workflow](t, c.f.call("GET", "/api/apps/"+b.app+"/pipelines", c.developer, nil, 200))
	c.f.keyed("POST", "/api/apps/"+b.app+"/workflow-templates", c.developer, "auto-build-handoff-template", map[string]any{"template": "add_deploy", "expectedConfigVersion": 3, "expectedWorkflowVersion": w.Version, "deployment": map[string]any{"binding": map[string]any{"environmentId": autoEnvironment(t, c), "target": map[string]any{"clusterId": c.clusterID, "namespace": "demo", "releaseName": "worker-auto"}, "overrideValues": map[string]any{}, "autoDeploy": true}, "definition": map[string]any{"triggerMode": "on_ci_success", "upstreamPipelineId": nil, "deployTimeoutSeconds": 600}}}, 201)
	id := decode[build.Build](t, c.f.keyed("POST", "/api/apps/"+b.app+"/builds", c.developer, "auto-build-handoff-request", application.BuildInput{CommitSHA: b.sha, ExpectedConfigVersion: 3}, 202)).ID
	autoStep(t, b.apps, false)
	for range 3 {
		b.step(t)
	}
	b.kube.complete = true
	b.step(t)
	got := decode[build.Build](t, c.f.call("GET", "/api/builds/"+id, c.developer, nil, 200))
	if got.Status != "succeeded" || got.ArtifactID == nil || len(got.AutoDeployments) != 1 || got.AutoDeployments[0].Status != "waiting" {
		t.Fatal(got)
	}
	b.apps.UseReleases(releaseReady{})
	autoStep(t, b.apps, true)
	got = decode[build.Build](t, c.f.call("GET", "/api/builds/"+id, c.developer, nil, 200))
	if got.AutoDeployments[0].Status != "dispatched" {
		t.Fatal(got)
	}
	var artifact string
	if err := c.f.pool.QueryRow(context.Background(), "SELECT s.artifact_id FROM auto_deploy_intents i JOIN release_requests r ON r.id=i.request_id JOIN release_snapshots s ON s.id=r.snapshot_id WHERE i.build_id=$1", id).Scan(&artifact); err != nil || artifact != *got.ArtifactID {
		t.Fatal("handoff used a different artifact", artifact, err)
	}
	// Exercise the positive automatic-policy branch in the real release worker,
	// through submission and observation using the existing SDK fake executor.
	rf := &releaseFixture{c: c, apps: b.apps, app: b.app}
	var submits int
	worker := releaseWorker(t, rf, releaseExecutor{
		submit: func(ctx context.Context, in release.Input) (release.Observation, error) {
			submits++
			if in.Plan.ArtifactID != *got.ArtifactID {
				t.Fatal("automatic worker used another build artifact")
			}
			revision := int32(1)
			return release.Observation{State: "observing", Revision: &revision, Resources: releaseResources(t, in)}, nil
		},
		observe: func(ctx context.Context, in release.Input) (release.Observation, error) {
			return release.Observation{State: "succeeded", Revision: in.Revision, Resources: in.Known}, nil
		},
	})
	r := decode[application.ReleaseRequest](t, c.f.call("GET", "/api/release-requests/"+*got.AutoDeployments[0].RequestID, c.developer, nil, 200))
	releaseStep(t, worker)
	releasePoll(t, rf, *r.DeploymentID)
	releaseStep(t, worker)
	releaseState(t, rf, *r.DeploymentID, "succeeded")
	var current string
	if err := c.f.pool.QueryRow(context.Background(), "SELECT current_deployment_id FROM app_environment_bindings WHERE id=$1", r.BindingID).Scan(&current); err != nil || current != *r.DeploymentID || submits != 1 {
		t.Fatal("automatic success did not advance the binding exactly once", current, submits, err)
	}
}
