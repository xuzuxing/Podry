package integration_test

import (
	"context"
	"net/url"
	"strings"
	"testing"

	"encoding/json"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/config"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/gitremote"
)

func TestHTTPDevelopmentEndpointPolicy(t *testing.T) {
	policy := credential.URLPolicy{AllowedHTTPHosts: []string{"localhost:3000", "localhost:5000"}}
	for _, raw := range []string{"http://localhost:3000/admin/demo.git", "http://localhost:5000/", "https://git.example.test/demo.git"} {
		if e := policy.Validate(raw, false); e != nil {
			t.Fatalf("rejected approved endpoint %q: %v", raw, e)
		}
	}
	for _, raw := range []string{"http://localhost:3001/demo.git", "http://localhost:3000.evil.test/demo.git", "http://localhost:3000@evil.test/demo.git", "http://user:pass@localhost:3000/demo.git", "http://localhost:3000/demo.git?token=secret", "http://localhost:3000/demo.git#ref", "file:///tmp/repo", "ssh://localhost:3000/demo.git"} {
		if e := policy.Validate(raw, false); e == nil {
			t.Fatalf("accepted unapproved endpoint %q", raw)
		}
	}
	if e := (credential.URLPolicy{}).Validate("http://localhost:3000/demo.git", false); e == nil {
		t.Fatal("HTTP enabled by default")
	}
	if e := credential.HTTPSURL("http://localhost:3000", true); e == nil {
		t.Fatal("Kubernetes HTTPS check was relaxed")
	}
	cfg := config.Config{DatabaseURL: "postgres://unused", JWTSecret: testJWT, JWTAccessTokenExpire: "15m", URLPolicy: policy}
	if e := cfg.ValidateServer(); e != nil {
		t.Fatal(e)
	}
	for _, host := range []string{"*", "*.example.test:3000", "localhost", "localhost:0", "localhost:70000", "localhost:3000/path", "user@localhost:3000"} {
		cfg.URLPolicy.AllowedHTTPHosts = []string{host}
		if cfg.ValidateServer() == nil {
			t.Fatalf("accepted invalid allowlist entry %q", host)
		}
	}
	spec := build.ExecutionSpec{RegistryEndpoint: "http://localhost:5000", ImageRepository: "podry-demo", AttemptID: "demo"}
	if _, e := spec.ImageOutput(); e == nil {
		t.Fatal("runner allowed unapproved HTTP registry")
	}
	spec.RegistryHTTPAllowed = true
	if out, e := spec.ImageOutput(); e != nil || !strings.Contains(out, "registry.insecure=true") {
		t.Fatal("approved HTTP exporter missing", e)
	}
	spec.RegistryEndpoint = "https://registry.example.test"
	if out, e := spec.ImageOutput(); e != nil || strings.Contains(out, "registry.insecure") {
		t.Fatal("HTTPS exporter disabled TLS", e)
	}
}

func TestBuildExplicitHTTPGitAndRegistry(t *testing.T) {
	b := setupBuildWithHTTP(t, true)
	ctx := context.Background()
	b.remote.RequireAuth.Store(true)
	u, _ := url.Parse(b.remote.URL())
	policy := credential.URLPolicy{AllowedHTTPHosts: []string{u.Host}}
	source := gitremote.Source{URL: b.remote.URL(), Username: "git", Token: "fixture-private-token"}
	if _, e := gitremote.New(nil).Branches(ctx, source); e == nil {
		t.Fatal("default reader accepted HTTP")
	}
	if branches, e := gitremote.New(nil).WithURLPolicy(policy).Branches(ctx, source); e != nil || len(branches) != 2 {
		t.Fatal("private HTTP Git failed", e)
	}
	b.remote.RequireAuth.Store(false)
	out := decode[build.Build](t, b.trigger(t, "explicit-http-build", 202))
	rows, e := sqlcdb.New(b.c.f.pool).ListBuildAttempts(ctx, out.ID)
	if e != nil || len(rows) != 1 {
		t.Fatal("attempt missing", e)
	}
	var spec build.ExecutionSpec
	if e = json.Unmarshal(rows[0].ExecutionSpec, &spec); e != nil || !spec.GitHTTPAllowed || !spec.RegistryHTTPAllowed {
		t.Fatal("HTTP endpoint decisions were not frozen", e)
	}
	for range 3 {
		b.step(t)
	}
	b.kube.complete = true
	b.step(t)
	got := decode[build.Build](t, b.c.f.call("GET", "/api/builds/"+out.ID, b.c.developer, nil, 200))
	if got.Status != "succeeded" || got.ArtifactID == nil {
		t.Fatal("HTTP registry digest verification did not succeed")
	}
}
