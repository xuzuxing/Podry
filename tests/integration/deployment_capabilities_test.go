package integration_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/release"
)

func TestDeploymentCapabilitiesPrivatePullVersionAndRollback(t *testing.T) {
	for _, origin := range []string{"external", "build"} {
		t.Run(origin, func(t *testing.T) {
			f := setupRelease(t, "Deployment")
			c := f.c
			ctx := context.Background()
			cr := decode[platform.Credential](t, c.f.call("POST", "/api/credentials", c.admin, map[string]any{"name": "Pull auth", "kind": "registry", "teamId": c.teamID, "payload": map[string]any{"username": "pull-user", "password": "frozen-pull-password"}}, 201))
			var registry string
			if err := c.f.pool.QueryRow(ctx, "SELECT id FROM registries LIMIT 1").Scan(&registry); err != nil {
				t.Fatal(err)
			}
			f.artifact = uuid.NewString()
			if origin == "external" {
				_, err := c.f.pool.Exec(ctx, "INSERT INTO artifacts(id,app_id,source,image_repository,digest,registry_id,registry_credential_id,registry_credential_version,imported_by) VALUES($1,$2,'external','registry.example.test/team/demo',$3,$4,$5,1,$6)", f.artifact, f.app, "sha256:"+strings.Repeat("c", 64), registry, cr.ID, c.dev.ID)
				if err != nil {
					t.Fatal(err)
				}
			} else {
				buildID, attemptID := uuid.NewString(), uuid.NewString()
				spec := build.ExecutionSpec{Version: 1, AppID: f.app, BuildID: buildID, AttemptID: attemptID, RegistryEndpoint: "https://registry.example.test", ImageRepository: "team/demo", RegistryCredential: &build.CredentialRef{ID: cr.ID, Version: 1}}
				raw, _ := json.Marshal(spec)
				statements := []struct {
					sql  string
					args []any
				}{
					{"INSERT INTO builds(id,app_id,pipeline_id,config_version,commit_sha,status,requested_by) SELECT $1,$2,pipeline_id,config_version,commit_sha,'succeeded',requested_by FROM builds WHERE app_id=$2 LIMIT 1", []any{buildID, f.app}},
					{"INSERT INTO build_attempts(id,build_id,attempt_no,status,build_cluster_id,namespace,job_name,execution_spec,execution_hash,stage) VALUES($1,$2,1,'succeeded',$3,'build','private-fixture',$4,$5,'finished')", []any{attemptID, buildID, c.clusterID, raw, build.Hash(spec)}},
					{"INSERT INTO artifacts(id,app_id,build_id,attempt_id,image_repository,digest) VALUES($1,$2,$3,$4,'registry.example.test/team/demo',$5)", []any{f.artifact, f.app, buildID, attemptID, "sha256:" + strings.Repeat("c", 64)}},
					{"UPDATE builds SET artifact_id=$2 WHERE id=$1", []any{buildID, f.artifact}},
				}
				for _, s := range statements {
					if _, err := c.f.pool.Exec(ctx, s.sql, s.args...); err != nil {
						t.Fatal(err)
					}
				}
			}
			values := map[string]any{"command": []string{"/app"}, "args": []string{"serve"}, "readinessProbe": map[string]any{"httpGet": map[string]any{"path": "/ping", "port": 8080}}, "configFiles": map[string]any{"app.yaml": "mode: demo"}, "volumes": []any{map[string]any{"name": "settings", "mountPath": "/settings", "readOnly": true, "configMap": map[string]any{"name": "settings"}}}}
			c.f.call("PUT", "/api/apps/"+f.app+"/config", c.developer, map[string]any{"expectedVersion": 3, "section": "base", "chartConfig": map[string]any{"workloadKind": "Deployment", "chartVersion": "1.2.0"}, "deployValues": values, "secretRefs": []any{}}, 200)
			calls := 0
			w := releaseWorker(t, f, releaseExecutor{submit: func(_ context.Context, in release.Input) (release.Observation, error) {
				calls++
				if in.Plan.PullCredential == nil || in.Plan.PullCredential.ID != cr.ID || in.Plan.PullCredential.Version != 1 {
					t.Fatal("pull credential did not freeze origin version")
				}
				raw, err := base64.StdEncoding.DecodeString(bm(in.Values["podry"])["pullData"].(string))
				if err != nil || !strings.Contains(string(raw), "frozen-pull-password") || strings.Contains(string(raw), "rotated-pull-password") {
					t.Fatal("runtime auth drifted", err)
				}
				rev := int32(calls)
				return release.Observation{State: "succeeded", Revision: &rev, Resources: releaseResources(t, in)}, nil
			}, observe: func(context.Context, release.Input) (release.Observation, error) {
				t.Fatal("unexpected observe")
				return release.Observation{}, nil
			}})
			preview := f.preview(t, 4)
			raw, _ := json.Marshal(preview)
			if strings.Contains(string(raw), "frozen-pull-password") || !strings.Contains(preview.Diff.After, "kubernetes.io/dockerconfigjson") {
				t.Fatal("preview exposed auth or omitted pull secret")
			}
			r := decode[application.ReleaseRequest](t, f.confirm(t, preview, "private-pull-confirm", 202))
			c.f.call("PUT", "/api/credentials/"+cr.ID, c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"username": "pull-user", "password": "rotated-pull-password"}}, 200)
			releaseStep(t, w)
			releaseState(t, f, *r.DeploymentID, "succeeded")
			rollback := decode[application.ReleaseRequest](t, c.f.keyed("POST", "/api/deployments/"+*r.DeploymentID+"/rollback", c.developer, "private-pull-rollback", application.RollbackInput{Reason: "restore configuration"}, 202))
			releaseStep(t, w)
			releaseState(t, f, *rollback.DeploymentID, "succeeded")
			p := actionSnapshot(t, f, rollback)
			if p.Chart.Version != "1.2.0" || p.PullCredential.Version != 1 || bm(p.Chart.Values["configFiles"])["app.yaml"] != "mode: demo" {
				t.Fatal("rollback lost frozen capabilities")
			}
			var leaks int
			if err := c.f.pool.QueryRow(ctx, "SELECT count(*) FROM release_snapshots WHERE snapshot::text LIKE '%pull-password%' OR snapshot::text LIKE '%pull-user%'").Scan(&leaks); err != nil || leaks != 0 {
				t.Fatal("runtime pull auth persisted", err)
			}
			// A Secret mount requires explicit reveal even when namespace write is allowed.
			values["volumes"] = []any{map[string]any{"name": "tls", "mountPath": "/tls", "readOnly": true, "secret": map[string]any{"secretName": "tls"}}}
			c.f.call("PUT", "/api/apps/"+f.app+"/config", c.developer, map[string]any{"expectedVersion": 4, "section": "base", "chartConfig": map[string]any{"workloadKind": "Deployment", "chartVersion": "1.2.0"}, "deployValues": values, "secretRefs": []any{}}, 200)
			c.f.call("POST", "/api/apps/"+f.app+"/deployment-previews", c.developer, application.DeploymentPreviewInput{BindingID: f.binding, ArtifactID: f.artifact, ExpectedConfigVersion: 5}, 403)
		})
	}
}

