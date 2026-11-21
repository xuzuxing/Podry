package application

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/httpx"
)

func reply(w http.ResponseWriter, r *http.Request, status int, out any, err error) {
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, status, out)
}
func input[T any](status int, fn func(*http.Request, T) (any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in T
		if err := httpx.Decode(w, r, &in); err != nil {
			reply(w, r, 0, nil, err)
			return
		}
		out, err := fn(r, in)
		reply(w, r, status, out, err)
	}
}
func (s *Service) Register(r chi.Router) {
	s.registerBuildRoutes(r)
	s.registerReleaseRoutes(r)
	r.Get("/apps", func(w http.ResponseWriter, r *http.Request) {
		projectID, err := httpx.OptionalUUID(r.URL.Query().Get("projectId"))
		if err != nil {
			reply(w, r, 0, nil, err)
			return
		}
		environmentID, err := httpx.OptionalUUID(r.URL.Query().Get("environmentId"))
		if err != nil {
			reply(w, r, 0, nil, err)
			return
		}
		page, err := httpx.Page(r)
		if err != nil {
			reply(w, r, 0, nil, err)
			return
		}
		out, err := s.List(r.Context(), auth.Current(r.Context()), projectID, environmentID, r.URL.Query().Get("health"), r.URL.Query().Get("keyword"), page)
		reply(w, r, 200, out, err)
	})
	r.Post("/apps", input[ApplicationInput](201, func(r *http.Request, in ApplicationInput) (any, error) {
		return s.Create(r.Context(), auth.Current(r.Context()), in, middleware.GetReqID(r.Context()))
	}))
	r.Route("/apps/{appId}", func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := httpx.UUID(chi.URLParam(r, "appId")); err != nil {
					reply(w, r, 0, nil, err)
					return
				}
				next.ServeHTTP(w, r)
			})
		})
		s.registerAppBuildRoutes(r)
		s.registerAppReleaseRoutes(r)
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.Get(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"))
			reply(w, r, 200, out, err)
		})
		r.Patch("/", input[ApplicationPatch](200, func(r *http.Request, in ApplicationPatch) (any, error) {
			return s.Update(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), in, middleware.GetReqID(r.Context()))
		}))
		r.Get("/config", func(w http.ResponseWriter, r *http.Request) {
			var version int64
			if v := r.URL.Query().Get("version"); v != "" {
				var err error
				version, err = strconv.ParseInt(v, 10, 32)
				if err != nil || version < 1 {
					reply(w, r, 0, nil, httpx.Invalid("version 必须是正整数"))
					return
				}
			}
			out, err := s.GetConfig(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), int32(version))
			reply(w, r, 200, out, err)
		})
		r.Put("/config", input[ConfigInput](200, func(r *http.Request, in ConfigInput) (any, error) {
			return s.SaveConfig(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), in, middleware.GetReqID(r.Context()))
		}))
		r.Get("/setup", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.GetSetup(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"))
			reply(w, r, 200, out, err)
		})
		for _, kind := range []string{"branches", "commits"} {
			r.Get("/git/"+kind, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "no-store")
				query, err := parseGitQuery(r.URL.Query(), kind == "commits")
				if err != nil {
					reply(w, r, 0, nil, err)
					return
				}
				var out any
				if kind == "commits" {
					out, err = s.GitCommits(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), query)
				} else {
					out, err = s.GitBranches(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), query)
				}
				reply(w, r, 200, out, err)
			})
		}
		r.Get("/environments", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.GetBindings(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"))
			reply(w, r, 200, out, err)
		})
		r.Post("/environments", input[BindingInput](201, func(r *http.Request, in BindingInput) (any, error) {
			return s.CreateBinding(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), in, middleware.GetReqID(r.Context()))
		}))
		r.Put("/environments/{bindingId}", input[BindingUpdate](200, func(r *http.Request, in BindingUpdate) (any, error) {
			return s.UpdateBinding(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), chi.URLParam(r, "bindingId"), in, middleware.GetReqID(r.Context()))
		}))
		r.Get("/pipelines", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.GetWorkflow(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"))
			reply(w, r, 200, out, err)
		})
		r.Put("/pipelines", input[WorkflowInput](200, func(r *http.Request, in WorkflowInput) (any, error) {
			return s.SaveWorkflow(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), in, middleware.GetReqID(r.Context()))
		}))
		r.Post("/workflow-templates", func(w http.ResponseWriter, r *http.Request) {
			var in TemplateInput
			if err := httpx.Decode(w, r, &in); err != nil {
				reply(w, r, 0, nil, err)
				return
			}
			out, err := s.CreateTemplate(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), in, r.Header.Get("Idempotency-Key"), middleware.GetReqID(r.Context()))
			if err != nil {
				reply(w, r, 0, nil, err)
				return
			}
			httpx.JSON(w, out.Status, out.Body)
		})
	})
}
