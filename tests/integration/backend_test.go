package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/bootstrap"
	"github.com/xuzuxing/podry/internal/config"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/idempotency"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
	"github.com/xuzuxing/podry/internal/server"
)

const testPassword = "podry-test-password-2026"
const testJWT = "only-for-isolated-integration-tests-2026"

// Every test owns a random database, never truncates or migrates the supplied database.
func testDatabase(t *testing.T) (string, *pgxpool.Pool) {
	t.Helper()
	return isolatedDatabase(t, true)
}

func isolatedDatabase(t *testing.T, migrate bool) (string, *pgxpool.Pool) {
	t.Helper()
	base := os.Getenv("PODRY_TEST_DATABASE_URL")
	if base == "" {
		t.Skip("PODRY_TEST_DATABASE_URL is required for real PostgreSQL integration tests")
	}
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, base)
	if err != nil {
		t.Fatal("test database URL is invalid")
	}
	name := "podry_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = owner.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
		owner.Close()
		t.Fatal("test role must be able to create an isolated database")
	}
	u, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	dsn := u.String()
	t.Cleanup(func() {
		_, _ = owner.Exec(context.Background(), "DROP DATABASE "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)")
		owner.Close()
	})
	if migrate {
		if err = database.Migrate(dsn, false); err != nil {
			t.Fatal(err)
		}
	}
	pool, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return dsn, pool
}

type fixture struct {
	t       *testing.T
	dsn     string
	pool    *pgxpool.Pool
	auth    *auth.Service
	handler http.Handler
	cfg     config.Config
}

