package resource

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/idempotency"
)

func (s *Service) operationAccess(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, id string) (sqlcdb.ResourceOperation, error) {
	row, err := q.GetResourceOperation(ctx, id)
	if err != nil {
		return row, err
	}
	if row.RequestedBy != a.ID {
		return row, httpx.NotFound()
	}
	x, err := s.lockedSnapshot(ctx, q, a, row.ClusterID)
	if err != nil {
		return row, err
	}
	var docs []writeDocument
	if json.Unmarshal(row.PayloadRedacted, &docs) != nil || len(docs) == 0 {
		return row, httpx.Fail(503, "resource_snapshot_invalid", "操作目标快照无效")
	}
	return row, authorizeDocuments(x, docs)
}
func (s *Service) GetOperation(ctx context.Context, a auth.Actor, id string) (Operation, error) {
	if err := httpx.UUID(id); err != nil {
		return Operation{}, err
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Operation, error) {
		row, err := s.operationAccess(ctx, q, a, id)
		if err != nil {
			return Operation{}, err
		}
		return operationDTO(row)
	})
}
func (s *Service) Apply(ctx context.Context, a auth.Actor, cluster, key string, in ApplyInput, requestID string) (idempotency.Result, error) {
	if err := httpx.UUID(cluster); err != nil {
		return idempotency.Result{}, err
	}
	if err := httpx.UUID(in.PreviewID); err != nil {
		return idempotency.Result{}, err
	}
	path := "/api/clusters/" + cluster + "/resources/apply"
	type prepared struct {
		plan   writePlan
		replay *idempotency.Result
	}
	prep, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (prepared, error) {
		x, e := s.lockedSnapshot(ctx, q, a, cluster)
		if e != nil {
			return prepared{}, e
		}
		// Lock the preview before looking up the committed idempotency result.
		// A competing admission can consume it while this transaction waits; the
		// lookup must then see that admission's result rather than reject a replay.
		row, e := q.LockResourcePreview(ctx, in.PreviewID)
		if e != nil {
			return prepared{}, e
		}
		if row.ClusterID != cluster || row.RequestedBy != a.ID {
			return prepared{}, httpx.NotFound()
		}
		old, found, e := idempotency.Lookup(ctx, q, a.ID, "applyResources", key, "POST", path, in)
		if e != nil {
			return prepared{}, e
		}
		if found {
			var result Operation
			if json.Unmarshal(old.Body, &result) != nil {
				return prepared{}, httpx.Fail(503, "resource_snapshot_invalid", "幂等结果无效")
			}
			row, e := s.operationAccess(ctx, q, a, result.ID)
			if e != nil {
				return prepared{}, e
			}
			if row.ClusterID != cluster {
				return prepared{}, httpx.NotFound()
			}
			return prepared{replay: &old}, nil
		}
		if row.ConsumedAt != nil {
			return prepared{}, httpx.Fail(409, "preview_consumed", "预览已被消费")
		}
		if !row.ExpiresAt.After(time.Now()) {
			return prepared{}, httpx.Fail(409, "preview_expired", "预览已过期")
		}
		var items []PreviewItem
		if json.Unmarshal(row.ItemsRedacted, &items) != nil || len(items) == 0 {
			return prepared{}, httpx.Fail(503, "resource_snapshot_invalid", "资源预览无效")
		}
		for _, item := range items {
			if !item.Valid {
				return prepared{}, httpx.Fail(422, "resource_preview_invalid", "预览包含无效对象，请修正文档后重新预览")
			}
		}
		plan, e := s.openPlan("resource-preview", row.ID, row.KeyID, row.EncryptedDocuments)
		if e != nil {
			return prepared{}, e
		}
		if e = requireStamp(x, a, plan); e != nil {
			return prepared{}, e
		}
		if !s.WritesEnabled {
			return prepared{}, httpx.Fail(503, "resource_execution_unavailable", "资源写入执行器尚未启用；预览已保留")
		}
		return prepared{plan: plan}, nil
	})
	if err != nil {
		return idempotency.Result{}, err
	}
	if prep.replay != nil {
		return *prep.replay, nil
	}
	// Confirm the physical identities before consuming the preview. The worker
	// checks again, and every PUT carries the frozen UID/resourceVersion.
	x, c, err := s.client(ctx, a, cluster, "", "resource.write")
	if err != nil {
		return idempotency.Result{}, err
	}
	defer c.Close()
	if err = requireStamp(x, a, prep.plan); err != nil {
		return idempotency.Result{}, err
	}
	for _, d := range prep.plan.Documents {
		if _, err = currentObject(ctx, c, d); err != nil {
			return idempotency.Result{}, err
		}
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
		now, e := s.lockedSnapshot(ctx, q, a, cluster)
		if e != nil {
			return idempotency.Result{}, e
		}
		if e = requireStamp(now, a, prep.plan); e != nil {
			return idempotency.Result{}, e
		}
		p, e := q.LockResourcePreview(ctx, in.PreviewID)
		if e != nil {
			return idempotency.Result{}, e
		}
		if p.ClusterID != cluster || p.RequestedBy != a.ID {
			return idempotency.Result{}, httpx.NotFound()
		}
		return idempotency.Execute(ctx, q, a.ID, "applyResources", key, "POST", path, in, func() (idempotency.Result, error) {
			n, e := q.ConsumeResourcePreview(ctx, p.ID)
			if e != nil {
				return idempotency.Result{}, e
			}
			if n != 1 {
				return idempotency.Result{}, httpx.Fail(409, "preview_unavailable", "预览已过期或被消费")
			}
			id := uuid.NewString()
			encrypted, keyID, e := s.sealPlan("resource-operation", id, prep.plan)
			if e != nil {
				return idempotency.Result{}, e
			}
			refs, items := []writeDocument{}, []OperationItem{}
			for i, d := range prep.plan.Documents {
				refs = append(refs, writeDocument{Type: d.Type, Ref: d.Ref, Action: d.Action})
				ref := d.Ref
				items = append(items, OperationItem{Index: i, Status: "pending", Ref: &ref})
			}
			redacted, _ := json.Marshal(refs)
			states, _ := json.Marshal(items)
			row, e := q.InsertResourceOperation(ctx, sqlcdb.InsertResourceOperationParams{ID: id, PreviewID: &p.ID, ClusterID: cluster, RequestedBy: a.ID, EncryptedPayload: encrypted, KeyID: keyID, PayloadRedacted: redacted, ResultRedacted: states, StopOnError: in.StopOnError})
			if e != nil {
				return idempotency.Result{}, e
			}
			target, _ := json.Marshal(map[string]any{"clusterId": cluster, "operationId": id, "previewId": p.ID, "documentCount": len(items)})
			if e = q.RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &a.ID, ClusterID: &cluster, Action: "resource.apply", RequestID: requestID, Target: target, Result: "accepted"}); e != nil {
				return idempotency.Result{}, e
			}
			out, _ := operationDTO(row)
			raw, e := json.Marshal(out)
			return idempotency.Result{Status: 202, Body: raw}, e
		})
	})
}
