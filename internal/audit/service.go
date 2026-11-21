package audit

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/project"
)

type Event struct {
	ID        string          `json:"id"`
	ActorID   *string         `json:"actorId"`
	Action    string          `json:"action"`
	Target    json.RawMessage `json:"target"`
	Result    string          `json:"result"`
	CreatedAt time.Time       `json:"createdAt"`
}
type Service struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Service { return &Service{pool} }
func (s *Service) List(ctx context.Context, a auth.Actor, p httpx.Pagination, projectID, clusterID *string, action, keyword string) (httpx.PageResult[Event], error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (httpx.PageResult[Event], error) {
		out := httpx.PageResult[Event]{Items: []Event{}, Page: p.Page, PageSize: p.PageSize}
		if projectID != nil {
			if _, err := project.ProjectRole(ctx, q, a, *projectID); err != nil {
				return out, err
			}
		}
		// Cluster audit access is introduced with B2 resource grants; B1 cannot grant it.
		if clusterID != nil && !a.IsSuperAdmin {
			return out, httpx.Forbidden()
		}
		rows, err := q.ListAuditEvents(ctx, sqlcdb.ListAuditEventsParams{ProjectID: projectID, ClusterID: clusterID, Keyword: keyword, Action: action, IsSuperAdmin: a.IsSuperAdmin, UserID: a.ID, PageLimit: int32(p.PageSize), PageOffset: p.Offset()})
		if err != nil {
			return out, err
		}
		out.Total, err = q.CountAuditEvents(ctx, sqlcdb.CountAuditEventsParams{ProjectID: projectID, ClusterID: clusterID, Keyword: keyword, Action: action, IsSuperAdmin: a.IsSuperAdmin, UserID: a.ID})
		if err != nil {
			return out, err
		}
		for _, r := range rows {
			out.Items = append(out.Items, Event{r.ID, r.ActorID, r.Action, r.Target, r.Result, r.CreatedAt})
		}
		return out, nil
	})
}
func (s *Service) Register(r chi.Router) {
	r.Get("/audit-events", func(w http.ResponseWriter, r *http.Request) {
		p, err := httpx.Page(r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		projectID, err := httpx.OptionalUUID(r.URL.Query().Get("projectId"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		clusterID, err := httpx.OptionalUUID(r.URL.Query().Get("clusterId"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		result, err := s.List(r.Context(), auth.Current(r.Context()), p, projectID, clusterID, r.URL.Query().Get("action"), r.URL.Query().Get("keyword"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.JSON(w, 200, result)
	})
}

// Failed business transactions roll back their audits. A denial is a separate event,
// visible to platform administrators, without recording input or foreign object details.
func (s *Service) Denials(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		if ww.Status() != 403 && ww.Status() != 404 {
			return
		}
		a := auth.Current(r.Context())
		if a.ID == "" {
			return
		}
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 2*time.Second)
		defer cancel()
		target, _ := json.Marshal(map[string]string{"method": r.Method, "route": chi.RouteContext(r.Context()).RoutePattern()})
		err := sqlcdb.New(s.pool).RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &a.ID, Action: "authorization.denied", Target: target, RequestID: middleware.GetReqID(r.Context()), Result: "denied"})
		if err != nil {
			slog.Error("could not persist denial audit", "request_id", middleware.GetReqID(r.Context()))
		}
	})
}
