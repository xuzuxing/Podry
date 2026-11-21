package resource

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/httpx"
)

// Reject duplicate and unknown query keys so pagination and authorization share one meaning.
func query(r *http.Request, allowed string) (url.Values, error) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(r.URL.RawQuery) > 49152 {
		return nil, httpx.Invalid("查询参数无效或过长")
	}
	for k, v := range q {
		if len(v) != 1 || !strings.Contains(" "+allowed+" ", " "+k+" ") {
			return nil, httpx.Invalid("未知或重复的查询参数")
		}
	}
	return q, nil
}
func (s *Service) Register(r chi.Router) {
	s.registerWriteRoutes(r)
	s.registerSensitiveRoutes(r)
	routes := map[string]struct {
		keys string
		call func(*http.Request, url.Values) (any, error)
	}{
		"/discovery": {"", func(r *http.Request, _ url.Values) (any, error) {
			return s.Discover(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"))
		}},
		"/namespaces": {"", func(r *http.Request, _ url.Values) (any, error) {
			return s.Namespaces(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"))
		}},
		"/resources": {"group version resource namespace labelSelector fieldSelector limit continueToken", func(r *http.Request, q url.Values) (any, error) {
			return s.List(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"), q)
		}},
		"/resource": {"group version resource namespace name uid resourceVersion", func(r *http.Request, q url.Values) (any, error) {
			return s.Get(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"), q)
		}},
		"/events": {"group version resource namespace name uid resourceVersion", func(r *http.Request, q url.Values) (any, error) {
			return s.Events(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"), q)
		}},
	}
	for path, handler := range routes {
		r.Get(path, func(w http.ResponseWriter, r *http.Request) {
			q, err := query(r, handler.keys)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			out, err := handler.call(r, q)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			httpx.JSON(w, 200, out)
		})
	}
	r.Get("/pod-logs", s.logs)
}
