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
	"time"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
)

func cloneInput(source, target, name, mode string) application.ApplicationInput {
	return application.ApplicationInput{ProjectID: target, Name: name, Description: "Independent cloned application", SourceMode: mode, CloneFromAppID: &source}
}
func cloneTarget(t *testing.T, c *controlFixture, otherTeam bool) (string, string) {
	t.Helper()
	team := c.teamID
	if otherTeam {
		team = decode[project.Team](t, c.f.call("POST", "/api/teams", c.admin, map[string]string{"name": "Clone destination"}, 201)).ID
		c.f.call("POST", "/api/teams/"+team+"/members", c.admin, project.Member{UserID: c.dev.ID, Role: "developer"}, 201)
	}
	p := decode[project.Project](t, c.f.call("POST", "/api/projects", c.admin, map[string]string{"teamId": team, "name": "Clone project"}, 201))
	c.f.call("POST", "/api/projects/"+p.ID+"/members", c.admin, project.Member{UserID: c.dev.ID, Role: "developer"}, 201)
	return p.ID, team
}
func assertCloneEmptyRuntime(t *testing.T, c *controlFixture, id string) {
	t.Helper()
	for _, table := range []string{"pipelines", "app_environment_bindings", "builds", "artifacts", "deployment_previews", "release_snapshots"} {
		var n int
		if err := c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table+" WHERE app_id=$1", id).Scan(&n); err != nil || n != 0 {
			t.Fatal("clone copied runtime state", table, n, err)
		}
	}
	var n int
	if err := c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM release_requests r JOIN release_snapshots s ON s.id=r.snapshot_id WHERE s.app_id=$1", id).Scan(&n); err != nil || n != 0 {
		t.Fatal("clone copied release requests", n, err)
	}
	if err := c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM deployments d JOIN release_requests r ON r.id=d.request_id JOIN release_snapshots s ON s.id=r.snapshot_id WHERE s.app_id=$1", id).Scan(&n); err != nil || n != 0 {
		t.Fatal("clone copied deployments", n, err)
	}
}
func assertCloneAbsent(t *testing.T, c *controlFixture, projectID, name string) {
	t.Helper()
	var n int
	if err := c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM applications WHERE project_id=$1 AND name=$2", projectID, name).Scan(&n); err != nil || n != 0 {
		t.Fatal("failed clone left application", n, err)
	}
}

