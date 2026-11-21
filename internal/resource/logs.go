package resource

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/kubernetes"
)

func (s *Service) acquire(user string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active >= 16 || s.streams[user] >= 2 {
		return false
	}
	s.active++
	s.streams[user]++
	return true
}
func (s *Service) release(user string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.active--
	s.streams[user]--
	if s.streams[user] == 0 {
		delete(s.streams, user)
	}
}
func logQuery(q url.Values) (url.Values, error) {
	out := url.Values{"timestamps": {"true"}, "tailLines": {"200"}, "follow": {"false"}, "previous": {"false"}}
	for _, k := range []string{"follow", "previous"} {
		if v := q.Get(k); v != "" {
			if v != "true" && v != "false" {
				return nil, httpx.Invalid(k + " 必须为 true 或 false")
			}
			out.Set(k, v)
		}
	}
	for _, k := range []string{"tailLines", "sinceSeconds"} {
		if v := q.Get(k); v != "" {
			n, e := strconv.ParseInt(v, 10, 64)
			max := int64(604800)
			if k == "tailLines" {
				max = 10000
			}
			if e != nil || n < 1 || n > max {
				return nil, httpx.Invalid(k + " 超出允许范围")
			}
			out.Set(k, v)
		}
	}
	if !validSegment(q.Get("container"), 63) || q.Get("uid") == "" {
		return nil, httpx.Invalid("uid 和 container 必填")
	}
	out.Set("container", q.Get("container"))
	return out, nil
}
func verifyPod(ctx context.Context, c *kubernetes.Client, t ResourceType, q url.Values) error {
	var raw map[string]any
	if e := c.Get(ctx, t.path(q.Get("namespace"), q.Get("name")), nil, &raw); e != nil {
		return e
	}
	if e := validateObject(t, raw, q.Get("namespace"), q.Get("name")); e != nil {
		return e
	}
	if e := checkIdentity(raw, q); e != nil {
		return e
	}
	for _, field := range []string{"containers", "initContainers", "ephemeralContainers"} {
		items, _ := obj(raw, "spec")[field].([]any)
		for _, item := range items {
			m, _ := item.(map[string]any)
			if str(m, "name") == q.Get("container") {
				return nil
			}
		}
	}
	return httpx.Invalid("container 不属于目标 Pod")
}
func streamError(err error) map[string]any {
	var api *httpx.Error
	if !errors.As(err, &api) {
		api = &httpx.Error{Status: 503, Code: "log_stream_unavailable", Message: "日志流读取失败"}
	}
	return map[string]any{"type": "error", "code": api.Code, "message": api.Message}
}
func (s *Service) logs(w http.ResponseWriter, r *http.Request) {
	q, err := query(r, "namespace name uid container tailLines sinceSeconds previous follow")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	upstream, err := logQuery(q)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	a := auth.Current(r.Context())
	id := chi.URLParam(r, "clusterId")
	deadline := time.Now().Add(5 * time.Minute)
	if !a.ExpiresAt.IsZero() && a.ExpiresAt.Before(deadline) {
		deadline = a.ExpiresAt
	}
	ctx, cancel := context.WithDeadline(r.Context(), deadline)
	defer cancel()
	x, c, err := s.client(ctx, a, id, "core/pods", "pod.logs")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer c.Close()
	t := ResourceType{Version: "v1", Resource: "pods", Kind: "Pod", Namespaced: true, Verbs: []string{"get"}}
	if err = scope(x, t, q, "pod.logs", "get", true); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if !s.acquire(a.ID) {
		httpx.WriteError(w, r, httpx.Fail(429, "log_stream_limit", "日志流并发数已达上限"))
		return
	}
	defer s.release(a.ID)
	if err = verifyPod(ctx, c, t, q); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	body, err := c.Open(ctx, t.path(q.Get("namespace"), q.Get("name"))+"/log", upstream)
	if err != nil {
		var api *httpx.Error
		if errors.As(err, &api) && api.Code == "kubernetes_invalid_query" {
			err = httpx.Fail(422, "pod_logs_unavailable", "目标容器的当前或历史日志暂不可用，请查看 Pod 状态")
		}
		httpx.WriteError(w, r, err)
		return
	}
	defer body.Close()
	// Kubernetes log reads have no UID precondition. Check again before releasing any bytes.
	if err = verifyPod(ctx, c, t, q); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = s.recheck(ctx, a, x); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	target, _ := json.Marshal(map[string]string{"clusterId": id, "namespace": q.Get("namespace"), "name": q.Get("name"), "uid": q.Get("uid"), "container": q.Get("container")})
	audit := func(ctx context.Context, result string) error {
		return sqlcdb.New(s.pool).RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &a.ID, ClusterID: &id, Action: "pod.logs", Target: target, RequestID: middleware.GetReqID(r.Context()), Result: result})
	}
	if err = audit(ctx, "accepted"); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	result := "failed"
	defer func() {
		auditCtx, done := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
		defer done()
		_ = audit(auditCtx, result)
	}()
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	controller := http.NewResponseController(w)
	defer controller.SetWriteDeadline(time.Time{})
	send := func(value any) bool {
		_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if json.NewEncoder(w).Encode(value) != nil {
			return false
		}
		return controller.Flush() == nil
	}
	w.WriteHeader(200)
	if controller.Flush() != nil {
		return
	}
	type line struct {
		value string
		err   error
		end   bool
	}
	lines := make(chan line, 1)
	go func() {
		scanner := bufio.NewScanner(io.LimitReader(body, (20<<20)+1))
		scanner.Buffer(make([]byte, 4096), 64<<10)
		total := 0
		for scanner.Scan() {
			v := scanner.Text()
			total += len(v) + 1
			if total > 20<<20 {
				select {
				case lines <- line{err: httpx.Fail(503, "log_read_limit", "日志超过字节预算")}:
				case <-ctx.Done():
				}
				return
			}
			select {
			case lines <- line{value: v}:
			case <-ctx.Done():
				return
			}
		}
		e := scanner.Err()
		if e != nil {
			e = httpx.Fail(503, "log_stream_interrupted", "日志流中断或单行超过读取预算")
		}
		select {
		case lines <- line{err: e, end: true}:
		case <-ctx.Done():
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
			if r.Context().Err() == nil {
				send(streamError(httpx.Fail(408, "log_stream_expired", "登录或日志流时限已到，请重新请求")))
			}
			return
		case <-ticker.C:
			checkCtx, done := context.WithTimeout(ctx, 3*time.Second)
			err = s.recheck(checkCtx, a, x)
			if err == nil {
				err = verifyPod(checkCtx, c, t, q)
			}
			done()
			if err != nil {
				send(streamError(err))
				return
			}
		case entry := <-lines:
			if ctx.Err() != nil {
				if r.Context().Err() == nil {
					send(streamError(httpx.Fail(408, "log_stream_expired", "登录或日志流时限已到，请重新请求")))
				}
				return
			}
			if entry.err != nil {
				send(streamError(entry.err))
				return
			}
			if entry.end {
				result = "succeeded"
				send(map[string]string{"type": "end"})
				return
			}
			timestamp, message := "", entry.value
			if i := strings.IndexByte(entry.value, ' '); i > 0 {
				if _, e := time.Parse(time.RFC3339Nano, entry.value[:i]); e == nil {
					timestamp = entry.value[:i]
					message = entry.value[i+1:]
				}
			}
			if !send(map[string]string{"type": "log", "timestamp": timestamp, "message": message}) {
				return
			}
		}
	}
}
