package application

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/httpx"
)

func (s *Service) registerAppReleaseRoutes(r chi.Router) {
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