func TestCloneFullConfigurationAndIndependentHistory(t *testing.T) {
	f := setupRelease(t, "Deployment")
	c := f.c
	successfulRelease(t, f, 3)
	gitCredential := decode[platform.Credential](t, c.f.call("POST", "/api/credentials", c.admin, map[string]any{"name": "Clone Git", "kind": "git", "teamId": c.teamID, "payload": map[string]string{"username": "fixture-reader", "token": "clone-private-token-never-copy"}}, 201))
	c.f.call("PUT", "/api/apps/"+f.app+"/config", c.developer, map[string]any{"expectedVersion": 3, "section": "git", "gitConfig": application.GitConfig{RepositoryURL: "https://git.example.test/team/repo.git", Branch: "main", AccountMode: "credential", CredentialID: &gitCredential.ID}}, 200)
	source := decode[application.Config](t, c.f.call("GET", "/api/apps/"+f.app+"/config", c.developer, nil, 200))
	c.f.call("PUT", "/api/credentials/"+f.secret, c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"data": map[string]string{"DATABASE_URL": "rotated-value-never-copy"}}}, 200)
	// A clone preserves pinned references even when historical ciphertext cannot
	// currently be decrypted. Execution will validate the key when it is needed.
	// Change only this isolated fixture and restore immutability before cloning.
	tx, err := c.f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "ALTER TABLE secret_versions DISABLE TRIGGER secret_versions_immutable"); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(context.Background(), "UPDATE secret_versions SET key_id='retired-clone-fixture-key' WHERE credential_id=$1 AND version=1", f.secret); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(context.Background(), "ALTER TABLE secret_versions ENABLE TRIGGER secret_versions_immutable"); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	c.f.call("PATCH", "/api/apps/"+f.app, c.developer, map[string]any{"archived": true}, 200)
	var secretsBefore int
	if err := c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM secret_versions").Scan(&secretsBefore); err != nil {
		t.Fatal(err)
	}
	cloned := decode[application.Application](t, c.f.call("POST", "/api/apps", c.developer, cloneInput(f.app, c.projectID, "cloned-release", "git"), 201))
	if cloned.ArchivedAt != nil || cloned.Health != "unknown" || cloned.ID == f.app || cloned.Description != "Independent cloned application" {
		t.Fatal(cloned)
	}
	got := decode[application.Config](t, c.f.call("GET", "/api/apps/"+cloned.ID+"/config", c.developer, nil, 200))
	if got.Version != 1 || got.BuildConfig == nil || got.BuildConfig.ImageRepository != "podry/"+cloned.ID || got.BuildConfig.ImageRepository == source.BuildConfig.ImageRepository {
		t.Fatal(got)
	}
	want := source
	want.AppID, want.Version = got.AppID, 1
	wantBuild := *source.BuildConfig
	wantBuild.ImageRepository = got.BuildConfig.ImageRepository
	want.BuildConfig = &wantBuild
	if !reflect.DeepEqual(want, got) {
		t.Fatal("clone lost exact section values or credential references", want, got)
	}
	if len(got.SecretRefs) != 1 || got.SecretRefs[0].Version != 1 || got.SecretRefs[0].CredentialID != f.secret {
		t.Fatal("clone replaced pinned Secret reference", got.SecretRefs)
	}
	assertCloneEmptyRuntime(t, c, cloned.ID)
	setup := decode[application.Setup](t, c.f.call("GET", "/api/apps/"+cloned.ID+"/setup", c.developer, nil, 200))
	if setup.Completed != 3 || setup.WorkflowVersion != 0 || setup.CanBuild || len(setup.DeployableBindingIDs) != 0 {
		t.Fatal(setup)
	}
	// Updating the destination appends its own history and leaves source values intact.
	c.f.call("PUT", "/api/apps/"+cloned.ID+"/config", c.developer, map[string]any{"expectedVersion": 1, "section": "base", "chartConfig": got.ChartConfig, "deployValues": map[string]any{"containerPort": 9090}, "secretRefs": got.SecretRefs}, 200)
	after := decode[application.Config](t, c.f.call("GET", "/api/apps/"+f.app+"/config", c.developer, nil, 200))
	if after.Version != 4 || after.BuildConfig.ImageRepository != "team/demo" || after.DeployValues["containerPort"] != float64(8080) {
		t.Fatal("clone mutated source", after)
	}
	var secretsAfter int
	if err := c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM secret_versions").Scan(&secretsAfter); err != nil || secretsAfter != secretsBefore {
		t.Fatal("copied credentials", err)
	}
	var target string
	if err := c.f.pool.QueryRow(context.Background(), "SELECT target::text FROM audit_events WHERE action='application.create' AND target->>'appId'=$1", cloned.ID).Scan(&target); err != nil || !strings.Contains(target, f.app) || !strings.Contains(target, `"sourceConfigVersion": 4`) || strings.Contains(target, "clone-private-token") {
		t.Fatal("invalid clone audit", target, err)
	}
}

func TestClonePartialAndImageConfigurations(t *testing.T) {
	c := controlSetup(t)
	for _, tc := range []struct {
		name, mode string
		sections   int
	}{{"empty-git", "git", 0}, {"partial-git", "git", 1}, {"empty-image", "image", 0}, {"configured-image", "image", 1}} {
		t.Run(tc.name, func(t *testing.T) {
			source := decode[application.Application](t, c.f.call("POST", "/api/apps", c.developer, application.ApplicationInput{ProjectID: c.projectID, Name: "source-" + tc.name, SourceMode: tc.mode}, 201))
			if tc.sections > 0 {
				if tc.mode == "git" {
					c.configureTo(t, source.ID, 1)
				} else {
					c.f.call("PUT", "/api/apps/"+source.ID+"/config", c.developer, map[string]any{"expectedVersion": 0, "section": "base", "chartConfig": application.ChartConfig{WorkloadKind: "Job", ChartVersion: "1.0.0"}, "deployValues": map[string]any{}, "secretRefs": []any{}}, 200)
				}
			}
			cloned := decode[application.Application](t, c.f.call("POST", "/api/apps", c.developer, cloneInput(source.ID, c.projectID, "copy-"+tc.name, tc.mode), 201))
			got := decode[application.Config](t, c.f.call("GET", "/api/apps/"+cloned.ID+"/config", c.developer, nil, 200))
			if got.Version != int32(tc.sections) || got.BuildConfig != nil || (tc.mode == "image" && got.GitConfig != nil) {
				t.Fatal(got)
			}
			var n int
			if err := c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM app_config_versions WHERE app_id=$1", cloned.ID).Scan(&n); err != nil || n != tc.sections {
				t.Fatal("invented config snapshot", n, err)
			}
			assertCloneEmptyRuntime(t, c, cloned.ID)
		})
	}
}

