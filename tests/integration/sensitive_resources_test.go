package integration_test

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/resource"
	"k8s.io/apimachinery/pkg/util/httpstream"
	"k8s.io/apimachinery/pkg/util/httpstream/spdy"
)

type sensitiveFixture struct {
	*resourceWriteFixture
	web     *httptest.Server
	execs   atomic.Int32
	closed  chan struct{}
	started chan struct{}
	mode    string
}

func sensitiveSetup(t *testing.T, mode string) *sensitiveFixture {
	f := resourceWriteSetup(t)
	f.service.WritesEnabled = false
	f.service.RecheckInterval = 40 * time.Millisecond
	s := &sensitiveFixture{resourceWriteFixture: f, closed: make(chan struct{}, 16), started: make(chan struct{}, 16), mode: mode}
	previous := f.api.server.Config.Handler
	f.api.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/exec") {
			s.exec(w, r)
			return
		}
		previous.ServeHTTP(w, r)
	})
	f.api.objects["/api/v1/namespaces/demo/secrets/credentials"] = map[string]any{
		"apiVersion": "v1", "kind": "Secret", "metadata": map[string]any{"namespace": "demo", "name": "credentials", "uid": "secret-uid", "resourceVersion": "7"},
		"data": map[string]any{"password": base64.StdEncoding.EncodeToString([]byte("private-revealed-password")), "unselected": base64.StdEncoding.EncodeToString([]byte("must-not-return")), "empty": ""},
	}
	f.api.objects["/api/v1/namespaces/demo/pods/demo"] = map[string]any{
		"apiVersion": "v1", "kind": "Pod", "metadata": map[string]any{"namespace": "demo", "name": "demo", "uid": "pod-uid", "resourceVersion": "4"},
		"spec": map[string]any{"containers": []any{map[string]any{"name": "app"}}},
	}
	s.web = httptest.NewServer(f.f.handler)
	t.Cleanup(s.web.Close)
	drain, stop := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { f.service.RunExecDraining(drain, context.Background()); close(done) }()
	t.Cleanup(func() {
		stop()
		select {
		case <-done:
		case <-time.After(8 * time.Second):
			t.Error("terminal drain did not join")
		}
	})
	return s
}

func (s *sensitiveFixture) grantSensitive(t *testing.T, actions ...string) platform.Grant {
	t.Helper()
	return decode[platform.Grant](t, s.f.call("POST", s.path("/resource-grants"), s.admin, map[string]any{"principalType": "user", "principalId": s.devID, "namespace": "demo", "resources": []string{"core/secrets", "core/pods"}, "actions": actions}, 201))
}
func secretReveal() resource.SecretRevealInput {
	return resource.SecretRevealInput{Ref: &resource.Ref{Version: "v1", Resource: "secrets", Namespace: "demo", Name: "credentials", UID: "secret-uid", ResourceVersion: "7"}, Keys: []string{"password", "empty"}, Reason: "private-reason-do-not-persist"}
}
func execInput(tty bool) resource.ExecInput {
	return resource.ExecInput{Ref: &resource.Ref{Version: "v1", Resource: "pods", Namespace: "demo", Name: "demo", UID: "pod-uid", ResourceVersion: "4"}, Container: "app", Command: []string{"/bin/demo", "private-command-argument"}, TTY: &tty}
}
func (s *sensitiveFixture) create(t *testing.T, tty bool) resource.ExecSession {
	t.Helper()
	// HTTP origin and host must match the later WebSocket request.
	data, _ := json.Marshal(execInput(tty))
	req, _ := http.NewRequest("POST", s.web.URL+s.path("/exec-sessions"), strings.NewReader(string(data)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.developer)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 201 {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("create %d %s", res.StatusCode, body)
	}
	if res.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("ticket response cacheable")
	}
	var out resource.ExecSession
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}
func (s *sensitiveFixture) dial(session resource.ExecSession, origin, token string) (*websocket.Conn, *http.Response, error) {
	d := websocket.Dialer{HandshakeTimeout: 4 * time.Second, Subprotocols: []string{"podry.exec.v1", "ticket." + session.Ticket}}
	h := http.Header{"Origin": {origin}}
	if token != "" {
		h.Set("Authorization", "Bearer "+token)
	}
	return d.Dial("ws"+strings.TrimPrefix(s.web.URL, "http")+session.WebSocketPath, h)
}
func readTerminal(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(4 * time.Second))
	var frame map[string]any
	if err := conn.ReadJSON(&frame); err != nil {
		t.Fatal(err)
	}
	return frame
}