func TestApplicationLifecycleOfflineUnknownDetachAndHistory(t *testing.T) {
	f := setupApplicationResources(t, "Deployment")
	c := f.c
	ctx := context.Background()
	path := "/api/apps/" + f.app + "/environments/" + f.binding
	in := application.LifecycleInput{ExpectedVersion: 1, Reason: "retire test environment"}
	assertCode(t, c.f.keyed("POST", path+"/detach", c.developer, "detach-live-test", in, 409), "binding_not_offline")
	c.f.keyed("POST", path+"/offline", c.developer, "offline-no-delete", in, 403)
	c.f.call("POST", "/api/clusters/"+c.clusterID+"/resource-grants", c.admin, map[string]any{"principalType": "project", "principalId": c.projectID, "namespace": "demo", "resources": []string{"*"}, "actions": []string{"resource.view", "resource.write", "resource.delete"}}, 201)
	calls := 0
	w := releaseWorker(t, f.releaseFixture, releaseExecutor{submit: func(_ context.Context, exec release.Input) (release.Observation, error) {
		calls++
		if exec.Plan.Removal == nil || exec.Plan.Removal.DeploymentID != f.plan.DeploymentID || len(exec.Plan.Removal.Resources) != 4 || len(exec.Values) != 0 {
			t.Fatal("offline lost UID evidence or decrypted runtime secrets")
		}
		rev := int32(1)
		if calls == 1 {
			return release.Observation{State: "unknown", Code: "release_removal_unconfirmed", Revision: &rev}, nil
		}
		return release.Observation{State: "succeeded", Revision: &rev}, nil
	}, observe: func(context.Context, release.Input) (release.Observation, error) {
		t.Fatal("worker should resume conditional deletes")
		return release.Observation{}, nil
	}})
	raw := c.f.keyed("POST", path+"/offline", c.developer, "offline-lifecycle", in, 202)
	r := decode[application.ReleaseRequest](t, raw)
	if r.Kind != "offline" {
		t.Fatal("offline lineage omitted")
	}
	if again := c.f.keyed("POST", path+"/offline", c.developer, "offline-lifecycle", in, 202); !bytes.Equal(raw, again) {
		t.Fatal("offline replay changed result")
	}
	releaseStep(t, w)
	releaseState(t, f.releaseFixture, *r.DeploymentID, "unknown")
	assertCode(t, c.f.keyed("POST", path+"/detach", c.developer, "detach-unknown-test", application.LifecycleInput{ExpectedVersion: 2, Reason: "detach"}, 409), "target_busy")
	releasePoll(t, f.releaseFixture, *r.DeploymentID)
	releaseStep(t, w)
	releaseState(t, f.releaseFixture, *r.DeploymentID, "succeeded")
	var current *string
	var version int32
	var auto bool
	var health string
	if err := c.f.pool.QueryRow(ctx, "SELECT current_deployment_id,version,auto_deploy FROM app_environment_bindings WHERE id=$1", f.binding).Scan(&current, &version, &auto); err != nil || current != nil || auto || version != 3 {
		t.Fatal("offline pointer/version mismatch", err)
	}
	if err := c.f.pool.QueryRow(ctx, "SELECT health FROM application_health WHERE app_id=$1", f.app).Scan(&health); err != nil || health != "stopped" {
		t.Fatal("offline projected incorrect health", health, err)
	}
	assertCode(t, c.f.keyed("POST", path+"/detach", c.developer, "detach-stale-test", in, 409), "revision_conflict")
	detach := application.LifecycleInput{ExpectedVersion: version, Reason: "detach confirmed offline environment"}
	raw = c.f.keyed("POST", path+"/detach", c.developer, "detach-complete", detach, 200)
	if again := c.f.keyed("POST", path+"/detach", c.developer, "detach-complete", detach, 200); !bytes.Equal(raw, again) {
		t.Fatal("detach replay changed")
	}
	bindings := decode[[]application.Binding](t, c.f.call("GET", "/api/apps/"+f.app+"/environments", c.developer, nil, 200))
	workflow := decode[application.Workflow](t, c.f.call("GET", "/api/apps/"+f.app+"/pipelines", c.developer, nil, 200))
	if len(bindings) != 0 || len(workflow.Items) != 1 || workflow.Items[0].Kind != "ci" {
		t.Fatal("detached environment remained in active workflow")
	}
	c.f.call("GET", "/api/deployments/"+f.plan.DeploymentID, c.developer, nil, 200)
	c.f.call("GET", "/api/deployments/"+*r.DeploymentID, c.developer, nil, 200)
	c.f.call("GET", "/api/apps/"+f.app+"/resources?bindingId="+f.binding, c.developer, nil, 404)
	if err := database.Migrate(c.f.dsn, true); err == nil {
		t.Fatal("lifecycle history allowed downgrade")
	}
}

