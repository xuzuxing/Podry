package resource

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/kubernetes"
	"k8s.io/client-go/tools/remotecommand"
	executil "k8s.io/client-go/util/exec"
)

const execProtocol = "podry.exec.v1"

type ExecInput struct {
	Ref       *Ref     `json:"ref"`
	Container string   `json:"container"`
	Command   []string `json:"command"`
	TTY       *bool    `json:"tty"`
}
type ExecSession struct {
	SessionID     string    `json:"sessionId"`
	ExpiresAt     time.Time `json:"expiresAt"`
	WebSocketPath string    `json:"webSocketPath"`
	Ticket        string    `json:"ticket"`
}
type execSession struct {
	id, clusterID, origin string
	actor                 auth.Actor
	input                 ExecInput
	ticket                [32]byte
	expires               time.Time
	active                bool
	cancel                context.CancelFunc
	timer                 *time.Timer
}

func validateExec(in ExecInput) (ResourceType, url.Values, error) {
	t, q, err := sensitiveRef(in.Ref, "pods", false)
	if err != nil {
		return t, q, err
	}
	if !validSegment(in.Container, 63) || in.TTY == nil || len(in.Command) < 1 || len(in.Command) > 32 {
		return t, q, httpx.Invalid("需要 container、tty 和 1–32 项 command")
	}
	total := 0
	for i, part := range in.Command {
		total += len(part)
		if !utf8.ValidString(part) || strings.ContainsRune(part, 0) || i == 0 && strings.TrimSpace(part) == "" || total > 8192 {
			return t, q, httpx.Invalid("command 无效或超过 8 KiB")
		}
	}
	q.Set("container", in.Container)
	return t, q, nil
}

// Do not trust forwarded headers supplied by clients. The host and scheme must
// describe the same origin on creation and WebSocket upgrade.
func (s *Service) requestOrigin(r *http.Request, required bool) (string, error) {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	expected := scheme + "://" + strings.ToLower(r.Host)
	if s.PublicOrigin != "" {
		expected = strings.ToLower(s.PublicOrigin)
	}
	u, err := url.Parse(expected)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return "", httpx.Invalid("请求来源无效")
	}
	origins := r.Header.Values("Origin")
	if len(origins) == 0 && !required {
		return expected, nil
	}
	if len(origins) != 1 || strings.ToLower(origins[0]) != expected {
		return "", httpx.Forbidden()
	}
	return expected, nil
}