type fixtureStream struct {
	stream httpstream.Stream
	ready  <-chan struct{}
}

// This is an actual TLS/SPDY remotecommand endpoint, not a mocked executor.
func (s *sensitiveFixture) exec(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" || r.URL.Path != "/api/v1/namespaces/demo/pods/demo/exec" || r.Header.Get("Authorization") != "Bearer resource-write-token" || r.URL.Query().Get("container") != "app" || len(r.URL.Query()["command"]) != 2 || r.URL.Query()["command"][1] != "private-command-argument" {
		http.Error(w, "private upstream rejection", 403)
		return
	}
	s.execs.Add(1)
	s.started <- struct{}{}
	if s.mode == "headers" {
		defer func() { s.closed <- struct{}{} }()
		<-r.Context().Done()
		return
	}
	if s.mode == "error-body" {
		defer func() { s.closed <- struct{}{} }()
		w.WriteHeader(403)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		return
	}
	if s.mode == "reject" {
		http.Error(w, "private upstream command diagnostic", 403)
		return
	}
	if s.mode == "redirect" {
		http.Redirect(w, r, s.api.server.URL+"/unsafe-target", 307)
		return
	}
	if _, err := httpstream.Handshake(r, w, []string{"v4.channel.k8s.io"}); err != nil {
		return
	}
	streams := make(chan fixtureStream, 8)
	conn := spdy.NewResponseUpgrader().UpgradeResponse(w, r, func(stream httpstream.Stream, ready <-chan struct{}) error {
		streams <- fixtureStream{stream, ready}
		return nil
	})
	if conn == nil {
		return
	}
	defer conn.Close()
	defer func() { s.closed <- struct{}{} }()
	byType := map[string]httpstream.Stream{}
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for len(byType) < 4 {
		select {
		case stream := <-streams:
			select {
			case <-stream.ready:
			case <-deadline.C:
				return
			case <-conn.CloseChan():
				return
			}
			byType[stream.stream.Headers().Get("streamType")] = stream.stream
		case <-deadline.C:
			return
		case <-conn.CloseChan():
			return
		}
	}
	if byType["stdout"] == nil || byType["stdin"] == nil || byType["error"] == nil {
		return
	}
	if s.mode == "hold" {
		_, _ = io.WriteString(byType["stdout"], "ready")
		<-conn.CloseChan()
		return
	}
	line, err := bufio.NewReader(byType["stdin"]).ReadString('\n')
	if err != nil {
		return
	}
	_, _ = io.WriteString(byType["stdout"], "pong:"+line)
	if byType["stderr"] != nil {
		_, _ = io.WriteString(byType["stderr"], "diagnostic")
	}
	if byType["resize"] != nil {
		var size map[string]int
		if json.NewDecoder(byType["resize"]).Decode(&size) != nil || size["Width"] != 120 || size["Height"] != 36 {
			return
		}
		_, _ = io.WriteString(byType["stdout"], "resized")
	}
	_ = byType["stdout"].Close()
	if byType["stderr"] != nil {
		_ = byType["stderr"].Close()
	}
	status := `{"status":"Success"}`
	if s.mode == "exit7" {
		status = `{"status":"Failure","reason":"NonZeroExitCode","details":{"causes":[{"reason":"ExitCode","message":"7"}]},"message":"private exit diagnostic"}`
	}
	_, _ = io.WriteString(byType["error"], status)
	_ = byType["error"].Close()
	<-conn.CloseChan()
}

