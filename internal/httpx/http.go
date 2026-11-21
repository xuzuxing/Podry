package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Error struct {
	Status        int
	Code, Message string
}

func (e *Error) Error() string                    { return e.Code + ": " + e.Message }
func Fail(status int, code, message string) error { return &Error{status, code, message} }
func Invalid(message string) error                { return Fail(422, "validation_failed", message) }
func NotFound() error                             { return Fail(404, "not_found", "资源不存在或无权访问") }
func Forbidden() error                            { return Fail(403, "permission_denied", "没有执行此操作的权限") }

func JSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	if status != 204 {
		_ = json.NewEncoder(w).Encode(value)
	}
}
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	w.Header().Set("X-Request-ID", middleware.GetReqID(r.Context()))
	if strings.HasPrefix(r.URL.Path, "/api") {
		w.Header().Set("Cache-Control", "no-store")
	}
	var api *Error
	if !errors.As(err, &api) {
		api = &Error{500, "internal_error", "服务内部错误"}
		var pg *pgconn.PgError
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			api = &Error{404, "not_found", "资源不存在或无权访问"}
		case errors.Is(err, context.DeadlineExceeded):
			api = &Error{504, "request_timeout", "请求超时"}
		case errors.As(err, &pg):
			switch pg.Code {
			case "23505":
				api = &Error{409, "already_exists", "名称或关联已存在"}
			case "23503", "23514", "22P02":
				api = &Error{422, "validation_failed", "引用对象或字段无效"}
			case "40001", "40P01":
				api = &Error{409, "revision_conflict", "数据已变更，请重试"}
			}
		}
		if api.Status == 500 {
			slog.ErrorContext(r.Context(), "request failed", "request_id", middleware.GetReqID(r.Context()), "error_type", errorType(err))
		}
	}
	JSON(w, api.Status, map[string]any{"error": map[string]string{"code": api.Code, "message": api.Message}})
}

// Do not log driver messages: they can include values from failed constraints.
func errorType(err error) string {
	var p *pgconn.PgError
	if errors.As(err, &p) {
		return "postgres_" + p.Code
	}
	return "internal"
}

func Decode(w http.ResponseWriter, r *http.Request, dst any) error {
	typ, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || typ != "application/json" {
		return Fail(415, "unsupported_media_type", "请求体必须为 application/json")
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		var max *http.MaxBytesError
		if errors.As(err, &max) {
			return Fail(413, "payload_too_large", "请求体过大")
		}
		return Invalid("无法读取 JSON")
	}
	// Reject duplicate keys before decoding typed structs so request hashes and validation agree.
	if err = checkJSON(data); err != nil {
		return Invalid("JSON 无效、字段重复或嵌套过深")
	}
	if err = checkFields(data, reflect.TypeOf(dst)); err != nil {
		return Invalid("JSON 字段名称或 null 值无效")
	}
	dec := json.NewDecoder(strings.NewReader(string(data)))
	dec.DisallowUnknownFields()
	if err = dec.Decode(dst); err != nil {
		return Invalid("JSON 字段、类型或必填字段无效")
	}
	return nil
}