func TestCloneSourceReadAndDestinationConfigurePermissions(t *testing.T) {
	c := controlSetup(t)
	source := c.app(t, "clone-source")
	c.configureTo(t, source, 1)
	target, _ := cloneTarget(t, c, false)
	c.f.call("POST", "/api/projects/"+c.projectID+"/members", c.admin, project.Member{UserID: c.dev.ID, Role: "viewer"}, 201)
	c.f.call("POST", "/api/apps", c.developer, cloneInput(source, target, "reader-copy", "git"), 201)
	c.f.call("POST", "/api/projects/"+target+"/members", c.admin, project.Member{UserID: c.dev.ID, Role: "operator"}, 201)
	c.f.call("POST", "/api/apps", c.developer, cloneInput(source, target, "operator-copy", "git"), 403)
	assertCloneAbsent(t, c, target, "operator-copy")
	c.f.call("POST", "/api/projects/"+target+"/members", c.admin, project.Member{UserID: c.dev.ID, Role: "developer"}, 201)
	c.f.call("DELETE", "/api/projects/"+c.projectID+"/members/"+c.dev.ID, c.admin, nil, 204)
	c.f.call("POST", "/api/apps", c.developer, cloneInput(source, target, "hidden-copy", "git"), 404)
	assertCloneAbsent(t, c, target, "hidden-copy")
	c.f.call("POST", "/api/apps", c.developer, cloneInput(uuid.NewString(), target, "missing-copy", "git"), 404)
	c.f.call("POST", "/api/apps", c.developer, cloneInput("invalid", target, "invalid-copy", "git"), 422)
	c.f.call("POST", "/api/apps", c.admin, cloneInput(source, target, "wrong-mode", "image"), 422)
	assertCloneAbsent(t, c, target, "wrong-mode")
}

func TestCloneCrossTeamCredentialReferencesAreAtomic(t *testing.T) {
	for _, kind := range []string{"git", "secret", "registry"} {
		t.Run(kind, func(t *testing.T) {
			c := controlSetup(t)
			source := c.app(t, "scoped-clone-source")
			c.configure(t, source)
			payload := map[string]any{"username": "fixture-user", "token": "private-token"}
			var team any = c.teamID
			if kind == "secret" {
				payload = map[string]any{"data": map[string]string{"VALUE": "private-runtime-value"}}
			}
			if kind == "registry" {
				team = nil
				payload = map[string]any{"username": "fixture-user", "password": "private-password"}
			}
			cr := decode[platform.Credential](t, c.f.call("POST", "/api/credentials", c.admin, map[string]any{"name": "Clone reference", "kind": kind, "teamId": team, "payload": payload}, 201))
			config := decode[application.Config](t, c.f.call("GET", "/api/apps/"+source+"/config", c.developer, nil, 200))
			input := map[string]any{"expectedVersion": 3}
			switch kind {
			case "git":
				config.GitConfig.AccountMode = "credential"
				config.GitConfig.CredentialID = &cr.ID
				input["section"] = "git"
				input["gitConfig"] = config.GitConfig
			case "secret":
				input["section"] = "base"
				input["chartConfig"] = config.ChartConfig
				input["deployValues"] = config.DeployValues
				input["secretRefs"] = []application.SecretRef{{CredentialID: cr.ID, Version: 1, TargetKey: "VALUE"}}
			case "registry":
				reg := decode[platform.Registry](t, c.f.call("POST", "/api/registries", c.admin, map[string]any{"name": "Private clone registry", "endpoint": "https://private.example.test", "credentialId": cr.ID}, 201))
				config.BuildConfig.RegistryID = reg.ID
				input["section"] = "build"
				input["buildConfig"] = config.BuildConfig
			}
			c.f.call("PUT", "/api/apps/"+source+"/config", c.developer, input, 200)
			if kind == "registry" {
				// Isolated scope-change injection covers the indirect Registry credential.
				if _, err := c.f.pool.Exec(context.Background(), "UPDATE credentials SET team_id=$2 WHERE id=$1", cr.ID, c.teamID); err != nil {
					t.Fatal(err)
				}
			}
			target, _ := cloneTarget(t, c, true)
			c.f.call("POST", "/api/apps", c.developer, cloneInput(source, target, "forbidden-copy", "git"), 404)
			assertCloneAbsent(t, c, target, "forbidden-copy")
			var n int
			if err := c.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_events WHERE project_id=$1 AND action='application.create'", target).Scan(&n); err != nil || n != 0 {
				t.Fatal("failed clone left audit", n, err)
			}
		})
	}
}

