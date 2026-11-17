package server

import (
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strings"

	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"
)

// New 构建服务端的 HTTP 路由。
func New(webFS fs.FS) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(requestLogger)
	r.Use(httprate.LimitByIP(100, time.Minute))
	r.Use(middleware.Compress(5))

	r.Get("/healthz", handleHealthz)

	// 内嵌前端兜底路由:静态命中直接返回,其余路径交给 SPA 前端路由。
	r.Handle("/*", spaHandler(webFS))

	return r
}

// ---- Middleware --------------------------------------------------------

// requestLogger logs each request as a structured slog line.
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)
		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"bytes", ww.BytesWritten(),
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", middleware.GetReqID(r.Context()),
		)
	})
}

// ---- Static / SPA --------------------------------------------------------

func handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// spaHandler 从内嵌前端目录提供静态资源,未命中的页面路径回退到 index.html。
func spaHandler(webFS fs.FS) http.Handler {
	files := http.FileServer(http.FS(webFS))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")

		if _, err := fs.Stat(webFS, name); err == nil {
			files.ServeHTTP(w, r)
			return
		}
		// 带扩展名或 assets/ 下的缺失文件应返回 404,不要伪装成页面。
		if strings.HasPrefix(name, "assets/") || path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}

		serveIndex(w, r, webFS)
	})
}

func serveIndex(w http.ResponseWriter, r *http.Request, webFS fs.FS) {
	data, err := fs.ReadFile(webFS, "index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(data)
}

// ---- JSON helpers --------------------------------------------------------

// writeJSON 统一以 camelCase JSON 输出。
func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

type errBody struct {
	Error errDetail `json:"error"`
}

type errDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// writeError 输出统一错误响应:{ "error": { "code": "...", "message": "..." } }
// msg 以 zh-CN 源串写在调用点;此处按请求 locale(localeMiddleware 解析)本地化。
func writeError(w http.ResponseWriter, code int, errCode, msg string) {
	writeJSON(w, code, errBody{Error: errDetail{Code: errCode, Message: msg}})
}