// encoding/json accepts case-insensitive aliases and null for scalar fields;
// the API contract accepts only exact JSON names and explicit nullable pointers.
func checkFields(data []byte, typ reflect.Type) error {
	if typ.Kind() == reflect.Pointer {
		if string(data) == "null" {
			return nil
		}
		typ = typ.Elem()
	}
	if typ.Kind() == reflect.Slice && typ.Elem().Kind() != reflect.Uint8 {
		var items []json.RawMessage
		if err := json.Unmarshal(data, &items); err != nil {
			return err
		}
		for _, item := range items {
			if err := checkFields(item, typ.Elem()); err != nil {
				return err
			}
		}
		return nil
	}
	if typ.Kind() != reflect.Struct {
		return nil
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		return err
	}
	fields := map[string]reflect.Type{}
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		if !f.IsExported() {
			continue
		}
		tag := strings.Split(f.Tag.Get("json"), ",")[0]
		if tag == "-" {
			continue
		}
		if tag == "" {
			tag = f.Name
		}
		fields[tag] = f.Type
	}
	for key, value := range object {
		ft, ok := fields[key]
		if !ok {
			return errors.New("unknown field")
		}
		if string(value) == "null" && ft.Kind() != reflect.Pointer && ft.Kind() != reflect.Interface {
			return errors.New("non-null field")
		}
		if err := checkFields(value, ft); err != nil {
			return err
		}
	}
	return nil
}
func checkJSON(data []byte) error {
	dec := json.NewDecoder(strings.NewReader(string(data)))
	dec.UseNumber()
	var walk func(int) error
	walk = func(depth int) error {
		if depth > 64 {
			return errors.New("depth")
		}
		t, e := dec.Token()
		if e != nil {
			return e
		}
		d, ok := t.(json.Delim)
		if !ok {
			return nil
		}
		switch d {
		case '{':
			keys := map[string]bool{}
			for dec.More() {
				key, e := dec.Token()
				if e != nil {
					return e
				}
				s, ok := key.(string)
				if !ok || keys[s] {
					return errors.New("duplicate key")
				}
				keys[s] = true
				if e = walk(depth + 1); e != nil {
					return e
				}
			}
		case '[':
			for dec.More() {
				if e := walk(depth + 1); e != nil {
					return e
				}
			}
		default:
			return errors.New("delimiter")
		}
		_, e = dec.Token()
		return e
	}
	if err := walk(0); err != nil {
		return err
	}
	if _, err := dec.Token(); err != io.EOF {
		return errors.New("trailing data")
	}
	if len(data) == 0 || data[0] != '{' { // Whitespace is permitted, but the top-level value must be an object.
		trimmed := strings.TrimSpace(string(data))
		if len(trimmed) == 0 || trimmed[0] != '{' {
			return errors.New("object required")
		}
	}
	return nil
}

func UUID(value string) error {
	id, err := uuid.Parse(value)
	if err != nil || id == uuid.Nil || value != id.String() {
		return Invalid("UUID 格式无效")
	}
	return nil
}
func OptionalUUID(value string) (*string, error) {
	if value == "" {
		return nil, nil
	}
	if err := UUID(value); err != nil {
		return nil, err
	}
	return &value, nil
}
func Name(value string) (string, error) {
	value = strings.TrimSpace(value)
	if len([]rune(value)) < 1 || len([]rune(value)) > 100 {
		return "", Invalid("名称长度必须为 1–100 个字符")
	}
	return value, nil
}

type Pagination struct{ Page, PageSize int }

func Page(r *http.Request) (Pagination, error) {
	p := Pagination{1, 20}
	for key, dest := range map[string]*int{"page": &p.Page, "pageSize": &p.PageSize} {
		if v := r.URL.Query().Get(key); v != "" {
			n, e := strconv.Atoi(v)
			if e != nil || n < 1 {
				return p, Invalid("分页参数无效")
			}
			*dest = n
		}
	}
	if p.PageSize > 100 || p.Page > 1000000 {
		return p, Invalid("分页参数超出范围")
	}
	return p, nil
}
func (p Pagination) Offset() int32 { return int32((p.Page - 1) * p.PageSize) }

type PageResult[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

func RequestBoundary(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-ID", middleware.GetReqID(r.Context()))
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		defer func() {
			if recover() != nil {
				WriteError(w, r, Fail(500, "internal_error", "服务内部错误"))
			}
		}()
		// Pod logs have their own bounded lifetime and periodic authorization checks.
		timeout := 25 * time.Second
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if r.Method == http.MethodGet && len(parts) == 4 && parts[0] == "api" && parts[1] == "clusters" && UUID(parts[2]) == nil && parts[3] == "pod-logs" {
			timeout = 5 * time.Minute
		}
		if r.Method == http.MethodGet && len(parts) == 4 && parts[0] == "api" && parts[1] == "builds" && UUID(parts[2]) == nil && parts[3] == "logs" {
			timeout = 5 * time.Minute
		}
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