func TestApplicationLifecycleDetachUnusedAndRebind(t *testing.T) {
	f := setupRelease(t, "Deployment")
	c := f.c
	path := "/api/apps/" + f.app + "/environments"
	in := application.LifecycleInput{ExpectedVersion: 1, Reason: "unused environment"}
	assertCode(t, c.f.keyed("POST", path+"/"+f.binding+"/offline", c.developer, "unused-offline-test", in, 409), "binding_not_deployed")
	c.f.keyed("POST", path+"/"+f.binding+"/detach", c.developer, "unused-detach-test", in, 200)
	newBinding := decode[application.Binding](t, c.f.call("POST", path, c.developer, bindingInput(c, c.environmentID, "rebound-demo", map[string]any{}), 201))
	if newBinding.ID == f.binding {
		t.Fatal("rebind reused detached identity")
	}
	assertCode(t, c.f.call("PUT", path+"/"+f.binding, c.developer, bindingUpdate(2, map[string]any{}), 409), "binding_detached")
}

func TestBuildCheckScriptFrozenAdmission(t *testing.T) {
	b := setupBuild(t)
	c := b.c
	config := decode[application.Config](t, c.f.call("GET", "/api/apps/"+b.app+"/config", c.developer, nil, 200))
	script := "test -f Dockerfile"
	config.BuildConfig.CheckScript = &script
	c.f.call("PUT", "/api/apps/"+b.app+"/config", c.developer, map[string]any{"expectedVersion": 2, "section": "build", "buildConfig": config.BuildConfig}, 200)
	out := decode[build.Build](t, c.f.keyed("POST", "/api/apps/"+b.app+"/builds", c.developer, "check-script-build", application.BuildInput{CommitSHA: b.sha, ExpectedConfigVersion: 3}, 202))
	var raw []byte
	var hash string
	if err := c.f.pool.QueryRow(context.Background(), "SELECT execution_spec,execution_hash FROM build_attempts WHERE build_id=$1", out.ID).Scan(&raw, &hash); err != nil {
		t.Fatal(err)
	}
	var spec build.ExecutionSpec
	if err := json.Unmarshal(raw, &spec); err != nil || spec.CheckScript == nil || *spec.CheckScript != script || build.Hash(spec) != hash {
		t.Fatal("check script not frozen", err)
	}
	for range 3 {
		b.step(t)
	}
	b.kube.failed = true
	b.step(t)
	result := decode[build.Build](t, c.f.call("GET", "/api/builds/"+out.ID, c.developer, nil, 200))
	if result.Status != "failed" || result.ArtifactID != nil {
		t.Fatal("failed Job produced an Artifact")
	}
}