type cloneReply struct {
	status int
	body   []byte
}

func cloneCall(c *controlFixture, in application.ApplicationInput) cloneReply {
	raw, _ := json.Marshal(in)
	r := httptest.NewRequest("POST", "/api/apps", bytes.NewReader(raw))
	r.Header.Set("Authorization", "Bearer "+c.developer)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	c.f.handler.ServeHTTP(w, r)
	return cloneReply{w.Code, w.Body.Bytes()}
}
func TestCloneConcurrentOppositeProjectsAndDuplicateNames(t *testing.T) {
	c := controlSetup(t)
	source := c.app(t, "first-clone-source")
	c.configureTo(t, source, 2)
	target, team := cloneTarget(t, c, true)
	other := *c
	other.projectID, other.teamID = target, team
	sourceOther := other.app(t, "other-clone-source")
	other.configureTo(t, sourceOther, 2)
	inputs := []application.ApplicationInput{cloneInput(source, target, "cross-copy", "git"), cloneInput(sourceOther, c.projectID, "cross-copy", "git")}
	var wg sync.WaitGroup
	results := make(chan cloneReply, 2)
	start := make(chan struct{})
	for _, in := range inputs {
		wg.Go(func() { <-start; results <- cloneCall(c, in) })
	}
	close(start)
	wg.Wait()
	close(results)
	refs := map[string]bool{}
	for result := range results {
		if result.status != 201 {
			t.Fatal(result.status, string(result.body))
		}
		app := decode[application.Application](t, result.body)
		config := decode[application.Config](t, c.f.call("GET", "/api/apps/"+app.ID+"/config", c.developer, nil, 200))
		if refs[config.BuildConfig.ImageRepository] {
			t.Fatal("shared clone image repository")
		}
		refs[config.BuildConfig.ImageRepository] = true
	}
	results = make(chan cloneReply, 2)
	start = make(chan struct{})
	for range 2 {
		wg.Go(func() { <-start; results <- cloneCall(c, cloneInput(source, target, "duplicate-copy", "git")) })
	}
	close(start)
	wg.Wait()
	close(results)
	counts := map[int]int{}
	for result := range results {
		counts[result.status]++
	}
	if counts[201] != 1 || counts[409] != 1 {
		t.Fatal("duplicate clone did not serialize", counts)
	}
}

func TestCloneRechecksMembershipAfterLockWait(t *testing.T) {
	c := controlSetup(t)
	source := c.app(t, "revocation-source")
	c.configureTo(t, source, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := c.f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, "SELECT id FROM teams WHERE id=$1 FOR UPDATE", c.teamID); err != nil {
		t.Fatal(err)
	}
	result := make(chan cloneReply, 1)
	go func() { result <- cloneCall(c, cloneInput(source, c.projectID, "revoked-copy", "git")) }()
	// Wait for the real SQL lock, so revocation commits before role evaluation.
	for {
		var waiting bool
		if err = c.f.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM teams%')").Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("clone never waited for team lock")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if _, err = tx.Exec(ctx, "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", c.projectID, c.dev.ID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case reply := <-result:
		if reply.status != 404 {
			t.Fatal(reply.status, string(reply.body))
		}
	case <-ctx.Done():
		t.Fatal("clone did not finish after revocation")
	}
	assertCloneAbsent(t, c, c.projectID, "revoked-copy")
}
