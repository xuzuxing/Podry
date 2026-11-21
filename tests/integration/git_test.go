package integration_test

import (
	"context"
	"encoding/binary"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/audit"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/gitremote"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
	"github.com/xuzuxing/podry/internal/server"
	"github.com/xuzuxing/podry/tests/gitfixture"
)

func setupGit(t *testing.T) (*controlFixture, *gitfixture.Fixture, *application.Service, string) {
	t.Helper()
	c := controlSetup(t)
	remote := gitfixture.New(t)
	vault, err := credential.New(testCredentialKey)
	if err != nil {
		t.Fatal(err)
	}
	s := application.New(c.f.pool, vault, gitremote.New(remote.Server.Client()), testJWT)
	c.f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: c.f.auth, Project: project.New(c.f.pool), Audit: audit.New(c.f.pool), Platform: platform.New(c.f.pool, vault), Application: s})
	id := c.app(t, "git-material-app")
	return c, remote, s, id
}
func saveGit(t *testing.T, c *controlFixture, id, repository string, version int, cred *string) {
	t.Helper()
	mode := "public"
	if cred != nil {
		mode = "credential"
	}
	c.f.call("PUT", "/api/apps/"+id+"/config", c.developer, map[string]any{"expectedVersion": version, "section": "git", "gitConfig": map[string]any{"repositoryUrl": repository, "branch": "main", "accountMode": mode, "credentialId": cred}}, 200)
}
func TestGitHTTPSMaterialPaginationCredentialsAndErrors(t *testing.T) {
	c, remote, _, id := setupGit(t)
	f := c.f
	base := "/api/apps/" + id + "/git/"
	assertCode(t, f.call("GET", base+"branches", c.developer, nil, 422), "git_not_configured")
	saveGit(t, c, id, remote.URL(), 0, nil)
	branches := decode[application.GitBranchList](t, f.call("GET", base+"branches?limit=1", c.developer, nil, 200))
	if len(branches.Items) != 1 || branches.Items[0].Name != "feature/demo" || branches.NextCursor == nil || branches.ConfigVersion != 1 || branches.ObservedAt.IsZero() {
		t.Fatal("invalid branch page")
	}
	second := decode[application.GitBranchList](t, f.call("GET", base+"branches?limit=1&cursor="+url.QueryEscape(*branches.NextCursor), c.developer, nil, 200))
	if len(second.Items) != 1 || !second.Items[0].IsDefault || second.Items[0].HeadSHA != remote.Main[2].String() || second.NextCursor != nil {
		t.Fatal("default branch or continuation incorrect")
	}
	filtered := decode[application.GitBranchList](t, f.call("GET", base+"branches?keyword=MAIN", c.developer, nil, 200))
	if len(filtered.Items) != 1 {
		t.Fatal("branch keyword not applied")
	}
	commits := decode[application.GitCommitList](t, f.call("GET", base+"commits?ref=main&limit=1", c.developer, nil, 200))
	if len(commits.Items) != 1 || commits.Items[0].SHA != remote.Main[2].String() || commits.ResolvedRef != remote.Main[2].String() || commits.NextCursor == nil {
		t.Fatal("incorrect commit tip")
	}
	last := decode[application.GitCommitList](t, f.call("GET", base+"commits?ref=main&limit=100&cursor="+url.QueryEscape(*commits.NextCursor), c.developer, nil, 200))
	if len(last.Items) != 2 || last.Items[1].Subject != "Initial commit" || last.NextCursor != nil {
		t.Fatal("incomplete history page")
	}
	remote.MoveMainToFeature.Store(true)
	assertCode(t, f.call("GET", base+"branches?cursor="+url.QueryEscape(*branches.NextCursor), c.developer, nil, 409), "git_ref_changed")
	assertCode(t, f.call("GET", base+"commits?ref=main&cursor="+url.QueryEscape(*commits.NextCursor), c.developer, nil, 409), "git_ref_changed")
	remote.MoveMainToFeature.Store(false)
	for _, prefix := range []string{remote.Main[0].String()[:7], remote.Main[0].String()} {
		result := decode[application.GitCommitList](t, f.call("GET", base+"commits?ref=main&shaPrefix="+prefix, c.developer, nil, 200))
		if len(result.Items) != 1 || result.Items[0].SHA != remote.Main[0].String() {
			t.Fatal("prefix lookup failed")
		}
	}
	result := decode[application.GitCommitList](t, f.call("GET", base+"commits?ref=main&shaPrefix="+remote.Feature.String(), c.developer, nil, 200))
	if len(result.Items) != 0 {
		t.Fatal("returned commit outside selected branch")
	}
	assertCode(t, f.call("GET", base+"commits?ref=missing", c.developer, nil, 422), "git_ref_not_found")
	for _, path := range []string{"commits", "commits?ref=main&shaPrefix=ABCDEF1", "commits?ref=--help", "commits?ref=main&ref=other", "branches?limit=0", "branches?limit=101", "branches?limit=", "branches?repositoryUrl=https://other.test/repo", "branches?cursor=tampered", "branches?keyword=other&cursor=" + url.QueryEscape(*branches.NextCursor)} {
		assertCode(t, f.call("GET", base+path, c.developer, nil, 422), "validation_failed")
	}
	remote.RequireAuth.Store(true)
	data := f.call("GET", base+"branches", c.developer, nil, 422)
	assertCode(t, data, "git_auth_failed")
	cred := decode[platform.Credential](t, f.call("POST", "/api/credentials", c.admin, map[string]any{"name": "Git token", "kind": "git", "teamId": c.teamID, "payload": map[string]string{"username": "git", "token": "fixture-private-token"}}, 201))
	saveGit(t, c, id, remote.URL(), 1, &cred.ID)
	data = f.call("GET", base+"commits?ref=main", c.developer, nil, 200)
	for _, private := range []string{"fixture-private-token", "private-author@example.test", "Private details", "ciphertext"} {
		if strings.Contains(string(data), private) {
			t.Fatal("sensitive upstream material disclosed")
		}
	}
	privatePage := decode[application.GitBranchList](t, f.call("GET", base+"branches?limit=1", c.developer, nil, 200))
	f.call("PUT", "/api/credentials/"+cred.ID, c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]string{"username": "git", "token": "fixture-private-token"}}, 200)
	assertCode(t, f.call("GET", base+"branches?cursor="+url.QueryEscape(*privatePage.NextCursor), c.developer, nil, 422), "validation_failed")
	assertCode(t, f.call("GET", base+"branches?cursor="+url.QueryEscape(*branches.NextCursor), c.developer, nil, 422), "validation_failed")
	for _, status := range []int32{404, 500} {
		remote.Status.Store(status)
		code := 503
		expected := "git_unavailable"
		if status == 404 {
			code = 422
			expected = "git_repository_invalid"
		}
		data = f.call("GET", base+"branches", c.developer, nil, code)
		assertCode(t, data, expected)
		if strings.Contains(string(data), "do-not-echo") {
			t.Fatal("leaked upstream body")
		}
	}
	remote.Status.Store(0)
	remote.Empty.Store(true)
	result = decode[application.GitCommitList](t, f.call("GET", base+"commits?ref=main", c.developer, nil, 200))
	if len(result.Items) != 0 || result.NextCursor != nil {
		t.Fatal("empty repository synthesized history")
	}
	// Query failures do not append configuration versions or write execution state.
	var n int
	if err := f.pool.QueryRow(context.Background(), "SELECT count(*) FROM app_config_versions WHERE app_id=$1", id).Scan(&n); err != nil || n != 2 {
		t.Fatal("Git reads mutated configuration", err)
	}
}