func setup(t *testing.T) *fixture {
	dsn, pool := testDatabase(t)
	cfg := config.Config{DatabaseURL: dsn, JWTSecret: testJWT, JWTAccessTokenExpire: "15m", CredentialKey: testCredentialKey}
	runtime, err := bootstrap.Open(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(runtime.Pool.Close)
	return &fixture{t, dsn, pool, runtime.Dependencies.Auth, server.New(fstest.MapFS{"index.html": {Data: []byte("<html>test frontend</html>")}}, runtime.Dependencies), cfg}
}
func (f *fixture) command(args []string, password string) (auth.User, error) {
	var out bytes.Buffer
	handled, err := bootstrap.RunCommand(context.Background(), f.cfg, args, strings.NewReader(password+"\n"), &out)
	if !handled && err == nil {
		return auth.User{}, errors.New("command was not handled")
	}
	if err != nil {
		return auth.User{}, err
	}
	var user auth.User
	err = json.Unmarshal(out.Bytes(), &user)
	return user, err
}
func (f *fixture) account(email string, admin bool) auth.User {
	f.t.Helper()
	args := []string{"users", "create"}
	if admin {
		args = []string{"admin", "init"}
	}
	args = append(args, "--email", email, "--name", email, "--password-stdin")
	user, err := f.command(args, testPassword)
	if err != nil {
		f.t.Fatal(err)
	}
	return user
}
func (f *fixture) call(method, path, token string, body any, want int) json.RawMessage {
	f.t.Helper()
	var data []byte
	var err error
	if body != nil {
		data, err = json.Marshal(body)
		if err != nil {
			f.t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	req.RemoteAddr = "127.0.0.1:20000"
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, req)
	if recorder.Code != want {
		f.t.Fatalf("%s %s: got %d, want %d; %s", method, path, recorder.Code, want, recorder.Body.String())
	}
	if strings.HasPrefix(path, "/api") {
		if recorder.Header().Get("X-Request-ID") == "" {
			f.t.Fatal("missing X-Request-ID")
		}
		if want != 204 && !strings.HasPrefix(recorder.Header().Get("Content-Type"), "application/json") {
			f.t.Fatal("API returned non-JSON response")
		}
	}
	return recorder.Body.Bytes()
}
func (f *fixture) login(email string) string {
	f.t.Helper()
	data := f.call("POST", "/api/auth/login", "", map[string]string{"email": email, "password": testPassword}, 200)
	var result auth.LoginResult
	if err := json.Unmarshal(data, &result); err != nil {
		f.t.Fatal(err)
	}
	if result.AccessToken == "" || result.ExpiresAt.Before(time.Now()) {
		f.t.Fatal("missing valid access token")
	}
	return result.AccessToken
}
func decode[T any](t *testing.T, data []byte) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}
func assertCode(t *testing.T, data []byte, code string) {
	t.Helper()
	var out struct {
		Error struct {
			Code string `json:"code"`
		}
	}
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	if out.Error.Code != code {
		t.Fatalf("error code = %q, want %q", out.Error.Code, code)
	}
}

func TestAccountLifecycleAndHTTPBoundary(t *testing.T) {
	f := setup(t)
	t.Log("runtime opened")
	admin := f.account("ADMIN@example.test", true)
	t.Log("administrator initialized")
	if admin.Email != "admin@example.test" || !admin.IsSuperAdmin {
		t.Fatal("administrator normalization failed")
	}
	if _, err := f.command([]string{"admin", "init", "--email", "other@example.test", "--name", "Other", "--password-stdin"}, testPassword); err == nil {
		t.Fatal("repeated initialization succeeded")
	}
	user := f.account("developer@example.test", false)
	if user.IsSuperAdmin {
		t.Fatal("ordinary user became admin")
	}
	token := f.login(admin.Email)
	f.call("GET", "/api/auth/me", token, nil, 200)
	assertCode(t, f.call("POST", "/api/auth/login", "", map[string]string{"email": user.Email, "password": "incorrect"}, 401), "invalid_credentials")
	f.call("POST", "/api/auth/logout", token, nil, 204)
	f.call("GET", "/api/auth/me", token, nil, 401)
	token = f.login(user.Email)
	if _, err := f.command([]string{"users", "reset-password", "--email", user.Email, "--password-stdin"}, testPassword+"-new"); err != nil {
		t.Fatal(err)
	}
	f.call("GET", "/api/auth/me", token, nil, 401)
	result, err := f.auth.Login(context.Background(), auth.LoginInput{Email: user.Email, Password: testPassword + "-new"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.command([]string{"users", "disable", "--email", user.Email}, ""); err != nil {
		t.Fatal(err)
	}
	f.call("GET", "/api/auth/me", result.AccessToken, nil, 401)
	if _, err = f.command([]string{"users", "disable", "--email", admin.Email}, ""); err == nil {
		t.Fatal("disabled the last platform administrator")
	}
	f.call("GET", "/api/no-such-endpoint", "", nil, 404)
	f.call("POST", "/api/apps/no-such-app/cancel", "", nil, 401)
	f.call("GET", "/api", "", nil, 404)
	f.call("GET", "/api/", "", nil, 404)
	f.call("GET", "/some/spa/page", "", nil, 200)
	f.call("GET", "/assets/missing.js", "", nil, 404)
	f.call("DELETE", "/api/auth/login", "", nil, 405)
	token = f.login(admin.Email)
	f.call("POST", "/api/apps/"+uuid.NewString()+"/cancel", token, nil, 404)
	for _, raw := range []string{`null`, `[]`, `{"name":"one","name":"two"}`, `{"name":"one","unknown":true}`, `{"name":"one"} {}`, `{"Name":"wrong case"}`, `{"name":null}`} {
		req := httptest.NewRequest("POST", "/api/teams", strings.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		f.handler.ServeHTTP(rec, req)
		if rec.Code != 422 {
			t.Fatalf("invalid JSON accepted with status %d", rec.Code)
		}
	}
	req := httptest.NewRequest("POST", "/api/teams", strings.NewReader(strings.Repeat("x", (1<<20)+1)))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	if rec.Code != 413 {
		t.Fatalf("oversized body status %d", rec.Code)
	}
	var hashes int
	if err = f.pool.QueryRow(context.Background(), "SELECT count(*) FROM users WHERE password_hash LIKE '$2a$%' OR password_hash LIKE '$2b$%'").Scan(&hashes); err != nil || hashes != 2 {
		t.Fatal("passwords were not persisted as bcrypt hashes")
	}
	audit := string(f.call("GET", "/api/audit-events?pageSize=100", token, nil, 200))
	if strings.Contains(audit, testPassword) || strings.Contains(audit, "password_hash") || strings.Contains(audit, result.AccessToken) {
		t.Fatal("sensitive data in audit")
	}
}

func TestTokenValidationAndLoginRateLimit(t *testing.T) {
	f := setup(t)
	admin := f.account("admin@example.test", true)
	base := jwt.MapClaims{"sub": admin.ID, "ver": 1, "iss": "podry", "aud": "podry-api", "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix()}
	for _, test := range []struct {
		name   string
		method jwt.SigningMethod
		change func(jwt.MapClaims)
	}{
		{"different algorithm", jwt.SigningMethodHS384, func(jwt.MapClaims) {}},
		{"expired", jwt.SigningMethodHS256, func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Minute).Unix() }},
		{"missing expiry", jwt.SigningMethodHS256, func(c jwt.MapClaims) { delete(c, "exp") }},
		{"wrong audience", jwt.SigningMethodHS256, func(c jwt.MapClaims) { c["aud"] = "different-api" }},
		{"wrong issuer", jwt.SigningMethodHS256, func(c jwt.MapClaims) { c["iss"] = "different-issuer" }},
		{"wrong version", jwt.SigningMethodHS256, func(c jwt.MapClaims) { c["ver"] = 2 }},
	} {
		t.Run(test.name, func(t *testing.T) {
			c := jwt.MapClaims{}
			for k, v := range base {
				c[k] = v
			}
			test.change(c)
			signed, err := jwt.NewWithClaims(test.method, c).SignedString([]byte(testJWT))
			if err != nil {
				t.Fatal(err)
			}
			f.call("GET", "/api/auth/me", signed, nil, 401)
		})
	}
	for i := range 11 {
		req := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"email":"unknown@example.test","password":"incorrect"}`))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = "127.0.0.2:12345"
		// Forwarded headers must not manufacture new login buckets.
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("10.0.0.%d", i))
		rec := httptest.NewRecorder()
		f.handler.ServeHTTP(rec, req)
		want := 401
		if i == 10 {
			want = 429
		}
		if rec.Code != want {
			t.Fatalf("attempt %d status %d, want %d", i, rec.Code, want)
		}
		if i == 10 {
			assertCode(t, rec.Body.Bytes(), "rate_limited")
		}
	}
}

func TestConcurrentMembershipRevocationRechecksAuthorization(t *testing.T) {
	f := setup(t)
	admin := f.account("admin@example.test", true)
	alice := f.account("alice@example.test", false)
	bob := f.account("bob@example.test", false)
	root := f.login(admin.Email)
	aToken := f.login(alice.Email)
	bToken := f.login(bob.Email)
	team := decode[project.Team](t, f.call("POST", "/api/teams", root, map[string]string{"name": "concurrency"}, 201))
	f.call("POST", "/api/teams/"+team.ID+"/members", root, project.Member{UserID: alice.ID, Role: "admin"}, 201)
	f.call("POST", "/api/teams/"+team.ID+"/members", root, project.Member{UserID: bob.ID, Role: "admin"}, 201)
	f.call("DELETE", "/api/teams/"+team.ID+"/members/"+admin.ID, root, nil, 204)
	a, err := f.auth.Authenticate(context.Background(), aToken)
	if err != nil {
		t.Fatal(err)
	}
	b, err := f.auth.Authenticate(context.Background(), bToken)
	if err != nil {
		t.Fatal(err)
	}
	service := project.New(f.pool)
	start := make(chan struct{})
	out := make(chan error, 2)
	for _, item := range []struct {
		actor auth.Actor
		other string
	}{{a, bob.ID}, {b, alice.ID}} {
		go func() {
			<-start
			out <- service.ChangeMember(context.Background(), item.actor, "teams", team.ID, project.Member{UserID: item.other}, true, "concurrent-test")
		}()
	}
	close(start)
	success := 0
	for range 2 {
		if err := <-out; err == nil {
			success++
		} else {
			var api *httpx.Error
			if !errors.As(err, &api) || api.Status != 404 {
				t.Errorf("unexpected concurrent error: %v", err)
			}
		}
	}
	if success != 1 {
		t.Fatalf("successful conflicting removals = %d, want 1", success)
	}
	count, err := sqlcdb.New(f.pool).CountTeamAdmins(context.Background(), team.ID)
	if err != nil || count != 1 {
		t.Fatal("concurrent removals lost the final administrator")
	}
}

func TestTeamsProjectsPermissionsAndRevocation(t *testing.T) {
	f := setup(t)
	admin := f.account("admin@example.test", true)
	alice := f.account("alice@example.test", false)
	bob := f.account("bob@example.test", false)
	viewer := f.account("viewer@example.test", false)
	root := f.login(admin.Email)
	a := f.login(alice.Email)
	b := f.login(bob.Email)
	v := f.login(viewer.Email)
	teamA := decode[project.Team](t, f.call("POST", "/api/teams", root, map[string]string{"name": "A"}, 201))
	teamB := decode[project.Team](t, f.call("POST", "/api/teams", root, map[string]string{"name": "B"}, 201))
	f.call("POST", "/api/teams", a, map[string]string{"name": "forbidden"}, 403)
	f.call("POST", "/api/teams", root, map[string]string{"name": "A"}, 409)
	f.call("POST", "/api/teams/"+teamA.ID+"/members", root, project.Member{UserID: alice.ID, Role: "admin"}, 201)
	f.call("POST", "/api/teams/"+teamB.ID+"/members", root, project.Member{UserID: bob.ID, Role: "admin"}, 201)
	f.call("POST", "/api/teams/"+teamA.ID+"/members", a, project.Member{UserID: viewer.ID, Role: "viewer"}, 201)
	f.call("POST", "/api/teams/"+teamA.ID+"/members", a, project.Member{UserID: uuid.NewString(), Role: "developer"}, 404)
	pA := decode[project.Project](t, f.call("POST", "/api/projects", a, map[string]string{"teamId": teamA.ID, "name": "project-a"}, 201))
	pB := decode[project.Project](t, f.call("POST", "/api/projects", b, map[string]string{"teamId": teamB.ID, "name": "project-b"}, 201))
	f.call("POST", "/api/projects", b, map[string]string{"teamId": teamA.ID, "name": "intruder"}, 404)
	f.call("GET", "/api/projects/"+pA.ID+"/members", b, nil, 404)
	f.call("POST", "/api/projects/"+pA.ID+"/members", a, project.Member{UserID: bob.ID, Role: "admin"}, 422)
	f.call("POST", "/api/projects/"+pA.ID+"/members", a, project.Member{UserID: viewer.ID, Role: "viewer"}, 201)
	projects := decode[[]project.Project](t, f.call("GET", "/api/projects", v, nil, 200))
	if len(projects) != 1 || projects[0].ID != pA.ID {
		t.Fatal("project list leaked outside membership")
	}
	f.call("GET", "/api/projects/"+pA.ID+"/members", v, nil, 403)
	f.call("GET", "/api/audit-events?projectId="+pB.ID, a, nil, 404)
	events := string(f.call("GET", "/api/audit-events", a, nil, 200))
	if strings.Contains(events, pB.ID) || strings.Contains(events, teamB.ID) {
		t.Fatal("cross-team audit leak")
	}
	f.call("GET", "/api/audit-events?pageSize=101", a, nil, 422)
	f.call("GET", "/api/teams/not-a-uuid/members", a, nil, 422)
	f.call("DELETE", "/api/teams/"+teamA.ID+"/members/"+viewer.ID, a, nil, 204)
	projects = decode[[]project.Project](t, f.call("GET", "/api/projects", v, nil, 200))
	if len(projects) != 0 {
		t.Fatal("team removal did not revoke project access")
	}
	var dangling int
	if err := f.pool.QueryRow(context.Background(), "SELECT count(*) FROM project_members WHERE user_id=$1", viewer.ID).Scan(&dangling); err != nil || dangling != 0 {
		t.Fatal("project memberships were not removed")
	}
	f.call("DELETE", "/api/teams/"+teamA.ID+"/members/"+admin.ID, a, nil, 204)
	assertCode(t, f.call("DELETE", "/api/teams/"+teamA.ID+"/members/"+alice.ID, a, nil, 409), "last_admin")
}

func TestIdempotencyConcurrentTransactionsAndRollback(t *testing.T) {
	f := setup(t)
	admin := f.account("admin@example.test", true)
	ctx := context.Background()
	var calls atomic.Int64
	run := func(key string, input any, fail bool) (idempotency.Result, error) {
		return database.Tx(ctx, f.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
			return idempotency.Execute(ctx, q, admin.ID, "test.create", key, "POST", "/api/test", input, func() (idempotency.Result, error) {
				calls.Add(1)
				team, err := q.CreateTeam(ctx, "concurrent-"+key)
				if err != nil {
					return idempotency.Result{}, err
				}
				if fail {
					return idempotency.Result{}, errors.New("injected failure after business insert")
				}
				return idempotency.Result{Status: 201, Body: json.RawMessage(`{"id":"` + team.ID + `"}`)}, nil
			})
		})
	}
	var wg sync.WaitGroup
	errs := make(chan error, 12)
	results := make(chan idempotency.Result, 12)
	for range 12 {
		wg.Go(func() {
			r, e := run("same-key-001", map[string]string{"name": "one"}, false)
			if e != nil {
				errs <- e
			} else {
				results <- r
			}
		})
	}
	wg.Wait()
	close(errs)
	close(results)
	for e := range errs {
		t.Error(e)
	}
	if calls.Load() != 1 {
		t.Fatalf("concurrent business executions = %d, want 1", calls.Load())
	}
	var first string
	for r := range results {
		// jsonb can change whitespace; replay must preserve the JSON result.
		normalized, err := json.Marshal(decode[map[string]any](t, r.Body))
		if err != nil {
			t.Fatal(err)
		}
		if first == "" {
			first = string(normalized)
		}
		if string(normalized) != first {
			t.Fatal("concurrent replay differs")
		}
	}
	_, err := run("same-key-001", map[string]string{"name": "different"}, false)
	var api *httpx.Error
	if !errors.As(err, &api) || api.Code != "idempotency_conflict" {
		t.Fatal("hash conflict was not rejected")
	}
	_, err = run("rollback-key", map[string]string{"name": "two"}, true)
	if err == nil {
		t.Fatal("failure injection did not fail")
	}
	var count int
	if e := f.pool.QueryRow(ctx, "SELECT count(*) FROM teams WHERE name='concurrent-rollback-key'").Scan(&count); e != nil || count != 0 {
		t.Fatal("business mutation survived rollback")
	}
	if _, err = run("rollback-key", map[string]string{"name": "two"}, false); err != nil {
		t.Fatal("rolled back reservation blocked retry", err)
	}
}

func TestMigrationsConstraintsAndTransactionalAudit(t *testing.T) {
	dsn, pool := testDatabase(t)
	ctx := context.Background()
	if err := database.Migrate(dsn, false); err != nil {
		t.Fatal("migrations are not repeatable", err)
	}
	if err := database.CheckSchema(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err := database.Migrate(dsn, true); err != nil {
		t.Fatal(err)
	}
	if err := database.Migrate(dsn, false); err != nil {
		t.Fatal("up after down", err)
	}
	s := auth.New(pool, testJWT, 15*time.Minute)
	user, err := s.CreateUser(ctx, "admin@example.test", "Admin", testPassword, true)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, "INSERT INTO teams(name) VALUES('')")
	if err == nil {
		t.Fatal("invalid team name bypassed database constraint")
	}
	_, err = pool.Exec(ctx, "INSERT INTO users(email,name,password_hash) VALUES('UPPER@example.test','Invalid','hash')")
	if err == nil {
		t.Fatal("non-normalized email bypassed constraint")
	}
	_, err = database.Tx(ctx, pool, func(q *sqlcdb.Queries) (bool, error) {
		team, e := q.CreateTeam(ctx, "rollback-audit")
		if e != nil {
			return false, e
		}
		e = q.RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &user.ID, TeamID: &team.ID, Action: "test.rollback", Target: []byte(`{}`), RequestID: "test", Result: "succeeded"})
		if e != nil {
			return false, e
		}
		return false, fmt.Errorf("abort transaction")
	})
	if err == nil {
		t.Fatal("injection did not fail")
	}
	var count int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM audit_events WHERE action='test.rollback'").Scan(&count); err != nil || count != 0 {
		t.Fatal("audit survived failed business transaction")
	}
	// The server never creates schemas on startup.
	if _, err = pool.Exec(ctx, "UPDATE schema_migrations SET dirty=true"); err != nil {
		t.Fatal(err)
	}
	if _, err = bootstrap.Open(ctx, config.Config{DatabaseURL: dsn, JWTSecret: testJWT, JWTAccessTokenExpire: "15m"}); err == nil {
		t.Fatal("server started with dirty migrations")
	}
}

func TestServiceRoleCannotRunDDL(t *testing.T) {
	dsn, owner := testDatabase(t)
	ctx := context.Background()
	role := "podry_service_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	password := uuid.NewString()
	quoted := pgx.Identifier{role}.Sanitize()
	if _, err := owner.Exec(ctx, "CREATE ROLE "+quoted+" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+password+"'"); err != nil {
		t.Fatal("create isolated service role failed")
	}
	t.Cleanup(func() {
		_, _ = owner.Exec(context.Background(), "DROP OWNED BY "+quoted)
		_, _ = owner.Exec(context.Background(), "DROP ROLE "+quoted)
	})
	for _, sql := range []string{
		"GRANT USAGE ON SCHEMA public TO " + quoted,
		"GRANT SELECT ON ALL TABLES IN SCHEMA public TO " + quoted,
		"GRANT INSERT,UPDATE ON users TO " + quoted,
		"GRANT INSERT,UPDATE,DELETE ON teams,team_members,projects,project_members,idempotency_records TO " + quoted,
		"GRANT INSERT ON audit_events TO " + quoted,
		"GRANT INSERT ON release_snapshots TO " + quoted,
		"GRANT INSERT,UPDATE ON release_requests,deployments,deployment_resources TO " + quoted,
		"GRANT INSERT,UPDATE ON binding_observations TO " + quoted,
		"GRANT INSERT,UPDATE ON deployment_previews TO " + quoted,
		"GRANT INSERT,UPDATE ON credentials,clusters,applications,app_environment_bindings TO " + quoted,
		"GRANT INSERT ON secret_versions,registries,environments,app_config_versions TO " + quoted,
		"GRANT INSERT,UPDATE ON deployment_targets TO " + quoted,
		"GRANT INSERT,UPDATE,DELETE ON resource_grants,pipelines TO " + quoted,
	} {
		if _, err := owner.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	u.User = url.UserPassword(role, password)
	serviceURL := u.String()
	runtime, err := bootstrap.Open(ctx, config.Config{DatabaseURL: serviceURL, JWTSecret: testJWT, JWTAccessTokenExpire: "15m", CredentialKey: testCredentialKey})
	if err != nil {
		t.Fatal("service role startup failed")
	}
	t.Cleanup(runtime.Pool.Close)
	user, err := runtime.Dependencies.Auth.CreateUser(ctx, "service-role@example.test", "Admin", testPassword, true)
	if err != nil {
		t.Fatal("service role account command failed")
	}
	login, err := runtime.Dependencies.Auth.Login(ctx, auth.LoginInput{Email: user.Email, Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	actor, err := runtime.Dependencies.Auth.Authenticate(ctx, login.AccessToken)
	if err != nil {
		t.Fatal(err)
	}
	team, err := runtime.Dependencies.Project.CreateTeam(ctx, actor, "service-role-team", "service-role-test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = runtime.Dependencies.Platform.CreateCredential(ctx, actor, platform.CredentialInput{Name: "service-secret", Kind: "secret", Payload: map[string]any{"data": map[string]any{"PASSWORD": "isolated-secret"}}}, "service-role-test"); err != nil {
		t.Fatal("service credential transaction", err)
	}
	proj, err := runtime.Dependencies.Project.CreateProject(ctx, actor, team.ID, "service-project", "service-role-test")
	if err != nil {
		t.Fatal(err)
	}
	app, err := runtime.Dependencies.Application.Create(ctx, actor, application.ApplicationInput{ProjectID: proj.ID, Name: "service-app", SourceMode: "git"}, "service-role-test")
	if err != nil {
		t.Fatal(err)
	}
	initialVersion := int32(0)
	if _, err = runtime.Dependencies.Application.SaveConfig(ctx, actor, app.ID, application.ConfigInput{ExpectedVersion: &initialVersion, Section: "git", GitConfig: &application.GitConfig{RepositoryURL: "https://git.example.test/service.git", Branch: "main", AccountMode: "public"}}, "service-role-test"); err != nil {
		t.Fatal("service configuration trigger", err)
	}
	if _, err = runtime.Dependencies.Application.GetConfig(ctx, actor, app.ID, 0); err != nil {
		t.Fatal("service configuration shared lock", err)
	}
	if _, err = runtime.Pool.Exec(ctx, "CREATE TABLE forbidden_ddl(id integer)"); err == nil {
		t.Fatal("service role can create tables")
	}
	if _, err = runtime.Pool.Exec(ctx, "DELETE FROM audit_events"); err == nil {
		t.Fatal("service role can delete audit history")
	}
	if err = database.Migrate(serviceURL, true); err == nil {
		t.Fatal("service role can downgrade migrations")
	}
	if err = database.CheckSchema(ctx, owner); err != nil {
		t.Fatal("service migration attempt changed schema")
	}
}

func TestCompiledServerCLIAndHTTP(t *testing.T) {
	binary := os.Getenv("PODRY_TEST_BINARY")
	if binary == "" {
		t.Skip("PODRY_TEST_BINARY is required for compiled binary smoke")
	}
	dsn, _ := testDatabase(t)
	commandEnv := append(os.Environ(), "DATABASE_URL="+dsn, "DATABASE_MIGRATION_URL="+dsn, "JWT_SECRET="+testJWT, "JWT_ACCESS_TOKEN_EXPIRE=15m")
	invoke := func(stdin string, args ...string) []byte {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, binary, args...)
		cmd.Env = commandEnv
		cmd.Stdin = strings.NewReader(stdin)
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("compiled command %s failed", args[0])
		}
		return out
	}
	if out := invoke("", "--help"); !bytes.Contains(out, []byte("admin init")) {
		t.Fatal("binary CLI is missing account commands")
	}
	invoke("", "migrate", "up")
	user := decode[auth.User](t, invoke(testPassword+"\n", "admin", "init", "--email", "binary@example.test", "--name", "Binary Admin", "--password-stdin"))
	if !user.IsSuperAdmin {
		t.Fatal("compiled init did not create administrator")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	listener.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, "serve")
	cmd.Env = append(commandEnv, "PODRY_SERVER_ADDR="+addr)
	logFile, err := os.CreateTemp(t.TempDir(), "server-*.log")
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err = cmd.Start(); err != nil {
		logFile.Close()
		t.Fatal("compiled server could not start")
	}
	processDone := make(chan error, 1)
	go func() { processDone <- cmd.Wait() }()
	stopped := false
	defer func() {
		if !stopped {
			_ = cmd.Process.Kill()
			<-processDone
		}
		_ = logFile.Close()
	}()
	client := &http.Client{Timeout: 2 * time.Second}
	baseURL := "http://" + addr
	ready := false
	for range 50 {
		resp, err := client.Get(baseURL + "/api/unknown")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 404 {
				ready = true
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !ready {
		output, _ := os.ReadFile(logFile.Name())
		t.Fatalf("compiled API did not become available: %s", output)
	}
	do := func(method, path, token string, input any, want int) []byte {
		t.Helper()
		data, _ := json.Marshal(input)
		req, err := http.NewRequest(method, baseURL+path, bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal("compiled API request failed")
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != want {
			t.Fatalf("compiled %s %s status %d, want %d", method, path, resp.StatusCode, want)
		}
		return body
	}
	login := decode[auth.LoginResult](t, do("POST", "/api/auth/login", "", auth.LoginInput{Email: user.Email, Password: testPassword}, 200))
	team := decode[project.Team](t, do("POST", "/api/teams", login.AccessToken, map[string]string{"name": "binary-team"}, 201))
	do("POST", "/api/projects", login.AccessToken, map[string]string{"teamId": team.ID, "name": "binary-project"}, 201)
	do("GET", "/api/projects", login.AccessToken, nil, 200)
	do("POST", "/api/auth/logout", login.AccessToken, nil, 204)
	do("GET", "/api/auth/me", login.AccessToken, nil, 401)
	if err := cmd.Process.Signal(os.Interrupt); err != nil {
		t.Fatal("could not signal compiled server shutdown")
	}
	select {
	case err := <-processDone:
		stopped = true
		if err != nil {
			t.Fatal("compiled server did not exit cleanly after shutdown signal")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("idle compiled server failed to shut down promptly")
	}
}
