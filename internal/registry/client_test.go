package registry

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/xuzuxing/podry/internal/httpx"
)

const imageMedia = "application/vnd.oci.image.manifest.v1+json"

func imageManifest() string {
	return `{"schemaVersion":2,"mediaType":"` + imageMedia + `","config":{"mediaType":"application/vnd.oci.image.config.v1+json","digest":"sha256:` + strings.Repeat("a", 64) + `","size":2},"layers":[]}`
}
func hash(s string) string { return fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(s))) }
func source(endpoint, reference string) Source {
	return Source{Endpoint: endpoint, ImageRef: strings.TrimPrefix(strings.TrimPrefix(endpoint, "https://"), "http://") + "/team/demo" + reference, AllowHTTP: true}
}
func code(t *testing.T, err error, want string) {
	t.Helper()
	e, ok := err.(*httpx.Error)
	if !ok || e.Code != want {
		t.Fatalf("want %s, got %v", want, err)
	}
}

func TestReference(t *testing.T) {
	for _, ref := range []string{"localhost:5000/team/demo:1.2", "localhost:5000/team/demo", "localhost:5000/team/demo@sha256:" + strings.Repeat("a", 64)} {
		if _, _, err := Reference("http://localhost:5000", ref); err != nil {
			t.Fatal(ref, err)
		}
	}
	for _, ref := range []string{"team/demo:tag", "other:5000/team/demo:tag", "https://localhost:5000/team/demo:tag", "localhost:5000/../demo", "localhost:5000/demo?x=1", "localhost:5000/demo#frag", "localhost:5000/demo%2ftag", "localhost:5000/Demo", "localhost:5000/demo:", "localhost:5000/demo@sha256:bad", "user:pass@localhost:5000/demo", "localhost:5000/demo\\tag"} {
		if _, _, err := Reference("http://localhost:5000", ref); err == nil {
			t.Fatal("accepted", ref)
		}
	}
}

func TestResolvePinsTagAndSupportsIndexAndBasic(t *testing.T) {
	for _, index := range []bool{false, true} {
		body, media := imageManifest(), imageMedia
		if index {
			media = "application/vnd.oci.image.index.v1+json"
			body = `{"schemaVersion":2,"manifests":[{"mediaType":"` + imageMedia + `","digest":"` + hash(body) + `","size":123}]}`
		}
		var requests atomic.Int32
		srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, password, ok := r.BasicAuth()
			if !ok || user != "fixture-user" || password != "fixture-password" {
				w.WriteHeader(401)
				return
			}
			n := requests.Add(1)
			if (n == 1 && r.URL.Path != "/v2/team/demo/manifests/latest") || (n == 2 && r.URL.Path != "/v2/team/demo/manifests/"+hash(body)) {
				t.Error("wrong reference", r.URL.Path)
			}
			w.Header().Set("Content-Type", media)
			w.Header().Set("Docker-Content-Digest", hash(body))
			fmt.Fprint(w, body)
		}))
		s := source(srv.URL, "")
		s.Username, s.Password = "fixture-user", "fixture-password"
		_, err := (&Client{}).Resolve(context.Background(), s)
		code(t, err, "registry_unavailable") // System trust must reject the fixture CA.
		out, err := (&Client{Transport: srv.Client().Transport}).Resolve(context.Background(), s)
		if err != nil || out.Digest != hash(body) || requests.Load() != 2 {
			t.Fatal(out, err, requests.Load())
		}
		srv.Close()
	}
}

