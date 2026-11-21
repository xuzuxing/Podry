package integration_test

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"github.com/golang-jwt/jwt/v5"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/xuzuxing/podry/internal/audit"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/kubernetes"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
	"github.com/xuzuxing/podry/internal/resource"
	"github.com/xuzuxing/podry/internal/server"
)

type kubeAPI struct {
	server    *httptest.Server
	requests  atomic.Int64
	fail      atomic.Int32
	uid       atomic.Value
	mu        sync.Mutex
	hook      func(*http.Request)
	logGate   chan struct{}
	longLine  atomic.Bool
	logStatus atomic.Int32
}

func newKubeAPI(t *testing.T, mtls bool) *kubeAPI {
	t.Helper()
	k := &kubeAPI{logGate: make(chan struct{})}
	k.uid.Store("pod-1")
	s := httptest.NewUnstartedServer(http.HandlerFunc(k.serve))
	if mtls {
		s.TLS = &tls.Config{ClientAuth: tls.RequireAnyClientCert, MinVersion: tls.VersionTLS12}
	}
	s.StartTLS()
	k.server = s
	t.Cleanup(s.Close)
	return k
}
func (k *kubeAPI) payload(mtls, verify bool) map[string]any {
	p := map[string]any{"apiServer": k.server.URL, "insecureSkipTLSVerify": !verify}
	if verify {
		p["certificateAuthorityData"] = base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: k.server.Certificate().Raw}))
	}
	if mtls {
		key, _ := x509.MarshalPKCS8PrivateKey(k.server.TLS.Certificates[0].PrivateKey)
		p["clientCertificateData"] = base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: k.server.Certificate().Raw}))
		p["clientKeyData"] = base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}))
	} else {
		p["token"] = "fixture-kubernetes-token"
	}
	return p
}
func (k *kubeAPI) serve(w http.ResponseWriter, r *http.Request) {
	k.requests.Add(1)
	if r.Method != "GET" {
		http.Error(w, "read only fixture", 405)
		return
	}
	if r.Header.Get("Authorization") != "Bearer fixture-kubernetes-token" && len(r.TLS.PeerCertificates) == 0 {
		http.Error(w, "denied", 401)
		return
	}
	k.mu.Lock()
	hook := k.hook
	k.mu.Unlock()
	if hook != nil {
		hook(r)
	}
	if code := int(k.fail.Load()); code != 0 {
		http.Error(w, "remote secret must never be returned", code)
		return
	}
	reply := func(v any) { w.Header().Set("Content-Type", "application/json"); _ = json.NewEncoder(w).Encode(v) }
	list := func(items []any, cont string) {
		// Real Kubernetes typed lists omit TypeMeta on individual items.
		for _, v := range items {
			if item, ok := v.(map[string]any); ok {
				delete(item, "apiVersion")
				delete(item, "kind")
			}
		}
		reply(map[string]any{"metadata": map[string]any{"resourceVersion": "77", "continue": cont}, "items": items})
	}
	item := func(name, kind, ns string) map[string]any {
		return map[string]any{"apiVersion": "v1", "kind": kind, "metadata": map[string]any{"name": name, "namespace": ns, "uid": name + "-1", "resourceVersion": "42", "annotations": map[string]any{"kubectl.kubernetes.io/last-applied-configuration": "hidden annotation"}, "managedFields": []any{map[string]any{"manager": "kubectl"}}}, "status": map[string]any{"phase": "Running"}}
	}
	pod := func() map[string]any {
		p := item("web", "Pod", "demo")
		p["metadata"].(map[string]any)["uid"] = k.uid.Load()
		p["metadata"].(map[string]any)["ownerReferences"] = []any{map[string]any{"apiVersion": "apps/v1", "kind": "ReplicaSet", "name": "web-rs", "uid": "rs-1"}}
		p["spec"] = map[string]any{"containers": []any{map[string]any{"name": "app"}}, "initContainers": []any{map[string]any{"name": "setup"}}, "ephemeralContainers": []any{map[string]any{"name": "debugger"}}}
		return p
	}
	apiResources := func(group string, names map[string]string) {
		items := []any{}
		for name, kind := range names {
			items = append(items, map[string]any{"name": name, "kind": kind, "namespaced": name != "nodes" && name != "namespaces", "verbs": []string{"get", "list", "create", "delete"}})
		}
		reply(map[string]any{"groupVersion": group, "resources": items})
	}
	switch r.URL.Path {
	case "/version":
		reply(map[string]string{"gitVersion": "v1.34.1+fixture"})
	case "/api":
		reply(map[string]any{"versions": []string{"v1"}})
	case "/apis":
		reply(map[string]any{"groups": []any{map[string]any{"name": "apps", "preferredVersion": map[string]string{"version": "v1"}}, map[string]any{"name": "example.test", "preferredVersion": map[string]string{"version": "v1"}}}})
	case "/api/v1":
		apiResources("v1", map[string]string{"pods": "Pod", "pods/log": "Pod", "secrets": "Secret", "events": "Event", "nodes": "Node", "namespaces": "Namespace"})
	case "/apis/apps/v1":
		apiResources("apps/v1", map[string]string{"deployments": "Deployment", "replicasets": "ReplicaSet"})
	case "/apis/example.test/v1":
		apiResources("example.test/v1", map[string]string{"widgets": "Widget"})
	case "/api/v1/namespaces":
		list([]any{item("demo", "Namespace", ""), item("hidden", "Namespace", "")}, "")
	case "/api/v1/namespaces/demo":
		reply(item("demo", "Namespace", ""))
	case "/api/v1/nodes":
		list([]any{item("node-1", "Node", "")}, "")
	case "/api/v1/namespaces/demo/pods":
		if r.URL.Query().Get("continue") == "fixture-next" {
			list([]any{}, "")
		} else {
			list([]any{pod()}, "fixture-next")
		}
	case "/api/v1/namespaces/demo/pods/web":
		reply(pod())
	case "/api/v1/namespaces/demo/secrets", "/api/v1/namespaces/demo/secrets/password":
		secret := item("password", "Secret", "demo")
		secret["data"] = map[string]any{"password": "c2VjcmV0LWJ5dGVz"}
		secret["stringData"] = map[string]any{"extra": "plaintext secret"}
		secret["metadata"].(map[string]any)["annotations"].(map[string]any)["custom"] = "plaintext annotation"
		if strings.HasSuffix(r.URL.Path, "/secrets") {
			list([]any{secret}, "")
		} else {
			reply(secret)
		}
	case "/apis/example.test/v1/namespaces/demo/widgets":
		widget := item("one", "Widget", "demo")
		widget["apiVersion"] = "example.test/v1"
		list([]any{widget}, "")
	case "/api/v1/namespaces/demo/events":
		if r.URL.Query().Get("fieldSelector") != "involvedObject.uid="+k.uid.Load().(string) {
			http.Error(w, "missing UID filter", 400)
			return
		}
		list([]any{map[string]any{"type": "Normal", "reason": "Started", "message": "Started app", "count": 2, "lastTimestamp": "2026-11-20T01:00:00Z"}}, "")
	case "/api/v1/namespaces/demo/pods/web/log":
		if code := int(k.logStatus.Load()); code != 0 {
			http.Error(w, "container is waiting to start", code)
			return
		}
		if r.URL.Query().Get("timestamps") != "true" {
			http.Error(w, "timestamps required", 400)
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		if k.longLine.Load() {
			fmt.Fprintln(w, strings.Repeat("x", 65<<10))
			return
		}
		fmt.Fprintln(w, "2026-11-20T01:00:00.000Z hello fixture")
		w.(http.Flusher).Flush()
		if r.URL.Query().Get("follow") == "true" {
			select {
			case <-r.Context().Done():
				return
			case <-k.logGate:
			}
		}
	default:
		http.NotFound(w, r)
	}
}

type kubeFixture struct {
	f                *fixture
	k                *kubeAPI
	admin, developer string
	dev              auth.User
	cluster          platform.Cluster
	credential       platform.Credential
	service          *resource.Service
}

func kubeSetup(t *testing.T, mtls bool) *kubeFixture {
	t.Helper()
	k := newKubeAPI(t, mtls)
	f := setup(t)
	vault, err := credential.New(testCredentialKey)
	if err != nil {
		t.Fatal(err)
	}
	svc := resource.New(f.pool, vault, testJWT)
	svc.RecheckInterval = 40 * time.Millisecond
	f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: f.auth, Project: project.New(f.pool), Platform: platform.New(f.pool, vault), Resource: svc, Audit: audit.New(f.pool)})
	admin := f.account("admin@kubernetes.test", true)
	dev := f.account("dev@kubernetes.test", false)
	at, dt := f.login(admin.Email), f.login(dev.Email)
	c := decode[platform.Credential](t, f.call("POST", "/api/credentials", at, map[string]any{"name": "Kubernetes fixture", "kind": "kubeconfig", "teamId": nil, "payload": k.payload(mtls, false)}, 201))
	cluster := decode[platform.Cluster](t, f.call("POST", "/api/clusters", at, map[string]any{"name": "Kubernetes fixture", "apiServer": k.server.URL, "credentialId": c.ID}, 201))
	return &kubeFixture{f, k, at, dt, dev, cluster, c, svc}
}
func (k *kubeFixture) path(suffix string) string { return "/api/clusters/" + k.cluster.ID + suffix }
func (k *kubeFixture) grant(t *testing.T, namespace string, resources, actions []string) platform.Grant {
	t.Helper()
	return decode[platform.Grant](t, k.f.call("POST", k.path("/resource-grants"), k.admin, map[string]any{"principalType": "user", "principalId": k.dev.ID, "namespace": namespace, "resources": resources, "actions": actions}, 201))
}
func TestKubernetesConnectionMTLSAndTLSOptions(t *testing.T) {
	k := kubeSetup(t, true)
	f := k.f
	result := decode[platform.ConnectionTest](t, f.call("POST", k.path("/connection-tests"), k.admin, nil, 200))
	if result.Status != "connected" || result.ServerVersion == nil {
		t.Fatal("mTLS/skip verification connection failed")
	}
	observed := decode[platform.Cluster](t, f.call("GET", k.path(""), k.admin, nil, 200))
	if observed.ConnectionStatus != "connected" || observed.LastCheckedAt == nil {
		t.Fatal("observation not persisted")
	}
	payload := k.k.payload(true, true)
	f.call("PUT", "/api/credentials/"+k.credential.ID, k.admin, map[string]any{"expectedVersion": 1, "payload": payload}, 200)
	result = decode[platform.ConnectionTest](t, f.call("POST", k.path("/connection-tests"), k.admin, nil, 200))
	if result.Status != "connected" {
		t.Fatal("explicit valid CA failed")
	}
	payload["certificateAuthorityData"] = fakeKubePayload(t)["certificateAuthorityData"]
	f.call("PUT", "/api/credentials/"+k.credential.ID, k.admin, map[string]any{"expectedVersion": 2, "payload": payload}, 200)
	result = decode[platform.ConnectionTest](t, f.call("POST", k.path("/connection-tests"), k.admin, nil, 200))
	if result.Status != "unavailable" {
		t.Fatal("untrusted certificate accepted without skip option")
	}
	payload["insecureSkipTLSVerify"] = true
	f.call("PUT", "/api/credentials/"+k.credential.ID, k.admin, map[string]any{"expectedVersion": 3, "payload": payload}, 200)
	result = decode[platform.ConnectionTest](t, f.call("POST", k.path("/connection-tests"), k.admin, nil, 200))
	if result.Status != "connected" {
		t.Fatal("explicit skip verification did not work")
	}
	before := k.k.requests.Load()
	f.call("POST", k.path("/connection-tests"), k.developer, nil, 403)
	if k.k.requests.Load() != before {
		t.Fatal("unauthorized connection attempt")
	}
	for _, mutate := range []func(map[string]any){func(p map[string]any) { p["token"] = "mixed" }, func(p map[string]any) { delete(p, "clientKeyData") }, func(p map[string]any) { p["insecureSkipTLSVerify"] = "true" }, func(p map[string]any) { p["exec"] = map[string]any{"command": "ignored"} }} {
		p := k.k.payload(true, false)
		mutate(p)
		f.call("POST", "/api/credentials", k.admin, map[string]any{"name": "Invalid", "kind": "kubeconfig", "teamId": nil, "payload": p}, 422)
	}
}
func TestKubernetesResourceAuthorizationDiscoveryAndSecrets(t *testing.T) {
	k := kubeSetup(t, false)
	f := k.f
	before := k.k.requests.Load()
	f.call("GET", k.path("/discovery"), k.developer, nil, 404)
	if before != k.k.requests.Load() {
		t.Fatal("unauthorized discovery contacted cluster")
	}
	k.grant(t, "demo", []string{"core/pods", "core/secrets", "core/events", "example.test/widgets"}, []string{"resource.view", "pod.logs"})
	discovered := decode[[]resource.ResourceType](t, f.call("GET", k.path("/discovery"), k.developer, nil, 200))
	if len(discovered) != 4 {
		t.Fatal("unexpected discovery scope", len(discovered))
	}
	for _, r := range discovered {
		if strings.Contains(r.Resource, "/") || r.Resource == "nodes" {
			t.Fatal("discovery exposed ungranted or subresource type")
		}
	}
	namespaces := decode[[]resource.Namespace](t, f.call("GET", k.path("/namespaces"), k.developer, nil, 200))
	if len(namespaces) != 1 || namespaces[0].Name != "demo" {
		t.Fatal("namespace grant leaked unrelated namespaces")
	}
	base := "?group=&version=v1&resource=pods"
	before = k.k.requests.Load()
	f.call("GET", k.path("/resources")+base+"&namespace=hidden", k.developer, nil, 404)
	f.call("GET", k.path("/resources")+base, k.developer, nil, 404)
	if before != k.k.requests.Load() {
		t.Fatal("unauthorized namespace performed external IO")
	}
	f.call("GET", k.path("/resources?group=example.test&version=v1&resource=widgets&namespace=demo"), k.developer, nil, 200)
	for _, path := range []string{"/resource?group=&version=v1&resource=secrets&namespace=demo&name=password", "/resources?group=&version=v1&resource=secrets&namespace=demo"} {
		raw := f.call("GET", k.path(path), k.developer, nil, 200)
		for _, forbidden := range []string{"c2VjcmV0LWJ5dGVz", "plaintext secret", "plaintext annotation", "hidden annotation", "stringData", "managedFields"} {
			if strings.Contains(string(raw), forbidden) {
				t.Fatal("secret data escaped projection", forbidden)
			}
		}
		if !strings.Contains(string(raw), "password") || !strings.Contains(string(raw), "keys") {
			t.Fatal("secret keys missing")
		}
	}
	raw := f.call("GET", k.path("/resource")+base+"&namespace=demo&name=web&uid=pod-1&resourceVersion=42", k.developer, nil, 200)
	projected := decode[resource.Object](t, raw)
	if len(projected.OwnerRefs) != 1 || projected.OwnerRefs[0].Resource != "replicasets" || projected.OwnerRefs[0].UID != "rs-1" {
		t.Fatal("owner Kind was not mapped through discovery")
	}
	if strings.Contains(string(raw), "last-applied") || strings.Contains(string(raw), "managedFields") {
		t.Fatal("noisy metadata leaked")
	}
	assertCode(t, f.call("GET", k.path("/resource")+base+"&namespace=demo&name=web&uid=old", k.developer, nil, 409), "resource_identity_changed")
	assertCode(t, f.call("GET", k.path("/resource")+base+"&namespace=demo&name=web&resourceVersion=41", k.developer, nil, 409), "resource_version_changed")
	events := decode[[]resource.Event](t, f.call("GET", k.path("/events")+base+"&namespace=demo&name=web&uid=pod-1", k.developer, nil, 200))
	if len(events) != 1 || events[0].Count != 2 || events[0].LastSeenAt == nil {
		t.Fatal("events did not use target UID")
	}
	f.call("GET", k.path("/resources?group=&version=v1&resource=pods/log&namespace=demo"), k.admin, nil, 422)
	f.call("GET", k.path("/resources")+base+"&namespace=demo&namespace=hidden", k.admin, nil, 422)
	k.k.fail.Store(403)
	assertCode(t, f.call("GET", k.path("/resources")+base+"&namespace=demo", k.developer, nil, 403), "kubernetes_forbidden")
	k.k.fail.Store(500)
	assertCode(t, f.call("GET", k.path("/discovery"), k.admin, nil, 503), "cluster_unavailable")
}
func TestKubernetesPaginationScopeAndGrantRevocation(t *testing.T) {
	k := kubeSetup(t, false)
	f := k.f
	grant := k.grant(t, "demo", []string{"core/pods"}, []string{"resource.view"})
	path := k.path("/resources?group=&version=v1&resource=pods&namespace=demo&limit=1")
	first := decode[resource.List](t, f.call("GET", path, k.developer, nil, 200))
	if len(first.Items) != 1 || first.ContinueToken == nil || first.ResourceVersion != "77" {
		t.Fatal("pagination lost Kubernetes cursor or resourceVersion")
	}
	token := url.QueryEscape(*first.ContinueToken)
	next := decode[resource.List](t, f.call("GET", path+"&continueToken="+token, k.developer, nil, 200))
	if len(next.Items) != 0 || next.ContinueToken != nil {
		t.Fatal("upstream continuation not honored")
	}
	for _, suffix := range []string{"&labelSelector=app%3Dother", "&fieldSelector=metadata.name%3Dother"} {
		assertCode(t, f.call("GET", path+suffix+"&continueToken="+token, k.developer, nil, 409), "continue_scope_changed")
	}
	assertCode(t, f.call("GET", path+"&continueToken="+token, k.admin, nil, 409), "continue_scope_changed")
	k.grant(t, "demo", []string{"core/events"}, []string{"resource.view"})
	assertCode(t, f.call("GET", path+"&continueToken="+token, k.developer, nil, 409), "continue_scope_changed")
	f.call("DELETE", k.path("/resource-grants/"+grant.ID), k.admin, nil, 204)
	before := k.k.requests.Load()
	f.call("GET", path, k.developer, nil, 404)
	if before != k.k.requests.Load() {
		t.Fatal("revoked grant contacted remote API")
	}
	k.grant(t, "*", []string{"*"}, []string{"resource.view"})
	var nodeReads atomic.Int64
	k.k.mu.Lock()
	k.k.hook = func(r *http.Request) {
		if r.URL.Path == "/api/v1/nodes" {
			nodeReads.Add(1)
		}
	}
	k.k.mu.Unlock()
	f.call("GET", k.path("/resources?group=&version=v1&resource=nodes"), k.developer, nil, 404)
	if nodeReads.Load() != 0 {
		t.Fatal("namespace wildcard granted cluster scope")
	}
	k.grant(t, "", []string{"core/nodes"}, []string{"resource.view"})
	f.call("GET", k.path("/resources?group=&version=v1&resource=nodes"), k.developer, nil, 200)
}
func TestKubernetesCredentialRotationDuringRead(t *testing.T) {
	k := kubeSetup(t, false)
	f := k.f
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	k.k.mu.Lock()
	k.k.hook = func(r *http.Request) {
		if r.URL.Path == "/api/v1/namespaces/demo/pods/web" {
			once.Do(func() { close(entered); <-release })
		}
	}
	k.k.mu.Unlock()
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		r := httptest.NewRequest("GET", k.path("/resource?group=&version=v1&resource=pods&namespace=demo&name=web"), nil)
		r.Header.Set("Authorization", "Bearer "+k.admin)
		w := httptest.NewRecorder()
		f.handler.ServeHTTP(w, r)
		done <- w
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		close(release)
		t.Fatal("read did not reach remote API")
	}
	f.call("PUT", "/api/credentials/"+k.credential.ID, k.admin, map[string]any{"expectedVersion": 1, "payload": k.k.payload(false, false)}, 200)
	close(release)
	select {
	case w := <-done:
		if w.Code != 409 {
			t.Fatalf("stale result returned after rotation: %d", w.Code)
		}
		assertCode(t, w.Body.Bytes(), "revision_conflict")
	case <-time.After(3 * time.Second):
		t.Fatal("read held DB lock over remote IO")
	}
}
func streamRequest(t *testing.T, k *kubeFixture, token, extra string) (*http.Response, *httptest.Server) {
	t.Helper()
	s := httptest.NewServer(k.f.handler)
	t.Cleanup(s.Close)
	r, _ := http.NewRequest("GET", s.URL+k.path("/pod-logs?namespace=demo&name=web&uid=pod-1&container=app")+extra, nil)
	r.Header.Set("Authorization", "Bearer "+token)
	res, e := s.Client().Do(r)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res, s
}
func TestKubernetesPodLogsAndRevocation(t *testing.T) {
	k := kubeSetup(t, false)
	f := k.f
	grant := k.grant(t, "demo", []string{"core/pods"}, []string{"pod.logs"})
	res, _ := streamRequest(t, k, k.developer, "")
	data, e := io.ReadAll(res.Body)
	res.Body.Close()
	if e != nil || res.StatusCode != 200 || !strings.Contains(string(data), `"type":"log"`) || !strings.Contains(string(data), `"type":"end"`) {
		t.Fatal("bounded log read failed", res.StatusCode, e, string(data))
	}
	if res.Header.Get("Cache-Control") != "no-store" || !strings.HasPrefix(res.Header.Get("Content-Type"), "application/x-ndjson") {
		t.Fatal("log stream headers wrong")
	}
	k.k.logStatus.Store(400)
	assertCode(t, f.call("GET", k.path("/pod-logs?namespace=demo&name=web&uid=pod-1&container=app"), k.developer, nil, 422), "pod_logs_unavailable")
	k.k.logStatus.Store(0)
	base := k.path("/pod-logs?namespace=demo&name=web")
	f.call("GET", base+"&uid=pod-1&container=missing", k.developer, nil, 422)
	f.call("GET", base+"&uid=old&container=app", k.developer, nil, 409)
	for _, suffix := range []string{"&previous=bogus", "&tailLines=10001", "&sinceSeconds=0", "&container=duplicate"} {
		f.call("GET", base+"&uid=pod-1&container=app"+suffix, k.developer, nil, 422)
	}
	res, _ = streamRequest(t, k, k.developer, "&follow=true")
	scanner := bufio.NewScanner(res.Body)
	if !scanner.Scan() {
		t.Fatal("missing initial log")
	}
	f.call("DELETE", k.path("/resource-grants/"+grant.ID), k.admin, nil, 204)
	remaining := make(chan string, 1)
	go func() { b, _ := io.ReadAll(res.Body); remaining <- string(b) }()
	select {
	case b := <-remaining:
		if !strings.Contains(b, `"type":"error"`) {
			t.Fatal("revoked stream did not emit error", b)
		}
	case <-time.After(3 * time.Second):
		res.Body.Close()
		t.Fatal("grant revocation failed to close idle stream")
	}
}