func (s *Service) createExecSession(w http.ResponseWriter, r *http.Request) {
	var in ExecInput
	err := httpx.Decode(w, r, &in)
	if err == nil {
		_, err = query(r, "")
	}
	var origin string
	if err == nil {
		origin, err = s.requestOrigin(r, false)
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out, err := s.CreateExecSession(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"), in, origin, middleware.GetReqID(r.Context()))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 201, out)
}

func (s *Service) CreateExecSession(ctx context.Context, a auth.Actor, id string, in ExecInput, origin, requestID string) (ExecSession, error) {
	t, q, err := validateExec(in)
	if err != nil {
		return ExecSession{}, err
	}
	x, c, err := s.sensitiveClient(ctx, a, id, t, q, "pod.exec")
	if err != nil {
		return ExecSession{}, err
	}
	defer c.Close()
	if err = verifyPod(ctx, c, t, q); err != nil {
		return ExecSession{}, err
	}
	var entropy [32]byte
	if _, err = rand.Read(entropy[:]); err != nil {
		return ExecSession{}, err
	}
	ticket := base64.RawURLEncoding.EncodeToString(entropy[:])
	expires := time.Now().UTC().Add(30 * time.Second)
	if !a.ExpiresAt.IsZero() && a.ExpiresAt.Before(expires) {
		expires = a.ExpiresAt
	}
	// Own all mutable request data before retaining it beyond the HTTP request.
	ref := *in.Ref
	tty := *in.TTY
	in.Ref, in.TTY, in.Command = &ref, &tty, append([]string(nil), in.Command...)
	session := &execSession{id: uuid.NewString(), clusterID: id, origin: origin, actor: a, input: in, ticket: sha256.Sum256([]byte(ticket)), expires: expires}
	s.execMu.Lock()
	if s.execClosing {
		s.execMu.Unlock()
		return ExecSession{}, httpx.Fail(503, "exec_draining", "服务正在停止终端连接")
	}
	count := 0
	for _, existing := range s.execSessions {
		if existing.actor.ID == a.ID {
			count++
		}
	}
	if len(s.execSessions) >= 16 || count >= 2 {
		s.execMu.Unlock()
		return ExecSession{}, httpx.Fail(429, "exec_session_limit", "终端会话并发数已达上限")
	}
	if s.execSessions == nil {
		s.execSessions = map[string]*execSession{}
	}
	s.execSessions[session.id] = session
	session.timer = time.AfterFunc(time.Until(expires), func() {
		s.execMu.Lock()
		defer s.execMu.Unlock()
		if !session.active {
			delete(s.execSessions, session.id)
		}
	})
	s.execMu.Unlock()
	if err = s.sensitiveAudit(ctx, a, x, "pod.exec.create", requestID, execTarget(session)); err != nil {
		s.removeExec(session)
		return ExecSession{}, err
	}
	return ExecSession{session.id, expires, "/api/exec-sessions/" + session.id + "/connect", ticket}, nil
}

func execTarget(session *execSession) map[string]any {
	return map[string]any{"sessionId": session.id, "ref": session.input.Ref, "container": session.input.Container, "tty": *session.input.TTY}
}

func (s *Service) removeExec(session *execSession) {
	s.execMu.Lock()
	defer s.execMu.Unlock()
	delete(s.execSessions, session.id)
	if session.timer != nil {
		session.timer.Stop()
	}
}

func (s *Service) RegisterExecClose(r chi.Router) {
	r.Delete("/exec-sessions/{sessionId}", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "sessionId")
		err := httpx.UUID(id)
		if err == nil {
			_, err = query(r, "")
		}
		if err == nil {
			err = s.CloseExecSession(r.Context(), auth.Current(r.Context()), id, middleware.GetReqID(r.Context()))
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.WriteHeader(204)
	})
}

func (s *Service) CloseExecSession(ctx context.Context, a auth.Actor, id, requestID string) error {
	s.execMu.Lock()
	session := s.execSessions[id]
	if session == nil || session.actor.ID != a.ID {
		s.execMu.Unlock()
		return httpx.NotFound()
	}
	s.execMu.Unlock()
	// Closing requires ownership, even after resource permission is withdrawn.
	_, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		if e := auth.LockActor(ctx, q, a); e != nil {
			return false, e
		}
		data, _ := json.Marshal(execTarget(session))
		return true, q.RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &a.ID, ClusterID: &session.clusterID, Action: "pod.exec.close", Target: data, Result: "accepted", RequestID: requestID})
	})
	if err != nil {
		return err
	}
	s.execMu.Lock()
	defer s.execMu.Unlock()
	if session.active {
		session.cancel()
	} else {
		delete(s.execSessions, id)
		session.timer.Stop()
	}
	return nil
}

// Ticket-only upgrade is outside RequireUser: browsers cannot send bearer
// headers here. The one-use capability restores its creating user, whose
// current account and grants are revalidated before any command is sent.
func (s *Service) RegisterExecConnect(r chi.Router, accounts *auth.Service) {
	r.Get("/exec-sessions/{sessionId}/connect", func(w http.ResponseWriter, r *http.Request) {
		s.connectExec(w, r, accounts)
	})
}