func TestResolveBearerAndOriginIsolation(t *testing.T) {
	for _, external := range []bool{false, true} {
		var origin, realm string
		var tokenCalls atomic.Int32
		tokenHandler := func(w http.ResponseWriter, r *http.Request) {
			tokenCalls.Add(1)
			if external && r.Header.Get("Authorization") != "" {
				t.Error("credentials escaped registry origin")
			}
			if !external {
				if u, p, ok := r.BasicAuth(); !ok || u != "reader" || p != "secret" {
					t.Error("same-origin credentials missing")
				}
			}
			if r.URL.Query().Get("scope") != "repository:team/demo:pull" {
				t.Error("incorrect pull scope")
			}
			fmt.Fprint(w, `{"access_token":"fixture-token"}`)
		}
		if external {
			s := httptest.NewTLSServer(http.HandlerFunc(tokenHandler))
			defer s.Close()
			realm = s.URL + "/token"
		}
		srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/token" {
				tokenHandler(w, r)
				return
			}
			if r.Header.Get("Authorization") != "Bearer fixture-token" {
				w.Header().Set("WWW-Authenticate", `Bearer realm="`+realm+`",service="fixture",scope="repository:other:push"`)
				w.WriteHeader(401)
				return
			}
			w.Header().Set("Content-Type", imageMedia)
			fmt.Fprint(w, imageManifest())
		}))
		origin = srv.URL
		if !external {
			realm = origin + "/token"
		}
		s := source(origin, ":tag")
		s.Username, s.Password = "reader", "secret"
		// httptest uses the same test CA for both TLS fixtures.
		_, err := (&Client{Transport: srv.Client().Transport}).Resolve(context.Background(), s)
		if err != nil || tokenCalls.Load() != 1 {
			t.Fatal(err, tokenCalls.Load())
		}
		srv.Close()
	}
}

func TestResolveRejectsInvalidResponsesAndRedirects(t *testing.T) {
	for _, tc := range []struct {
		name, body, media, header, want string
		status                          int
	}{
		{"digest", imageManifest(), imageMedia, "sha256:" + strings.Repeat("b", 64), "artifact_digest_mismatch", 200},
		{"schema", `{"schemaVersion":1}`, imageMedia, "", "registry_manifest_invalid", 200},
		{"config", `{"schemaVersion":2,"config":{},"layers":[]}`, imageMedia, "", "registry_manifest_invalid", 200},
		{"type", imageManifest(), "text/html", "", "registry_manifest_invalid", 200},
		{"large", strings.Repeat(" ", 8<<20+1), imageMedia, "", "registry_unavailable", 200},
		{"missing", "", "", "", "registry_manifest_not_found", 404},
		{"denied", "", "", "", "registry_authentication_failed", 403},
		{"limited", "", "", "", "registry_rate_limited", 429},
		{"redirect", "", "", "", "registry_unavailable", 302},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var hits atomic.Int32
			destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
			defer destination.Close()
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", tc.media)
				w.Header().Set("Docker-Content-Digest", tc.header)
				w.Header().Set("Location", destination.URL)
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}))
			defer srv.Close()
			_, err := (&Client{}).Resolve(context.Background(), source(srv.URL, ":tag"))
			code(t, err, tc.want)
			if hits.Load() != 0 {
				t.Fatal("followed redirect")
			}
		})
	}
}

func TestResolveHTTPPolicyDirectDigestAndCancellation(t *testing.T) {
	body := imageManifest()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", imageMedia)
		fmt.Fprint(w, body)
	}))
	defer srv.Close()
	s := source(srv.URL, "@"+hash(body))
	s.AllowHTTP = false
	if _, err := (&Client{}).Resolve(context.Background(), s); err == nil || calls.Load() != 0 {
		t.Fatal("HTTP policy bypassed")
	}
	s.AllowHTTP = true
	if out, err := (&Client{}).Resolve(context.Background(), s); err != nil || out.Digest != hash(body) || calls.Load() != 1 {
		t.Fatal(out, err)
	}
	s.ImageRef = strings.TrimSuffix(s.ImageRef, hash(body)) + "sha256:" + strings.Repeat("b", 64)
	_, err := (&Client{}).Resolve(context.Background(), s)
	code(t, err, "artifact_digest_mismatch")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = (&Client{}).Resolve(ctx, s)
	code(t, err, "registry_unavailable")
}