func TestGitAuthorizationAndConcurrentRevocation(t *testing.T) {
	c, remote, s, id := setupGit(t)
	saveGit(t, c, id, remote.URL(), 0, nil)
	base := "/api/apps/" + id + "/git/"
	requests := remote.Requests.Load()
	c.f.call("POST", "/api/projects/"+c.projectID+"/members", c.admin, map[string]string{"userId": c.dev.ID, "role": "viewer"}, 201)
	assertCode(t, c.f.call("GET", base+"branches", c.developer, nil, 403), "permission_denied")
	outsider := c.f.account("outsider@example.test", false)
	c.f.call("GET", base+"commits?ref=main", c.f.login(outsider.Email), nil, 404)
	if remote.Requests.Load() != requests {
		t.Fatal("unauthorized query reached Git")
	}
	c.f.call("POST", "/api/projects/"+c.projectID+"/members", c.admin, map[string]string{"userId": c.dev.ID, "role": "developer"}, 201)
	actor, err := c.f.auth.Authenticate(context.Background(), c.developer)
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	remote.Before = func(r *http.Request) {
		once.Do(func() { close(entered) })
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	done := make(chan error, 1)
	go func() {
		_, err := s.GitBranches(context.Background(), actor, id, application.GitQuery{Limit: 20})
		done <- err
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("Git query did not start")
	}
	c.f.call("DELETE", "/api/projects/"+c.projectID+"/members/"+c.dev.ID, c.admin, nil, 204)
	close(release)
	select {
	case err := <-done:
		var api *httpx.Error
		if !errors.As(err, &api) || api.Status != 404 {
			t.Fatal("revoked Git result escaped", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Git query held authorization locks during network I/O")
	}
}

func TestGitConfigChangeDuringNetworkAndReaderBoundaries(t *testing.T) {
	c, remote, s, id := setupGit(t)
	saveGit(t, c, id, remote.URL(), 0, nil)
	actor, err := c.f.auth.Authenticate(context.Background(), c.developer)
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	remote.Before = func(r *http.Request) {
		once.Do(func() { close(entered) })
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	done := make(chan error, 1)
	go func() {
		_, err := s.GitCommits(context.Background(), actor, id, application.GitQuery{Ref: "main", Limit: 20})
		done <- err
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("Git query did not start")
	}
	saveGit(t, c, id, remote.URL(), 1, nil)
	close(release)
	select {
	case err := <-done:
		var api *httpx.Error
		if !errors.As(err, &api) || api.Code != "revision_conflict" {
			t.Fatal("stale config result escaped", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Git query did not complete")
	}
	reader := gitremote.New(remote.Server.Client())
	for _, branch := range []string{"bad.lock", "a/.hidden", "a//b", "a\x01b", "a@{b", "../main"} {
		if gitremote.ValidBranch(branch) {
			t.Fatal("invalid branch accepted", branch)
		}
	}
	for _, repository := range []string{"file:///tmp/repo", "http://localhost/repo", "https://user:secret@example.test/repo"} {
		if _, err := reader.Branches(context.Background(), gitremote.Source{URL: repository}); err == nil {
			t.Fatal("unsafe repository URL accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := reader.Branches(ctx, gitremote.Source{URL: remote.URL()}); err == nil {
		t.Fatal("cancellation ignored")
	}
	// Redirects are refused even when a fixture HTTP client trusts both endpoints.
	redirect := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, remote.URL()+"/info/refs?service=git-upload-pack", http.StatusFound)
	}))
	defer redirect.Close()
	before := remote.Requests.Load()
	_, err = gitremote.New(redirect.Client()).Branches(context.Background(), gitremote.Source{URL: redirect.URL + "/repo.git", Username: "git", Token: "fixture-private-token"})
	if err == nil || remote.Requests.Load() != before {
		t.Fatal("authenticated redirect was followed")
	}
}

func TestGitReaderPackBudgetAndTLSVerification(t *testing.T) {
	remote := gitfixture.New(t)
	reader := gitremote.New(remote.Server.Client())
	remote.PackOverride = make([]byte, 12)
	copy(remote.PackOverride, "PACK")
	binary.BigEndian.PutUint32(remote.PackOverride[4:], 2)
	binary.BigEndian.PutUint32(remote.PackOverride[8:], 50001)
	_, _, err := reader.Commits(context.Background(), gitremote.Source{URL: remote.URL()}, "main")
	var api *httpx.Error
	if !errors.As(err, &api) || api.Code != "git_query_limit" {
		t.Fatal("pack budget not enforced", err)
	}
	// Production readers use host trust and reject the fixture's self-signed CA.
	_, err = gitremote.New(nil).Branches(context.Background(), gitremote.Source{URL: remote.URL()})
	if !errors.As(err, &api) || api.Code != "git_unavailable" {
		t.Fatal("TLS verification bypassed", err)
	}
}

func TestGitReaderMergeFilterDeltaAndTimeout(t *testing.T) {
	remote := gitfixture.New(t)
	remote.UseMerge.Store(true)
	remote.AdvertiseFilter.Store(true)
	reader := gitremote.New(remote.Server.Client())
	commits, head, err := reader.Commits(context.Background(), gitremote.Source{URL: remote.URL()}, "main")
	if err != nil || len(commits) != 5 || head != remote.Merge.String() || !remote.SawFilter.Load() {
		t.Fatal("merge graph or filter negotiation failed", err)
	}
	seen := map[string]bool{}
	for _, c := range commits {
		if seen[c.SHA] {
			t.Fatal("duplicate shared ancestor")
		}
		seen[c.SHA] = true
	}
	if !seen[remote.Feature.String()] {
		t.Fatal("merge second parent omitted")
	}
	remote.Before = func(r *http.Request) { <-r.Context().Done() }
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err = reader.Branches(ctx, gitremote.Source{URL: remote.URL()})
	var api *httpx.Error
	if !errors.As(err, &api) || api.Code != "git_unavailable" {
		t.Fatal("remote timeout not classified", err)
	}
}