func (s *Service) connectExec(w http.ResponseWriter, r *http.Request, accounts *auth.Service) {
	id := chi.URLParam(r, "sessionId")
	err := httpx.UUID(id)
	if err == nil {
		_, err = query(r, "")
	}
	var origin string
	if err == nil {
		origin, err = s.requestOrigin(r, true)
	}
	protocols := websocket.Subprotocols(r)
	if err == nil && (!websocket.IsWebSocketUpgrade(r) || len(protocols) != 2 || protocols[0] != execProtocol || !strings.HasPrefix(protocols[1], "ticket.")) {
		err = httpx.Invalid("需要终端 WebSocket 协议和一次性票据")
	}
	var ticket string
	if err == nil {
		ticket = strings.TrimPrefix(protocols[1], "ticket.")
		decoded, e := base64.RawURLEncoding.DecodeString(ticket)
		if e != nil || len(decoded) != 32 || len(ticket) != 43 {
			err = httpx.Fail(401, "exec_ticket_invalid", "终端票据无效或已过期")
		}
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var headerActor *auth.Actor
	if r.Header.Get("Authorization") != "" {
		parts := strings.Fields(r.Header.Get("Authorization"))
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			httpx.WriteError(w, r, httpx.Fail(401, "unauthorized", "登录凭据无效"))
			return
		}
		a, e := accounts.Authenticate(r.Context(), parts[1])
		if e != nil {
			httpx.WriteError(w, r, e)
			return
		}
		headerActor = &a
	}
	digest := sha256.Sum256([]byte(ticket))
	s.execMu.Lock()
	session := s.execSessions[id]
	if s.execClosing || session == nil || session.active || session.origin != origin || !time.Now().Before(session.expires) || subtle.ConstantTimeCompare(digest[:], session.ticket[:]) != 1 || headerActor != nil && (headerActor.ID != session.actor.ID || headerActor.TokenVersion != session.actor.TokenVersion) {
		s.execMu.Unlock()
		httpx.WriteError(w, r, httpx.Fail(401, "exec_ticket_invalid", "终端票据无效或已过期"))
		return
	}
	deadline := time.Now().Add(time.Hour)
	if !session.actor.ExpiresAt.IsZero() && session.actor.ExpiresAt.Before(deadline) {
		deadline = session.actor.ExpiresAt
	}
	ctx, cancel := context.WithDeadline(r.Context(), deadline)
	defer cancel()
	session.active, session.cancel = true, cancel
	session.ticket = [32]byte{}
	session.timer.Stop()
	s.execWG.Add(1)
	s.execMu.Unlock()
	defer s.execWG.Done()
	defer s.removeExec(session)
	t, q, _ := validateExec(session.input)
	// Resource versions often change while a Pod runs. UID is the continuing
	// identity; creation already checked any supplied initial version.
	q.Del("resourceVersion")
	x, c, err := s.sensitiveClient(ctx, session.actor, session.clusterID, t, q, "pod.exec")
	if err == nil {
		err = verifyPod(ctx, c, t, q)
	}
	if c != nil {
		defer c.Close()
	}
	if err == nil {
		err = s.sensitiveAudit(ctx, session.actor, x, "pod.exec.connect", middleware.GetReqID(r.Context()), execTarget(session))
	}
	if err != nil || ctx.Err() != nil {
		if err == nil {
			err = httpx.Fail(503, "exec_closed", "终端会话已关闭")
		}
		httpx.WriteError(w, r, err)
		return
	}
	upgrader := websocket.Upgrader{HandshakeTimeout: 5 * time.Second, Subprotocols: []string{execProtocol}, CheckOrigin: func(*http.Request) bool { return true }, EnableCompression: false, Error: func(w http.ResponseWriter, r *http.Request, status int, _ error) {
		httpx.WriteError(w, r, httpx.Fail(status, "exec_upgrade_failed", "终端 WebSocket 握手失败"))
	}}
	conn, err := upgrader.Upgrade(w, r, http.Header{"Cache-Control": {"no-store"}})
	if err != nil {
		return
	}
	defer conn.Close()
	s.bridgeExec(ctx, cancel, conn, session, x, c, t, q, middleware.GetReqID(r.Context()))
}

type terminalSizeQueue struct {
	ctx    context.Context
	values chan remotecommand.TerminalSize
}

func (q terminalSizeQueue) Next() *remotecommand.TerminalSize {
	select {
	case v := <-q.values:
		return &v
	case <-q.ctx.Done():
		return nil
	}
}

type terminalWriter struct {
	ctx   context.Context
	send  func(any) error
	kind  string
	mu    *sync.Mutex
	bytes *int64
	tail  []byte
	fail  func(error)
}

func (w *terminalWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.ctx.Err() != nil {
		return 0, w.ctx.Err()
	}
	*w.bytes += int64(len(p))
	if *w.bytes > 20<<20 {
		err := httpx.Fail(413, "exec_output_limit", "终端输出超过字节预算")
		w.fail(err)
		return 0, err
	}
	data := append(w.tail, p...)
	complete := 0
	for complete < len(data) && utf8.FullRune(data[complete:]) {
		_, size := utf8.DecodeRune(data[complete:])
		complete += size
	}
	w.tail = append([]byte(nil), data[complete:]...)
	// Keep frames small even when an upstream writer provides a large chunk.
	for offset := 0; offset < complete; {
		end := min(offset+(16<<10), complete)
		for end < complete && end > offset && !utf8.RuneStart(data[end]) {
			end--
		}
		if end == offset {
			end = min(offset+(16<<10), complete)
		}
		if err := w.send(map[string]any{"type": w.kind, "data": string(data[offset:end])}); err != nil {
			w.fail(err)
			return 0, err
		}
		offset = end
	}
	return len(p), nil
}