func TestKubernetesPodLogExpiryCancellationAndReadLimit(t *testing.T) {
	k := kubeSetup(t, false)
	a, e := k.f.auth.Authenticate(context.Background(), k.admin)
	if e != nil {
		t.Fatal(e)
	}
	now := time.Now()
	claims := jwt.MapClaims{"iss": "podry", "aud": "podry-api", "sub": a.ID, "ver": a.TokenVersion, "iat": now.Unix(), "exp": now.Add(2 * time.Second).Unix()}
	token, e := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testJWT))
	if e != nil {
		t.Fatal(e)
	}
	res, _ := streamRequest(t, k, token, "&follow=true")
	b, e := io.ReadAll(res.Body)
	res.Body.Close()
	if e != nil || !strings.Contains(string(b), "log_stream_expired") {
		t.Fatal("expired token did not terminate stream with an error", e, string(b))
	}
	k.k.longLine.Store(true)
	res, _ = streamRequest(t, k, k.admin, "")
	b, e = io.ReadAll(res.Body)
	res.Body.Close()
	if e != nil || !strings.Contains(string(b), "log_stream_interrupted") {
		t.Fatal("oversized log line was not bounded", e, string(b))
	}
	k.k.longLine.Store(false)
	res, _ = streamRequest(t, k, k.admin, "&follow=true")
	held, _ := streamRequest(t, k, k.admin, "&follow=true")
	defer held.Body.Close()
	res.Body.Close()
	// Closing the client must release its slot without waiting for the 5-minute lifetime.
	deadline := time.Now().Add(2 * time.Second)
	for {
		request := httptest.NewRequest("GET", k.path("/pod-logs?namespace=demo&name=web&uid=pod-1&container=app"), nil)
		request.Header.Set("Authorization", "Bearer "+k.admin)
		w := httptest.NewRecorder()
		k.f.handler.ServeHTTP(w, request)
		if w.Code == 200 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("canceled stream retained concurrency slot")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestKubernetesConnectionObservationRotationRace(t *testing.T) {
	k := kubeSetup(t, false)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	k.k.mu.Lock()
	k.k.hook = func(r *http.Request) {
		if r.URL.Path == "/version" {
			once.Do(func() { close(entered); <-release })
		}
	}
	k.k.mu.Unlock()
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		r := httptest.NewRequest("POST", k.path("/connection-tests"), nil)
		r.Header.Set("Authorization", "Bearer "+k.admin)
		w := httptest.NewRecorder()
		k.f.handler.ServeHTTP(w, r)
		done <- w
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		close(release)
		t.Fatal("connection request did not reach upstream")
	}
	k.f.call("PUT", "/api/credentials/"+k.credential.ID, k.admin, map[string]any{"expectedVersion": 1, "payload": k.k.payload(false, false)}, 200)
	close(release)
	select {
	case w := <-done:
		if w.Code != 409 {
			t.Fatalf("obsolete connection observation accepted: %d", w.Code)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("connection test held database locks across network")
	}
	cluster := decode[platform.Cluster](t, k.f.call("GET", k.path(""), k.admin, nil, 200))
	if cluster.ConnectionStatus != "unknown" || cluster.LastCheckedAt != nil {
		t.Fatal("stale observer overwrote credential invalidation")
	}
}

func TestKubernetesProjectGrantAndRevocationDuringRead(t *testing.T) {
	k := kubeSetup(t, false)
	f := k.f
	team := decode[map[string]string](t, f.call("POST", "/api/teams", k.admin, map[string]any{"name": "Resource team"}, 201))
	f.call("POST", "/api/teams/"+team["id"]+"/members", k.admin, map[string]any{"userId": k.dev.ID, "role": "viewer"}, 201)
	p := decode[map[string]string](t, f.call("POST", "/api/projects", k.admin, map[string]any{"teamId": team["id"], "name": "Resource project"}, 201))
	f.call("POST", "/api/projects/"+p["id"]+"/members", k.admin, map[string]any{"userId": k.dev.ID, "role": "viewer"}, 201)
	f.call("POST", k.path("/resource-grants"), k.admin, map[string]any{"principalType": "project", "principalId": p["id"], "namespace": "demo", "resources": []string{"core/pods"}, "actions": []string{"resource.view"}}, 201)
	path := k.path("/resource?group=&version=v1&resource=pods&namespace=demo&name=web")
	f.call("GET", path, k.developer, nil, 200)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	k.k.mu.Lock()
	k.k.hook = func(r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/pods/web") {
			once.Do(func() { close(entered); <-release })
		}
	}
	k.k.mu.Unlock()
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Authorization", "Bearer "+k.developer)
		w := httptest.NewRecorder()
		f.handler.ServeHTTP(w, r)
		done <- w
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		close(release)
		t.Fatal("read did not reach upstream")
	}
	f.call("DELETE", "/api/projects/"+p["id"]+"/members/"+k.dev.ID, k.admin, nil, 204)
	close(release)
	select {
	case w := <-done:
		if w.Code != 404 {
			t.Fatalf("revoked project grant leaked in-flight data: %d", w.Code)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("membership revocation blocked behind remote IO")
	}
	before := k.k.requests.Load()
	f.call("GET", path, k.developer, nil, 404)
	if k.k.requests.Load() != before {
		t.Fatal("revoked project member contacted cluster")
	}
	f.call("POST", k.path("/resource-grants"), k.admin, map[string]any{"principalType": "team", "principalId": team["id"], "namespace": "demo", "resources": []string{"core/pods"}, "actions": []string{"resource.view"}}, 201)
	f.call("GET", path, k.developer, nil, 200)
	f.call("DELETE", "/api/teams/"+team["id"]+"/members/"+k.dev.ID, k.admin, nil, 204)
	before = k.k.requests.Load()
	f.call("GET", path, k.developer, nil, 404)
	if k.k.requests.Load() != before {
		t.Fatal("revoked team grant contacted cluster")
	}
}
func TestKubernetesPodReplacementAndStreamLimits(t *testing.T) {
	k := kubeSetup(t, false)
	first, _ := streamRequest(t, k, k.admin, "&follow=true")
	second, _ := streamRequest(t, k, k.admin, "&follow=true")
	third, _ := streamRequest(t, k, k.admin, "&follow=true")
	if third.StatusCode != 429 {
		t.Fatal("per-user concurrent stream bound missing")
	}
	third.Body.Close()
	k.k.uid.Store("pod-replaced")
	b, e := io.ReadAll(first.Body)
	first.Body.Close()
	if e != nil || !strings.Contains(string(b), "resource_identity_changed") {
		t.Fatal("same-name replacement did not close stream", e, string(b))
	}
	second.Body.Close()
}

