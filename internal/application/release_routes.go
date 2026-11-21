package application

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/httpx"
)

func (s *Service) registerAppReleaseRoutes(r chi.Router) {
	r.Get("/drift", func(w http.ResponseWriter, r *http.Request) {
		refresh := false
		if values, exists := r.URL.Query()["refresh"]; exists {
			var err error
			if len(values) != 1 {
				reply(w, r, 0, nil, httpx.Invalid("refresh must be a boolean"))
				return
			}
			refresh, err = strconv.ParseBool(values[0])
			if err != nil {
				reply(w, r, 0, nil, httpx.Invalid("refresh must be a boolean"))
				return
			}
		}
		out, err := s.GetDrift(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), r.URL.Query().Get("bindingId"), refresh)
		w.Header().Set("Cache-Control", "no-store")
		reply(w, r, 200, out, err)
	})
	r.Get("/resources", func(w http.ResponseWriter, r *http.Request) {
		out, e := s.ListResources(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), r.URL.Query().Get("bindingId"))
		reply(w, r, 200, out, e)
	})
	r.Post("/deployment-previews", input[DeploymentPreviewInput](201, func(r *http.Request, in DeploymentPreviewInput) (any, error) {
		return s.CreateDeploymentPreview(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), in, middleware.GetReqID(r.Context()))
	}))
	r.Get("/deployments", func(w http.ResponseWriter, r *http.Request) {
		page, e := httpx.Page(r)
		if e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		binding, e := httpx.OptionalUUID(r.URL.Query().Get("bindingId"))
		if e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		out, e := s.ListDeployments(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), binding, page)
		reply(w, r, 200, out, e)
	})
	r.Post("/deployments", func(w http.ResponseWriter, r *http.Request) {
		var in PreviewConfirm
		if e := httpx.Decode(w, r, &in); e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		out, e := s.ConfirmRelease(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "appId"), in, r.Header.Get("Idempotency-Key"), middleware.GetReqID(r.Context()))
		if e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		httpx.JSON(w, out.Status, out.Body)
	})
}
func (s *Service) registerReleaseRoutes(r chi.Router) {
	r.Post("/deployments/{deploymentId}/reconcile", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		var in ReconcileDeploymentInput
		if err := httpx.Decode(w, r, &in); err != nil {
			reply(w, r, 0, nil, err)
			return
		}
		out, err := s.ReconcileDeployment(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "deploymentId"), in, r.Header.Get("Idempotency-Key"), middleware.GetReqID(r.Context()))
		if err != nil {
			reply(w, r, 0, nil, err)
			return
		}
		httpx.JSON(w, out.Status, out.Body)
	})
	r.Post("/deployments/{deploymentId}/promote", func(w http.ResponseWriter, r *http.Request) {
		var in PromoteInput
		if e := httpx.Decode(w, r, &in); e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		out, e := s.PromoteDeployment(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "deploymentId"), in, r.Header.Get("Idempotency-Key"), middleware.GetReqID(r.Context()))
		if e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		httpx.JSON(w, out.Status, out.Body)
	})
	r.Post("/deployments/{deploymentId}/rollback", func(w http.ResponseWriter, r *http.Request) {
		var in RollbackInput
		if e := httpx.Decode(w, r, &in); e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		out, e := s.RollbackDeployment(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "deploymentId"), in, r.Header.Get("Idempotency-Key"), middleware.GetReqID(r.Context()))
		if e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		httpx.JSON(w, out.Status, out.Body)
	})
	r.Get("/deployments/{deploymentId}/diff", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "deploymentId")
		if e := httpx.UUID(id); e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		out, e := s.GetDeploymentDiff(r.Context(), auth.Current(r.Context()), id)
		reply(w, r, 200, out, e)
	})
	r.Get("/release-requests/{requestId}", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "requestId")
		if e := httpx.UUID(id); e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		out, e := s.GetReleaseRequest(r.Context(), auth.Current(r.Context()), id)
		reply(w, r, 200, out, e)
	})
	r.Get("/deployments/{deploymentId}", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "deploymentId")
		if e := httpx.UUID(id); e != nil {
			reply(w, r, 0, nil, e)
			return
		}
		out, e := s.GetDeployment(r.Context(), auth.Current(r.Context()), id)
		reply(w, r, 200, out, e)
	})
}