func (w *terminalWriter) flush() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.tail) == 0 {
		return nil
	}
	err := w.send(map[string]any{"type": w.kind, "data": string(w.tail)})
	w.tail = nil
	return err
}

type terminalInput struct {
	Type string  `json:"type"`
	Data *string `json:"data,omitempty"`
	Cols *uint16 `json:"cols,omitempty"`
	Rows *uint16 `json:"rows,omitempty"`
}

type terminalStdin struct {
	ctx     context.Context
	input   <-chan string
	pending string
}

func (s *terminalStdin) Read(p []byte) (int, error) {
	for s.pending == "" {
		select {
		case <-s.ctx.Done():
			return 0, io.EOF
		case s.pending = <-s.input:
		}
	}
	n := copy(p, s.pending)
	s.pending = s.pending[n:]
	return n, nil
}

func readTerminalInput(conn *websocket.Conn, stdin chan<- string, sizes terminalSizeQueue, tty bool, activity *atomic.Int64) error {
	total := 0
	for {
		kind, data, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		total += len(data)
		if total > 20<<20 || kind != websocket.TextMessage || !utf8.Valid(data) || httpx.ValidateJSONObject(data) != nil {
			return httpx.Invalid("终端输入无效或超过预算")
		}
		var in terminalInput
		var fields map[string]json.RawMessage
		_ = json.Unmarshal(data, &fields)
		for key, value := range fields {
			if (key != "type" && key != "data" && key != "cols" && key != "rows") || bytes.Equal(value, []byte("null")) {
				return httpx.Invalid("终端帧字段无效")
			}
		}
		dec := json.NewDecoder(bytes.NewReader(data))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&in); err != nil {
			return httpx.Invalid("终端帧无效")
		}
		switch in.Type {
		case "stdin":
			if in.Data == nil || in.Cols != nil || in.Rows != nil {
				return httpx.Invalid("stdin 需要 data")
			}
			activity.Store(time.Now().UnixNano())
			if *in.Data != "" {
				select {
				case stdin <- *in.Data:
				default:
					return httpx.Fail(429, "exec_input_backpressure", "终端输入过快或目标未读取输入")
				}
			}
		case "resize":
			if !tty || in.Data != nil || in.Cols == nil || in.Rows == nil || *in.Cols < 1 || *in.Rows < 1 || *in.Cols > 4096 || *in.Rows > 4096 {
				return httpx.Invalid("resize 需要 TTY 和有效 cols/rows")
			}
			activity.Store(time.Now().UnixNano())
			select {
			case sizes.values <- remotecommand.TerminalSize{Width: *in.Cols, Height: *in.Rows}:
			default: // Coalesce resize bursts without blocking stdin processing.
			}
		case "close":
			if in.Data != nil || in.Cols != nil || in.Rows != nil {
				return httpx.Invalid("close 不接受额外字段")
			}
			return nil
		default:
			return httpx.Invalid("未知终端帧")
		}
	}
}

func terminalError(err error) map[string]any {
	var api *httpx.Error
	if !errors.As(err, &api) {
		api = &httpx.Error{Status: 503, Code: "exec_unavailable", Message: "终端连接中断或不可用"}
	}
	return map[string]any{"type": "error", "code": api.Code, "message": api.Message}
}

