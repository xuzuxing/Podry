package application

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
)

func (s *Service) acquireBuildLog(id string) bool {
	s.buildLogMu.Lock()
	defer s.buildLogMu.Unlock()
	if s.buildLogActive >= 16 || s.buildLogUsers[id] >= 2 {
		return false
	}
	if s.buildLogUsers == nil {
		s.buildLogUsers = map[string]int{}
	}
	s.buildLogActive++
	s.buildLogUsers[id]++
	return true
}
func (s *Service) releaseBuildLog(id string) {
	s.buildLogMu.Lock()
	defer s.buildLogMu.Unlock()
	s.buildLogActive--
	s.buildLogUsers[id]--
	if s.buildLogUsers[id] == 0 {
		delete(s.buildLogUsers, id)
	}
}
func (s *Service) authorizeBuildLog(ctx context.Context, a auth.Actor, id string) (build.Build, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (build.Build, error) {
		if e := auth.LockActor(ctx, q, a); e != nil {
			return build.Build{}, e
		}
		b, e := q.GetBuild(ctx, id)
		if e != nil {
			return build.Build{}, e
		}
		if _, e = access(ctx, q, a, b.AppID, false); e != nil {
			return build.Build{}, e
		}
		return buildDTO(b), nil
	})
}
func (s *Service) signBuildCursor(c gitCursor) string {
	data, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(s.cursorMAC(data))
}
func (s *Service) buildLogs(w http.ResponseWriter, r *http.Request) {
	a := auth.Current(r.Context())
	id := chi.URLParam(r, "buildId")
	q := r.URL.Query()
	attemptNo := 1
	for k, v := range q {
		if (k != "attemptNo" && k != "follow" && k != "cursor") || len(v) != 1 {
			reply(w, r, 0, nil, httpx.Invalid("日志查询参数无效或重复"))
			return
		}
	}
	if q.Has("attemptNo") {
		n, e := strconv.Atoi(q.Get("attemptNo"))
		if e != nil || n < 1 || n > 10000 {
			reply(w, r, 0, nil, httpx.Invalid("attemptNo 无效"))
			return
		}
		attemptNo = n
	}
	if q.Has("follow") && q.Get("follow") != "true" && q.Get("follow") != "false" {
		reply(w, r, 0, nil, httpx.Invalid("follow 必须为 true 或 false"))
		return
	}
	follow := q.Get("follow") == "true"
	b, e := s.authorizeBuildLog(r.Context(), a, id)
	if e != nil {
		reply(w, r, 0, nil, e)
		return
	}
	if !q.Has("attemptNo") {
		attemptNo = int(b.AttemptNo)
	}
	row, e := s.q.GetBuildAttempt(r.Context(), sqlcdb.GetBuildAttemptParams{BuildID: id, AttemptNo: int32(attemptNo)})
	if e != nil {
		reply(w, r, 0, nil, e)
		return
	}
	if s.builds == nil {
		reply(w, r, 0, nil, httpx.Fail(404, "log_unavailable", "构建日志尚未可用"))
		return
	}
	if e = s.auditBuildLog(r.Context(), a, b.AppID, id, "build.logs.start", middleware.GetReqID(r.Context())); e != nil {
		reply(w, r, 0, nil, e)
		return
	}
	defer func() {
		endCtx, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		_ = s.auditBuildLog(endCtx, a, b.AppID, id, "build.logs.end", middleware.GetReqID(r.Context()))
	}()
	scope := digest([]any{a.ID, a.TokenVersion, row.ID, row.JobUid})
	cursor, e := s.readSignedCursor(q.Get("cursor"), scope, 0, 100000, "日志")
	if e != nil {
		reply(w, r, 0, nil, e)
		return
	}
	if !s.acquireBuildLog(a.ID) {
		reply(w, r, 0, nil, httpx.Fail(429, "log_stream_limit", "构建日志并发数已达上限"))
		return
	}
	defer s.releaseBuildLog(a.ID)
	deadline := time.Now().Add(5 * time.Minute)
	if !a.ExpiresAt.IsZero() && a.ExpiresAt.Before(deadline) {
		deadline = a.ExpiresAt
	}
	ctx, cancel := context.WithDeadline(r.Context(), deadline)
	defer cancel()
	opened := false
	rc := http.NewResponseController(w)
	defer rc.SetWriteDeadline(time.Time{})
	send := func(v any) error {
		if !opened {
			w.Header().Set("Content-Type", "application/x-ndjson")
			w.Header().Set("Cache-Control", "no-store")
			opened = true
		}
		if e := rc.SetWriteDeadline(time.Now().Add(5 * time.Second)); e != nil && !errors.Is(e, http.ErrNotSupported) {
			return e
		}
		if e := json.NewEncoder(w).Encode(v); e != nil {
			return e
		}
		if e := rc.Flush(); e != nil && !errors.Is(e, http.ErrNotSupported) {
			return e
		}
		return nil
	}
	fail := func(e error) {
		if !opened {
			reply(w, r, 0, nil, e)
			return
		}
		code := "log_stream_unavailable"
		message := "构建日志流已关闭"
		var api *httpx.Error
		if errors.As(e, &api) {
			code = api.Code
			message = api.Message
		}
		_ = send(map[string]any{"type": "error", "code": code, "message": message})
	}
	for {
		ioCtx, stop := context.WithTimeout(ctx, 20*time.Second)
		lines, e := s.builds.ReadLogs(ioCtx, row)
		stop()
		if e != nil {
			fail(e)
			return
		}
		checkCtx, stop := context.WithTimeout(ctx, 3*time.Second)
		_, e = s.authorizeBuildLog(checkCtx, a, id)
		stop()
		if e != nil {
			fail(e)
			return
		}
		if cursor.Offset > len(lines) {
			fail(httpx.Fail(409, "log_cursor_changed", "日志已轮转或内容发生变化"))
			return
		}
		prefix := ""
		for _, line := range lines[:cursor.Offset] {
			prefix = digest([]any{prefix, line})
		}
		if cursor.Offset > 0 && cursor.Snapshot != prefix {
			fail(httpx.Fail(409, "log_cursor_changed", "日志游标不再匹配当前内容"))
			return
		}
		checked := time.Now()
		for _, line := range lines[cursor.Offset:] {
			if ctx.Err() != nil {
				fail(httpx.Fail(408, "log_stream_expired", "日志流已到期"))
				return
			}
			if time.Since(checked) >= 5*time.Second {
				checkCtx, stop := context.WithTimeout(ctx, 3*time.Second)
				_, e = s.authorizeBuildLog(checkCtx, a, id)
				stop()
				if e != nil {
					fail(e)
					return
				}
				checked = time.Now()
			}
			prefix = digest([]any{prefix, line})
			cursor.Offset++
			cursor.Snapshot = prefix
			cursor.Scope = scope
			cursor.Expires = time.Now().Add(10 * time.Minute).Unix()
			if e = send(map[string]any{"type": "log", "phase": line.Phase, "timestamp": line.Timestamp, "message": line.Message, "cursor": s.signBuildCursor(cursor)}); e != nil {
				return
			}
		}
		cursor.Scope = scope
		cursor.Snapshot = prefix
		cursor.Expires = time.Now().Add(10 * time.Minute).Unix()
		terminal := row.Status == "succeeded" || row.Status == "failed" || row.Status == "canceled"
		if !follow || terminal {
			_ = send(map[string]any{"type": "end", "status": row.Status, "cursor": s.signBuildCursor(cursor)})
			return
		}
		select {
		case <-ctx.Done():
			fail(httpx.Fail(408, "log_stream_expired", "日志流已到期"))
			return
		case <-time.After(2 * time.Second):
		}
		row, e = s.q.GetBuildAttempt(ctx, sqlcdb.GetBuildAttemptParams{BuildID: id, AttemptNo: int32(attemptNo)})
		if e != nil {
			fail(e)
			return
		}
	}
}

func (s *Service) auditBuildLog(ctx context.Context, a auth.Actor, appID, buildID, action, req string) error {
	_, e := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		app, e := q.GetApplication(ctx, appID)
		if e != nil {
			return false, e
		}
		return true, record(ctx, q, a, app, action, req, map[string]string{"buildId": buildID})
	})
	return e
}
