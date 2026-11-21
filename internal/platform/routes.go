package platform

import (
	"net/http"

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
func (s *Service) Register(r chi.Router, clusterRoutes ...func(chi.Router)) {
	r.Route("/credentials", func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "no-store")
				next.ServeHTTP(w, r)
			})
		})
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.ListCredentials(r.Context(), auth.Current(r.Context()))
			reply(w, r, 200, out, err)
		})
		r.Post("/", input[CredentialInput](201, func(r *http.Request, in CredentialInput) (any, error) {
			return s.CreateCredential(r.Context(), auth.Current(r.Context()), in, middleware.GetReqID(r.Context()))
		}))
		r.Put("/{credentialId}", input[CredentialUpdate](200, func(r *http.Request, in CredentialUpdate) (any, error) {
			id := chi.URLParam(r, "credentialId")
			if err := httpx.UUID(id); err != nil {
				return nil, err
			}
			return s.RotateCredential(r.Context(), auth.Current(r.Context()), id, in, middleware.GetReqID(r.Context()))
		}))
	})
	r.Get("/registries", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.ListRegistries(r.Context())
		reply(w, r, 200, out, err)
	})
	r.Post("/registries", input[RegistryInput](201, func(r *http.Request, in RegistryInput) (any, error) {
		return s.CreateRegistry(r.Context(), auth.Current(r.Context()), in, middleware.GetReqID(r.Context()))
	}))
	r.Get("/environments", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.ListEnvironments(r.Context())
		reply(w, r, 200, out, err)
	})
	r.Post("/environments", input[EnvironmentInput](201, func(r *http.Request, in EnvironmentInput) (any, error) {
		return s.CreateEnvironment(r.Context(), auth.Current(r.Context()), in, middleware.GetReqID(r.Context()))
	}))
	r.Get("/clusters", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.ListClusters(r.Context(), auth.Current(r.Context()))
		reply(w, r, 200, out, err)
	})
	r.Post("/clusters", input[ClusterInput](201, func(r *http.Request, in ClusterInput) (any, error) {
		return s.CreateCluster(r.Context(), auth.Current(r.Context()), in, middleware.GetReqID(r.Context()))
	}))
	r.Route("/clusters/{clusterId}", func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := httpx.UUID(chi.URLParam(r, "clusterId")); err != nil {
					reply(w, r, 0, nil, err)
					return
				}
				next.ServeHTTP(w, r)
			})
		})
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.GetCluster(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"))
			reply(w, r, 200, out, err)
		})
		r.Patch("/", input[ClusterPatch](200, func(r *http.Request, in ClusterPatch) (any, error) {
			return s.UpdateCluster(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"), in, middleware.GetReqID(r.Context()))
		}))
		r.Post("/connection-tests", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.TestConnection(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"), middleware.GetReqID(r.Context()))
			reply(w, r, 200, out, err)
		})
		r.Get("/resource-grants", func(w http.ResponseWriter, r *http.Request) {
			out, err := s.ListGrants(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"))
			reply(w, r, 200, out, err)
		})
		r.Post("/resource-grants", input[GrantInput](201, func(r *http.Request, in GrantInput) (any, error) {
			return s.CreateGrant(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"), in, middleware.GetReqID(r.Context()))
		}))
		r.Delete("/resource-grants/{grantId}", func(w http.ResponseWriter, r *http.Request) {
			id := chi.URLParam(r, "grantId")
			if err := httpx.UUID(id); err != nil {
				reply(w, r, 0, nil, err)
				return
			}
			err := s.DeleteGrant(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"), id, middleware.GetReqID(r.Context()))
			reply(w, r, 204, nil, err)
		})
		for _, register := range clusterRoutes {
			register(r)
		}
	})
}