func TestSecretRevealAuthorizationIdentityAndAudit(t *testing.T) {
	s := sensitiveSetup(t, "hold")
	s.f.call("POST", s.path("/secrets/reveal"), s.developer, secretReveal(), 404)
	s.api.mu.Lock()
	reads := s.api.reads
	s.api.mu.Unlock()
	if reads != 0 {
		t.Fatal("unauthorized request reached cluster")
	}
	s.grantSensitive(t, "secret.reveal")
	body, _ := json.Marshal(secretReveal())
	req := httptest.NewRequest("POST", s.path("/secrets/reveal"), strings.NewReader(string(body)))
	req.Header.Set("Authorization", "Bearer "+s.developer)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	s.f.handler.ServeHTTP(res, req)
	if res.Code != 200 {
		t.Fatalf("reveal %d %s", res.Code, res.Body.String())
	}
	out := decode[resource.SecretRevealResult](t, res.Body.Bytes())
	if len(out.Values) != 2 || out.Values["password"] != base64.StdEncoding.EncodeToString([]byte("private-revealed-password")) || out.Values["empty"] != "" {
		t.Fatal(out)
	}
	if res.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("cacheable secret")
	}
	var target string
	if err := s.f.pool.QueryRow(context.Background(), "SELECT target::text FROM audit_events WHERE action='secret.reveal'").Scan(&target); err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"private-revealed-password", "private-reason-do-not-persist", "password", "unselected", "must-not-return"} {
		if strings.Contains(target, secret) {
			t.Fatal("audit leaked secret material", target)
		}
	}
	for _, test := range []struct {
		name   string
		edit   func(*resource.SecretRevealInput)
		status int
	}{
		{"wrong uid", func(in *resource.SecretRevealInput) { in.Ref.UID = "replaced" }, 409},
		{"stale version", func(in *resource.SecretRevealInput) { in.Ref.ResourceVersion = "old" }, 409},
		{"wrong namespace", func(in *resource.SecretRevealInput) { in.Ref.Namespace = "other" }, 404},
		{"missing key", func(in *resource.SecretRevealInput) { in.Keys = []string{"password", "missing"} }, 422},
		{"duplicate key", func(in *resource.SecretRevealInput) { in.Keys = []string{"password", "password"} }, 422},
		{"path key", func(in *resource.SecretRevealInput) { in.Keys = []string{"../password"} }, 422},
		{"empty reason", func(in *resource.SecretRevealInput) { in.Reason = " " }, 422},
		{"wrong resource", func(in *resource.SecretRevealInput) { in.Ref.Resource = "pods" }, 422},
		{"missing ref", func(in *resource.SecretRevealInput) { in.Ref = nil }, 422},
	} {
		t.Run(test.name, func(t *testing.T) {
			in := secretReveal()
			test.edit(&in)
			body := string(s.f.call("POST", s.path("/secrets/reveal"), s.developer, in, test.status))
			if strings.Contains(body, "private-revealed-password") || strings.Contains(body, "cHJpdmF0ZS1yZXZlYWxlZC1wYXNzd29yZA==") {
				t.Fatal("error leaked secret")
			}
		})
	}
}

func TestSecretRevealFinalRevocationAndAuditRollback(t *testing.T) {
	for _, mode := range []string{"grant", "credential", "audit"} {
		t.Run(mode, func(t *testing.T) {
			s := sensitiveSetup(t, "hold")
			grant := s.grantSensitive(t, "secret.reveal")
			if mode == "audit" {
				_, err := s.f.pool.Exec(context.Background(), `CREATE FUNCTION reject_secret_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='secret.reveal' THEN RAISE EXCEPTION 'private audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_secret_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_secret_audit()`)
				if err != nil {
					t.Fatal(err)
				}
			}
			s.api.mu.Lock()
			s.api.hook = func(r *http.Request) {
				if mode == "grant" {
					s.f.call("DELETE", s.path("/resource-grants/")+grant.ID, s.admin, nil, 204)
				}
				if mode == "credential" {
					s.f.call("PUT", "/api/credentials/"+s.credential.ID, s.admin, map[string]any{"expectedVersion": s.credential.Version, "payload": s.payload()}, 200)
				}
			}
			s.api.mu.Unlock()
			status := 409
			if mode == "grant" {
				status = 409
			}
			if mode == "audit" {
				status = 500
			}
			res := s.f.call("POST", s.path("/secrets/reveal"), s.developer, secretReveal(), status)
			if strings.Contains(string(res), "values") {
				t.Fatal("secret released after revocation/audit failure")
			}
		})
	}
}