func (s *Service) bridgeExec(ctx context.Context, cancel context.CancelFunc, conn *websocket.Conn, session *execSession, x snapshot, c *kubernetes.Client, t ResourceType, q url.Values, requestID string) {
	conn.SetReadLimit(64 << 10)
	// A bounded queue keeps WebSocket reads responsive while the container is
	// not consuming stdin. It must still detect disconnects and close frames.
	input := make(chan string, 4)
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	var writeMu sync.Mutex
	send := func(value any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		return conn.WriteJSON(value)
	}
	var activity atomic.Int64
	activity.Store(time.Now().UnixNano())
	sizes := terminalSizeQueue{ctx, make(chan remotecommand.TerminalSize, 1)}
	readDone, execDone := make(chan error, 1), make(chan error, 1)
	go func() { readDone <- readTerminalInput(conn, input, sizes, *session.input.TTY, &activity) }()
	var outputMu sync.Mutex
	var outputBytes int64
	faults := make(chan error, 1)
	fail := func(err error) {
		select {
		case faults <- err:
		default:
		}
	}
	stdout := &terminalWriter{ctx: ctx, send: send, kind: "stdout", mu: &outputMu, bytes: &outputBytes, fail: fail}
	stderr := &terminalWriter{ctx: ctx, send: send, kind: "stderr", mu: &outputMu, bytes: &outputBytes, fail: fail}
	options := remotecommand.StreamOptions{Stdin: &terminalStdin{ctx: ctx, input: input}, Stdout: stdout, Tty: *session.input.TTY}
	if options.Tty {
		options.TerminalSizeQueue = sizes
	} else {
		options.Stderr = stderr
	}
	go func() {
		execDone <- c.Exec(ctx, session.input.Ref.Namespace, session.input.Ref.Name, session.input.Container, session.input.Command, options)
	}()
	result := "unknown"
	defer func() {
		cancel()
		_ = conn.Close()
		// Join both reader and upstream executor before releasing quota/drain.
		if readDone != nil {
			<-readDone
		}
		if execDone != nil {
			<-execDone
		}
		auditCtx, done := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
		defer done()
		data, _ := json.Marshal(execTarget(session))
		if err := sqlcdb.New(s.pool).RecordAudit(auditCtx, sqlcdb.RecordAuditParams{ActorID: &session.actor.ID, ClusterID: &session.clusterID, Action: "pod.exec.end", Target: data, Result: result, RequestID: requestID}); err != nil {
			slog.Warn("terminal completion audit failed", "session_id", session.id)
		}
	}()
	interval := s.RecheckInterval
	if interval <= 0 {
		interval = 5 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case err := <-faults:
			result = "failed"
			_ = send(terminalError(err))
			return
		case err := <-readDone:
			readDone = nil
			if err != nil {
				_ = send(terminalError(err))
			}
			return
		case err := <-execDone:
			execDone = nil
			// SDK copy errors are not necessarily returned as command errors.
			// A completed command cannot override a prior output budget failure.
			select {
			case fault := <-faults:
				result = "failed"
				_ = send(terminalError(fault))
				return
			default:
			}
			code := 0
			var exit executil.ExitError
			if errors.As(err, &exit) {
				code = exit.ExitStatus()
			} else if err != nil {
				result = "failed"
				_ = send(terminalError(err))
				return
			}
			result = "succeeded"
			if code != 0 {
				result = "failed"
			}
			if stdout.flush() != nil || stderr.flush() != nil {
				return
			}
			_ = send(map[string]any{"type": "exit", "code": code})
			return
		case <-ticker.C:
			if !session.actor.ExpiresAt.IsZero() && !time.Now().Before(session.actor.ExpiresAt) || time.Since(time.Unix(0, activity.Load())) >= 10*time.Minute {
				_ = send(terminalError(httpx.Fail(408, "exec_expired", "登录或终端空闲时限已到")))
				return
			}
			check, done := context.WithTimeout(ctx, 3*time.Second)
			err := s.recheck(check, session.actor, x)
			if err == nil {
				err = verifyPod(check, c, t, q)
			}
			done()
			if err != nil {
				_ = send(terminalError(err))
				return
			}
		}
	}
}

// HTTP Shutdown does not wait for hijacked WebSockets. Register this lifecycle
// worker so all terminal handlers and their upstream goroutines join before PG closes.
func (s *Service) RunExecDraining(drain, work context.Context) {
	select {
	case <-drain.Done():
	case <-work.Done():
	}
	s.execMu.Lock()
	s.execClosing = true
	for id, session := range s.execSessions {
		if session.active {
			session.cancel()
		} else {
			session.timer.Stop()
			delete(s.execSessions, id)
		}
	}
	s.execMu.Unlock()
	s.execWG.Wait()
}
