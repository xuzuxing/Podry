package application

import (
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/httpx"
	"net/http"
)

func (s *Service) registerAppBuildRoutes(r chi.Router) {
	r.Get("/builds", func(w http.ResponseWriter, r *http.Request) {
		page, e := httpx.Page(r)
		if e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		out, e := s.ListBuilds(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), page)
		reply(w, r, 200, out, e)
	})
	r.Post("/builds", func(w http.ResponseWriter, r *http.Request) {
		var in BuildInput
		if e := httpx.Decode(w, r, &in); e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		out, e := s.TriggerBuild(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), in, r.Header.Get("Idempotency-Key"), middleware.GetReqID(r.Context()))
		if e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		httpx.JSON(w, out.Status, out.Body)
	})
	r.Get("/artifacts", func(w http.ResponseWriter, r *http.Request) {
		page, e := httpx.Page(r)
		if e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		out, e := s.ListArtifacts(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), page)
		reply(w, r, 200, out, e)
	})
}
func (s *Service) registerBuildRoutes(r chi.Router) {
	r.Route("/builds/{buildId}", func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if e := httpx.UUID(chi.URLParam(r, "buildId")); e != nil {
					reply(w, r, 0, nil, e)
					return
				}
				next.ServeHTTP(w, r)
			})
		})
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			out, e := s.GetBuild(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "buildId"))
			reply(w, r, 200, out, e)
		})
		r.Get("/attempts", func(w http.ResponseWriter, r *http.Request) {
			out, e := s.BuildAttempts(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "buildId"))
			reply(w, r, 200, out, e)
		})
		r.Get("/logs", s.buildLogs)
	})
}