func TestExecHTTPValidationOwnershipAndQuota(t *testing.T) {
	s := sensitiveSetup(t, "hold")
	s.f.call("POST", s.path("/exec-sessions"), s.developer, execInput(false), 404)
	s.grantSensitive(t, "pod.exec")
	for _, edit := range []func(*resource.ExecInput){func(in *resource.ExecInput) { in.Command = nil }, func(in *resource.ExecInput) { in.TTY = nil }, func(in *resource.ExecInput) { in.Command = []string{"cmd\x00"} }, func(in *resource.ExecInput) { in.Ref = nil }} {
		in := execInput(false)
		edit(&in)
		s.f.call("POST", s.path("/exec-sessions"), s.developer, in, 422)
	}
	wrong := execInput(false)
	wrong.Container = "missing"
	s.f.call("POST", s.path("/exec-sessions"), s.developer, wrong, 422)
	first := s.create(t, false)
	second := s.create(t, false)
	s.f.call("POST", s.path("/exec-sessions"), s.developer, execInput(false), 429)
	if s.execs.Load() != 0 {
		t.Fatal("creation executed command")
	}
	s.f.call("DELETE", "/api/exec-sessions/"+first.SessionID, s.admin, nil, 404)
	s.f.call("DELETE", "/api/exec-sessions/"+first.SessionID, s.developer, nil, 204)
	s.f.call("DELETE", "/api/exec-sessions/"+first.SessionID, s.developer, nil, 404)
	s.f.call("DELETE", "/api/exec-sessions/"+second.SessionID, s.developer, nil, 204)
	third := s.create(t, false)
	s.f.call("DELETE", "/api/exec-sessions/"+third.SessionID, s.developer, nil, 204)
}

func TestExecWebSocketStdinOutputResizeAndExit(t *testing.T) {
	for _, mode := range []string{"echo", "tty", "exit7"} {
		t.Run(mode, func(t *testing.T) {
			s := sensitiveSetup(t, mode)
			s.grantSensitive(t, "pod.exec")
			session := s.create(t, mode == "tty")
			conn, res, err := s.dial(session, s.web.URL, "")
			if err != nil {
				t.Fatal(err, res)
			}
			defer conn.Close()
			if conn.Subprotocol() != "podry.exec.v1" {
				t.Fatal("ticket echoed")
			}
			if mode == "tty" {
				if err = conn.WriteJSON(map[string]any{"type": "resize", "cols": 120, "rows": 36}); err != nil {
					t.Fatal(err)
				}
			}
			if err = conn.WriteJSON(map[string]string{"type": "stdin", "data": "ping\n"}); err != nil {
				t.Fatal(err)
			}
			stdout, stderr := "", ""
			for i := 0; i < 10; i++ {
				frame := readTerminal(t, conn)
				switch frame["type"] {
				case "stdout":
					stdout += frame["data"].(string)
				case "stderr":
					stderr += frame["data"].(string)
				case "exit":
					want := float64(0)
					if mode == "exit7" {
						want = 7
					}
					if frame["code"] != want || !strings.Contains(stdout, "pong:ping\n") || mode == "tty" && !strings.Contains(stdout, "resized") || mode != "tty" && stderr != "diagnostic" {
						t.Fatalf("frames %v %q %q", frame, stdout, stderr)
					}
					if s.execs.Load() != 1 {
						t.Fatal("exec retried")
					}
					return
				default:
					t.Fatal("unexpected frame", frame)
				}
			}
			t.Fatal("missing exit")
		})
	}
}