// Opt-in only: credentials stay in process environment, and this test never writes to Kubernetes.
func TestLiveKubernetesReadOnly(t *testing.T) {
	raw := os.Getenv("PODRY_TEST_KUBE_PAYLOAD")
	if raw == "" {
		t.Skip("PODRY_TEST_KUBE_PAYLOAD is not set")
	}
	var payload map[string]any
	if json.Unmarshal([]byte(raw), &payload) != nil {
		t.Fatal("live Kubernetes payload is invalid")
	}
	f := setup(t)
	admin := f.account("live@kubernetes.test", true)
	token := f.login(admin.Email)
	cred := decode[platform.Credential](t, f.call("POST", "/api/credentials", token, map[string]any{"name": "Live read-only test", "kind": "kubeconfig", "teamId": nil, "payload": payload}, 201))
	cluster := decode[platform.Cluster](t, f.call("POST", "/api/clusters", token, map[string]any{"name": "Live read-only test", "apiServer": payload["apiServer"], "credentialId": cred.ID}, 201))
	base := "/api/clusters/" + cluster.ID
	connection := decode[platform.ConnectionTest](t, f.call("POST", base+"/connection-tests", token, nil, 200))
	if connection.Status != "connected" {
		t.Fatal("live Kubernetes connection unavailable; no remote writes attempted")
	}
	t.Logf("live Kubernetes connected: %s", *connection.ServerVersion)
	discoveryReq := httptest.NewRequest("GET", base+"/discovery", nil)
	discoveryReq.Header.Set("Authorization", "Bearer "+token)
	discoveryResponse := httptest.NewRecorder()
	f.handler.ServeHTTP(discoveryResponse, discoveryReq)
	discovery := []resource.ResourceType{}
	if discoveryResponse.Code == 200 {
		discovery = decode[[]resource.ResourceType](t, discoveryResponse.Body.Bytes())
	} else {
		t.Errorf("live Discovery HTTP %d; continuing independent resource reads", discoveryResponse.Code)
		liveDiscoveryDiagnostics(t, payload)
	}
	namespaces := decode[[]resource.Namespace](t, f.call("GET", base+"/namespaces", token, nil, 200))
	if discoveryResponse.Code == 200 {
		t.Logf("discovered %d resource types", len(discovery))
	}
	t.Logf("read %d namespaces", len(namespaces))
	pods := decode[resource.List](t, f.call("GET", base+"/resources?group=&version=v1&resource=pods&limit=10", token, nil, 200))
	t.Logf("read %d pods (bounded first page)", len(pods.Items))
	phases := map[string]int{}
	for _, pod := range pods.Items {
		phases[pod.Status]++
	}
	t.Logf("live Pod phases: %v", phases)
	if len(pods.Items) == 0 {
		t.Log("no Pods available: get/events/logs live validation skipped")
		return
	}
	pod := pods.Items[0]
	selectedContainer := ""
	for _, candidate := range pods.Items {
		status, _ := candidate.Data["status"].(map[string]any)
		states, _ := status["containerStatuses"].([]any)
		for _, v := range states {
			cs, _ := v.(map[string]any)
			state, _ := cs["state"].(map[string]any)
			if state["running"] != nil {
				pod = candidate
				selectedContainer, _ = cs["name"].(string)
				break
			}
		}
		if selectedContainer != "" {
			break
		}
	}
	q := url.Values{"group": {""}, "version": {"v1"}, "resource": {"pods"}, "namespace": {pod.Ref.Namespace}, "name": {pod.Ref.Name}, "uid": {pod.Ref.UID}}
	detail := decode[resource.Object](t, f.call("GET", base+"/resource?"+q.Encode(), token, nil, 200))
	events := decode[[]resource.Event](t, f.call("GET", base+"/events?"+q.Encode(), token, nil, 200))
	t.Logf("read Pod detail by UID and %d related events", len(events))
	containers, _ := detail.Data["spec"].(map[string]any)["containers"].([]any)
	if len(containers) == 0 {
		t.Log("Pod has no container: log validation skipped")
		return
	}
	container, _ := containers[0].(map[string]any)["name"].(string)
	if selectedContainer != "" {
		container = selectedContainer
	}
	logs := url.Values{"namespace": {pod.Ref.Namespace}, "name": {pod.Ref.Name}, "uid": {pod.Ref.UID}, "container": {container}, "tailLines": {"2"}, "follow": {"false"}}
	req := httptest.NewRequest("GET", base+"/pod-logs?"+logs.Encode(), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, req)
	if w.Code != 200 {
		var failure struct {
			Error struct{ Code, Message string }
		}
		_ = json.Unmarshal(w.Body.Bytes(), &failure)
		t.Errorf("live pod logs HTTP %d, code=%s (remote response and log contents omitted)", w.Code, failure.Error.Code)
		return
	}
	if !strings.Contains(w.Body.String(), `"type":"end"`) {
		t.Fatal("live pod log did not end normally (contents intentionally omitted)")
	}
	t.Log("bounded live Pod logs read successfully; contents omitted")
}

func liveDiscoveryDiagnostics(t *testing.T, payload map[string]any) {
	t.Helper()
	c, e := kubernetes.New(payload)
	if e != nil {
		return
	}
	defer c.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var groups struct {
		Groups []struct {
			Name             string
			PreferredVersion struct{ Version string }
		}
	}
	if c.Get(ctx, "/apis", nil, &groups) != nil {
		return
	}
	for _, g := range groups.Groups {
		var v struct {
			GroupVersion string
			Resources    []any
		}
		e = c.Get(ctx, "/apis/"+g.Name+"/"+g.PreferredVersion.Version, nil, &v)
		if e != nil {
			t.Logf("live Discovery blocked at %s/%s: %v", g.Name, g.PreferredVersion.Version, e)
		} else if v.GroupVersion != g.Name+"/"+g.PreferredVersion.Version {
			t.Logf("live Discovery schema mismatch at %s/%s", g.Name, g.PreferredVersion.Version)
		}
	}
}
