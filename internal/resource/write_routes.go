package resource

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/httpx"
)

func (s *Service) registerWriteRoutes(r chi.Router) {
	r.Post("/resource-actions", func(w http.ResponseWriter, r *http.Request) {
		if _, err := query(r, ""); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var in ActionInput
		if err := httpx.Decode(w, r, &in); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := s.Act(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"), r.Header.Get("Idempotency-Key"), in, middleware.GetReqID(r.Context()))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.JSON(w, out.Status, out.Body)
	})
	r.Post("/resources/dry-run", func(w http.ResponseWriter, r *http.Request) {
		if _, err := query(r, ""); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var in DryRunInput
		if err := httpx.Decode(w, r, &in); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := s.DryRun(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"), in, middleware.GetReqID(r.Context()))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.JSON(w, 200, out)
	})
	r.Post("/resources/apply", func(w http.ResponseWriter, r *http.Request) {
		if _, err := query(r, ""); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var in ApplyInput
		if err := httpx.Decode(w, r, &in); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := s.Apply(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "clusterId"), r.Header.Get("Idempotency-Key"), in, middleware.GetReqID(r.Context()))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.JSON(w, out.Status, out.Body)
	})
}
func (s *Service) RegisterOperations(r chi.Router) {
	r.Post("/resource-operations/{operationId}/reconcile", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if _, err := query(r, ""); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var in ReconcileOperationInput
		if err := httpx.Decode(w, r, &in); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := s.ReconcileOperation(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "operationId"), r.Header.Get("Idempotency-Key"), in, middleware.GetReqID(r.Context()))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.JSON(w, out.Status, out.Body)
	})
	r.Get("/resource-operations/{operationId}", func(w http.ResponseWriter, r *http.Request) {
		if _, err := query(r, ""); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := s.GetOperation(r.Context(), auth.Current(r.Context()), chi.URLParam(r, "operationId"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.JSON(w, 200, out)
	})
}
