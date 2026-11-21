package project

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/httpx"
)

func (s *Service) Register(r chi.Router) {
	r.Get("/teams", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.ListTeams(r.Context(), auth.Current(r.Context()))
		respond(w, r, 200, out, err)
	})
	r.Post("/teams", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Name string `json:"name"`
		}
		if err := httpx.Decode(w, r, &in); err != nil {
			respond(w, r, 0, nil, err)
			return
		}
		out, err := s.CreateTeam(r.Context(), auth.Current(r.Context()), in.Name, middleware.GetReqID(r.Context()))
		respond(w, r, 201, out, err)
	})
	r.Get("/projects", func(w http.ResponseWriter, r *http.Request) {
		team, err := httpx.OptionalUUID(r.URL.Query().Get("teamId"))
		if err != nil {
			respond(w, r, 0, nil, err)
			return
		}
		out, err := s.ListProjects(r.Context(), auth.Current(r.Context()), team)
		respond(w, r, 200, out, err)
	})
	r.Post("/projects", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			TeamID string `json:"teamId"`
			Name   string `json:"name"`
		}
		if err := httpx.Decode(w, r, &in); err != nil {
			respond(w, r, 0, nil, err)
			return
		}
		out, err := s.CreateProject(r.Context(), auth.Current(r.Context()), in.TeamID, in.Name, middleware.GetReqID(r.Context()))
		respond(w, r, 201, out, err)
	})
	for _, scope := range []string{"teams", "projects"} {
		key := "teamId"
		if scope == "projects" {
			key = "projectId"
		}
		r.Route("/"+scope+"/{"+key+"}/members", func(r chi.Router) {
			r.Use(func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if err := httpx.UUID(chi.URLParam(r, key)); err != nil {
						respond(w, r, 0, nil, err)
						return
					}
					next.ServeHTTP(w, r)
				})
			})
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				out, err := s.Members(r.Context(), auth.Current(r.Context()), scope, chi.URLParam(r, key))
				respond(w, r, 200, out, err)
			})
			r.Post("/", func(w http.ResponseWriter, r *http.Request) {
				var in Member
				if err := httpx.Decode(w, r, &in); err != nil {
					respond(w, r, 0, nil, err)
					return
				}
				err := s.ChangeMember(r.Context(), auth.Current(r.Context()), scope, chi.URLParam(r, key), in, false, middleware.GetReqID(r.Context()))
				respond(w, r, 201, in, err)
			})
			r.Delete("/{userId}", func(w http.ResponseWriter, r *http.Request) {
				err := s.ChangeMember(r.Context(), auth.Current(r.Context()), scope, chi.URLParam(r, key), Member{UserID: chi.URLParam(r, "userId")}, true, middleware.GetReqID(r.Context()))
				respond(w, r, 204, nil, err)
			})
		})
	}
}
func respond(w http.ResponseWriter, r *http.Request, status int, value any, err error) {
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, status, value)
}