func TestExecTicketOriginIdentityAndReplay(t *testing.T) {
	s := sensitiveSetup(t, "hold")
	s.grantSensitive(t, "pod.exec")
	session := s.create(t, false)
	for _, test := range []struct {
		origin, token string
		status        int
	}{{"http://foreign.test", "", 403}, {"", "", 403}, {s.web.URL, s.admin, 401}} {
		conn, res, err := s.dial(session, test.origin, test.token)
		if conn != nil {
			conn.Close()
		}
		if err == nil || res == nil || res.StatusCode != test.status {
			t.Fatalf("handshake %v %v", err, res)
		}
		res.Body.Close()
	}
	conn, _, err := s.dial(session, s.web.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if frame := readTerminal(t, conn); frame["type"] != "stdout" {
		t.Fatal(frame)
	}
	replay, res, err := s.dial(session, s.web.URL, "")
	if replay != nil {
		replay.Close()
	}
	if err == nil || res == nil || res.StatusCode != 401 {
		t.Fatal("ticket replay accepted")
	}
	res.Body.Close()
	s.f.call("DELETE", "/api/exec-sessions/"+session.SessionID, s.developer, nil, 204)
	select {
	case <-s.closed:
	case <-time.After(4 * time.Second):
		t.Fatal("DELETE did not cancel upstream")
	}
}

func TestExecRevocationReplacementDisconnectAndProtocol(t *testing.T) {
	for _, mode := range []string{"grant", "logout", "pod", "credential", "disconnect", "disconnect-with-stdin", "protocol", "close"} {
		t.Run(mode, func(t *testing.T) {
			s := sensitiveSetup(t, "hold")
			grant := s.grantSensitive(t, "pod.exec")
			session := s.create(t, false)
			conn, _, err := s.dial(session, s.web.URL, "")
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			if frame := readTerminal(t, conn); frame["type"] != "stdout" {
				t.Fatal(frame)
			}
			switch mode {
			case "grant":
				s.f.call("DELETE", s.path("/resource-grants/")+grant.ID, s.admin, nil, 204)
			case "logout":
				s.f.call("POST", "/api/auth/logout", s.developer, nil, 204)
			case "pod":
				s.api.mu.Lock()
				s.api.objects["/api/v1/namespaces/demo/pods/demo"]["metadata"].(map[string]any)["uid"] = "replacement"
				s.api.mu.Unlock()
			case "credential":
				s.f.call("PUT", "/api/credentials/"+s.credential.ID, s.admin, map[string]any{"expectedVersion": s.credential.Version, "payload": s.payload()}, 200)
			case "disconnect":
				conn.Close()
			case "disconnect-with-stdin":
				_ = conn.WriteJSON(map[string]string{"type": "stdin", "data": strings.Repeat("x", 32<<10)})
				conn.Close()
			case "protocol":
				_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"stdin","type":"close","data":"private-terminal-content"}`))
			case "close":
				_ = conn.WriteJSON(map[string]string{"type": "close"})
			}
			if mode != "disconnect" && mode != "disconnect-with-stdin" && mode != "close" {
				if frame := readTerminal(t, conn); frame["type"] != "error" {
					t.Fatal(frame)
				}
			}
			select {
			case <-s.closed:
			case <-time.After(4 * time.Second):
				t.Fatal("upstream did not close")
			}
		})
	}
}

func TestExecUpstreamErrorsAreSanitized(t *testing.T) {
	for _, mode := range []string{"reject", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			s := sensitiveSetup(t, mode)
			s.grantSensitive(t, "pod.exec")
			session := s.create(t, false)
			conn, _, err := s.dial(session, s.web.URL, "")
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			frame := readTerminal(t, conn)
			data, _ := json.Marshal(frame)
			if frame["type"] != "error" || strings.Contains(string(data), "private") || strings.Contains(string(data), "https:") {
				t.Fatal(frame)
			}
			if s.execs.Load() != 1 {
				t.Fatal("upstream retried")
			}
		})
	}
}

func TestExecConnectRechecksPodAndCurrentPermission(t *testing.T) {
	for _, mode := range []string{"grant", "uid"} {
		t.Run(mode, func(t *testing.T) {
			s := sensitiveSetup(t, "hold")
			g := s.grantSensitive(t, "pod.exec")
			session := s.create(t, false)
			if mode == "grant" {
				s.f.call("DELETE", s.path("/resource-grants/")+g.ID, s.admin, nil, 204)
			} else {
				s.api.mu.Lock()
				s.api.objects["/api/v1/namespaces/demo/pods/demo"]["metadata"].(map[string]any)["uid"] = "new-pod"
				s.api.mu.Unlock()
			}
			conn, res, err := s.dial(session, s.web.URL, "")
			if conn != nil {
				conn.Close()
			}
			want := 404
			if mode == "uid" {
				want = 409
			}
			if err == nil || res == nil || res.StatusCode != want {
				t.Fatalf("upgrade %v %v", err, res)
			}
			res.Body.Close()
			if s.execs.Load() != 0 {
				t.Fatal("command executed before reauthorization")
			}
		})
	}
}

func TestExecSensitiveAuditDoesNotPersistTicketCommandOrBytes(t *testing.T) {
	s := sensitiveSetup(t, "echo")
	s.grantSensitive(t, "pod.exec")
	session := s.create(t, false)
	conn, _, err := s.dial(session, s.web.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.WriteJSON(map[string]string{"type": "stdin", "data": "private-terminal-content\n"})
	for {
		if frame := readTerminal(t, conn); frame["type"] == "exit" {
			break
		}
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		var count int
		if err := s.f.pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_events WHERE action='pod.exec.end'").Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("missing terminal end audit")
		}
		time.Sleep(10 * time.Millisecond)
	}
	rows, err := s.f.pool.Query(context.Background(), "SELECT target::text FROM audit_events WHERE action LIKE 'pod.exec.%'")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var target string
		if err := rows.Scan(&target); err != nil {
			t.Fatal(err)
		}
		for _, secret := range []string{session.Ticket, "private-command-argument", "private-terminal-content"} {
			if strings.Contains(target, secret) {
				t.Fatal("terminal audit leaked", target)
			}
		}
	}
}

// Keep UUID route validation independent of the session map.
func TestExecUnknownSession(t *testing.T) {
	s := sensitiveSetup(t, "hold")
	s.f.call("DELETE", fmt.Sprintf("/api/exec-sessions/%s", uuid.NewString()), s.developer, nil, 404)
}

func TestExecTicketExpiryReleasesPendingQuota(t *testing.T) {
	s := sensitiveSetup(t, "hold")
	s.grantSensitive(t, "pod.exec")
	a, err := s.f.auth.Authenticate(context.Background(), s.developer)
	if err != nil {
		t.Fatal(err)
	}
	a.ExpiresAt = time.Now().Add(300 * time.Millisecond)
	session, err := s.service.CreateExecSession(context.Background(), a, s.cluster.ID, execInput(false), s.web.URL, "expiry-test")
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Until(session.ExpiresAt) + 50*time.Millisecond)
	conn, res, err := s.dial(session, s.web.URL, "")
	if conn != nil {
		conn.Close()
	}
	if err == nil || res == nil || res.StatusCode != 401 {
		t.Fatal("expired ticket accepted", err, res)
	}
	res.Body.Close()
	s.create(t, false)
	s.create(t, false)
	if s.execs.Load() != 0 {
		t.Fatal("expired/pending ticket executed")
	}
}

func TestExecConcurrentTicketConsumptionAndDrain(t *testing.T) {
	s := sensitiveSetup(t, "hold")
	s.grantSensitive(t, "pod.exec")
	session := s.create(t, false)
	type dialResult struct {
		conn *websocket.Conn
		res  *http.Response
		err  error
	}
	results := make(chan dialResult, 2)
	for i := 0; i < 2; i++ {
		go func() { c, r, e := s.dial(session, s.web.URL, ""); results <- dialResult{c, r, e} }()
	}
	wins := 0
	var winner *websocket.Conn
	for i := 0; i < 2; i++ {
		out := <-results
		if out.err == nil {
			wins++
			winner = out.conn
		} else {
			if out.res == nil || out.res.StatusCode != 401 {
				t.Fatal(out.err, out.res)
			}
			out.res.Body.Close()
		}
	}
	if wins != 1 {
		t.Fatal("ticket consumed multiple times", wins)
	}
	defer winner.Close()
	if frame := readTerminal(t, winner); frame["type"] != "stdout" {
		t.Fatal(frame)
	}
	drain, stop := context.WithCancel(context.Background())
	stop()
	done := make(chan struct{})
	go func() { s.service.RunExecDraining(drain, context.Background()); close(done) }()
	select {
	case <-done:
	case <-time.After(4 * time.Second):
		t.Fatal("drain did not join active WebSocket")
	}
	select {
	case <-s.closed:
	case <-time.After(time.Second):
		t.Fatal("drain did not close upstream")
	}
	s.f.call("POST", s.path("/exec-sessions"), s.developer, execInput(false), 503)
	if s.execs.Load() != 1 {
		t.Fatal("concurrent connect executed twice")
	}
}

func TestExecAuditFailureDoesNotExecute(t *testing.T) {
	for _, action := range []string{"pod.exec.create", "pod.exec.connect", "pod.exec.close"} {
		t.Run(action, func(t *testing.T) {
			s := sensitiveSetup(t, "hold")
			s.grantSensitive(t, "pod.exec")
			var session resource.ExecSession
			if action != "pod.exec.create" {
				session = s.create(t, false)
			}
			statement := `CREATE FUNCTION reject_exec_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='` + action + `' THEN RAISE EXCEPTION 'private audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_exec_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_exec_audit()`
			if _, err := s.f.pool.Exec(context.Background(), statement); err != nil {
				t.Fatal(err)
			}
			if action == "pod.exec.create" {
				s.f.call("POST", s.path("/exec-sessions"), s.developer, execInput(false), 500)
			}
			if action == "pod.exec.connect" {
				conn, res, err := s.dial(session, s.web.URL, "")
				if conn != nil {
					conn.Close()
				}
				if err == nil || res == nil || res.StatusCode != 500 {
					t.Fatal(err, res)
				}
				res.Body.Close()
			}
			if action == "pod.exec.close" {
				s.f.call("DELETE", "/api/exec-sessions/"+session.SessionID, s.developer, nil, 500)
			}
			if s.execs.Load() != 0 {
				t.Fatal("audit failure executed command")
			}
		})
	}
}

func TestExecCancelStalledUpgradeAndRejectUnboundedErrorBody(t *testing.T) {
	for _, mode := range []string{"headers", "error-body"} {
		t.Run(mode, func(t *testing.T) {
			s := sensitiveSetup(t, mode)
			s.grantSensitive(t, "pod.exec")
			session := s.create(t, false)
			conn, _, err := s.dial(session, s.web.URL, "")
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			select {
			case <-s.started:
			case <-time.After(3 * time.Second):
				t.Fatal("missing upstream request")
			}
			if mode == "headers" {
				s.f.call("DELETE", "/api/exec-sessions/"+session.SessionID, s.developer, nil, 204)
			} else {
				if frame := readTerminal(t, conn); frame["type"] != "error" {
					t.Fatal(frame)
				}
			}
			select {
			case <-s.closed:
			case <-time.After(3 * time.Second):
				t.Fatal("stalled upstream did not cancel")
			}
		})
	}
}

func TestExecWebSocketFrameBudget(t *testing.T) {
	s := sensitiveSetup(t, "hold")
	s.grantSensitive(t, "pod.exec")
	session := s.create(t, false)
	conn, _, err := s.dial(session, s.web.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = readTerminal(t, conn)
	if err = conn.WriteJSON(map[string]string{"type": "stdin", "data": strings.Repeat("x", 65<<10)}); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, _, err = conn.ReadMessage()
	if err == nil {
		t.Fatal("oversized input was accepted")
	}
	select {
	case <-s.closed:
	case <-time.After(3 * time.Second):
		t.Fatal("frame budget did not release upstream")
	}
}
