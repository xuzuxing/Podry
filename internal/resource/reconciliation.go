package resource

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/idempotency"
)

type ReconcileOperationInput struct {
	ExpectedRevision int64  `json:"expectedRevision"`
	Reason           string `json:"reason"`
}

type OperationReconciliation struct {
	OperationID string          `json:"operationId"`
	Revision    int64           `json:"revision"`
	Status      string          `json:"status"`
	Items       []OperationItem `json:"items"`
	CheckedAt   time.Time       `json:"checkedAt"`
}

type operationReconciliationRead struct {
	row       sqlcdb.ResourceOperation
	snapshot  snapshot
	items     []OperationItem
	checkedAt time.Time
}

func resourceReconciliationConflict() error {
	return httpx.Fail(409, "revision_conflict", "资源操作、集群、凭据或授权已变化，请重新查询")
}

func (s *Service) lockReconciliation(ctx context.Context, q *sqlcdb.Queries, row sqlcdb.ResourceOperation, a auth.Actor, revision int64) (operationReconciliationRead, error) {
	var out operationReconciliationRead
	var err error
	out.snapshot, err = s.lockedSnapshot(ctx, q, a, row.ClusterID)
	if err != nil {
		return out, err
	}
	locked, err := q.LockResourceReconciliation(ctx, row.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, httpx.Fail(409, "resource_reconciliation_busy", "资源操作正被其他执行器处理，请稍后重试")
	}
	if err != nil {
		return out, err
	}
	if locked.Revision != revision {
		return out, resourceReconciliationConflict()
	}
	if locked.Status != "running" && locked.Status != "unknown" {
		return out, httpx.Fail(409, "resource_operation_not_reconcilable", "只能核对已提交且未确定结果的资源操作")
	}
	if locked.WorkerActive {
		return out, httpx.Fail(409, "resource_reconciliation_busy", "资源操作存在有效执行租约，请稍后重试")
	}
	// GetResourceOperation returns the base row type used by the shared observer.
	// Re-read under the lock, rather than copying generated query fields by hand.
	out.row, err = q.GetResourceOperation(ctx, row.ID)
	if err != nil {
		return out, err
	}
	if json.Unmarshal(out.row.ResultRedacted, &out.items) != nil || len(out.items) == 0 {
		return out, httpx.Fail(503, "resource_snapshot_invalid", "资源操作结果快照无效")
	}
	if !slices.ContainsFunc(out.items, func(item OperationItem) bool { return item.Status == "running" || item.Status == "unknown" }) {
		return out, httpx.Fail(409, "resource_operation_not_reconcilable", "资源操作尚无待核对的提交意图")
	}
	out.checkedAt = locked.CheckedAt
	return out, nil
}

func reconciliationDocuments(row sqlcdb.ResourceOperation, items []OperationItem, plan writePlan) error {
	var redacted []writeDocument
	if json.Unmarshal(row.PayloadRedacted, &redacted) != nil || len(redacted) != len(plan.Documents) || len(items) != len(plan.Documents) {
		return httpx.Fail(503, "resource_snapshot_invalid", "资源操作目标快照无效")
	}
	for i, d := range plan.Documents {
		if !reflect.DeepEqual(redacted[i], writeDocument{Type: d.Type, Ref: d.Ref, Action: d.Action}) || items[i].Index != i || items[i].Ref == nil {
			return httpx.Fail(503, "resource_snapshot_invalid", "资源操作目标身份无效")
		}
		r := *items[i].Ref
		if r.Group != d.Ref.Group || r.Version != d.Ref.Version || r.Resource != d.Ref.Resource || r.Namespace != d.Ref.Namespace || r.Name != d.Ref.Name || d.Ref.UID != "" && r.UID != d.Ref.UID {
			return httpx.Fail(503, "resource_snapshot_invalid", "资源操作结果身份无效")
		}
	}
	return nil
}

// ReconcileOperation never executes a ResourceWrite or claims a worker lease.
// Network reads run between two short transactions. Current owner permissions
// and credentials may differ from admission, but cannot change during the read.
func (s *Service) ReconcileOperation(ctx context.Context, a auth.Actor, id, key string, in ReconcileOperationInput, requestID string) (idempotency.Result, error) {
	if err := httpx.UUID(id); err != nil {
		return idempotency.Result{}, err
	}
	if in.ExpectedRevision < 1 {
		return idempotency.Result{}, httpx.Invalid("expectedRevision 必须为正数")
	}
	reasonLength := utf8.RuneCountInString(strings.TrimSpace(in.Reason))
	if reasonLength < 1 || reasonLength > 1000 {
		return idempotency.Result{}, httpx.Invalid("reason 必须包含 1–1000 个字符")
	}
	path := "/api/resource-operations/" + id + "/reconcile"
	const operation = "reconcileResourceOperation"
	load := func(q *sqlcdb.Queries) (operationReconciliationRead, idempotency.Result, bool, error) {
		row, err := s.operationAccess(ctx, q, a, id)
		if err != nil {
			return operationReconciliationRead{}, idempotency.Result{}, false, err
		}
		result, found, err := idempotency.Lookup(ctx, q, a.ID, operation, key, "POST", path, in)
		if err != nil || found {
			return operationReconciliationRead{}, result, found, err
		}
		state, err := s.lockReconciliation(ctx, q, row, a, in.ExpectedRevision)
		return state, result, false, err
	}
	var before operationReconciliationRead
	var replay bool
	result, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
		var result idempotency.Result
		var err error
		before, result, replay, err = load(q)
		return result, err
	})
	if err != nil || replay {
		return result, err
	}
	if s.vault == nil {
		return result, httpx.Fail(503, "resource_snapshot_unavailable", "资源操作解密密钥暂不可用")
	}
	plan, err := s.openPlan("resource-operation", id, before.row.KeyID, before.row.EncryptedPayload)
	if err != nil {
		return result, httpx.Fail(503, "resource_snapshot_unavailable", "资源操作快照暂不可用")
	}
	if err = reconciliationDocuments(before.row, before.items, plan); err != nil {
		return result, err
	}
	// The encrypted plan fixes the physical server address. Credential rotation
	// before this explicit read is allowed; changing physical targets is not.
	if plan.Stamp.APIServer != before.snapshot.cluster.ApiServer {
		return result, resourceReconciliationConflict()
	}
	stepCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	x, c, err := s.client(stepCtx, a, before.row.ClusterID, "", "resource.view")
	if err != nil {
		return result, err
	}
	defer c.Close()
	if err = recheckSnapshot(before.snapshot, x); err != nil {
		return result, err
	}
	items := slices.Clone(before.items)
	// No explicit read may resume pending writes, even when stopOnError=false.
	skipPending(items)
	for i, item := range items {
		if item.Status != "running" && item.Status != "unknown" {
			continue
		}
		d := plan.Documents[i]
		if item.Ref.UID != "" {
			d.Ref.UID = item.Ref.UID
		}
		all, readErr := types(stepCtx, c, d.Type.Group, d.Type.Version)
		if readErr == nil && !slices.ContainsFunc(all, func(t ResourceType) bool {
			return t.Resource == d.Type.Resource && t.Kind == d.Type.Kind && t.Namespaced == d.Type.Namespaced && slices.Contains(t.Verbs, "get")
		}) {
			readErr = httpx.Fail(409, "resource_type_changed", "资源类型已变化")
		}
		if readErr == nil {
			ref, err := s.observeWrite(stepCtx, c, before.row, i, d)
			readErr = err
			if err == nil {
				items[i].Status, items[i].Ref, items[i].Error = "succeeded", &ref, nil
			}
		}
		if readErr != nil {
			items[i].Status = "unknown"
			items[i].Error = &OperationError{"resource_outcome_unknown", "尚无足够证据确认结果；不会重复提交或强制解除占用"}
		}
	}
	if ctx.Err() != nil {
		return result, ctx.Err()
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
		now, result, found, err := load(q)
		if err != nil || found {
			return result, err
		}
		if err = recheckSnapshot(before.snapshot, now.snapshot); err != nil {
			return result, err
		}
		_, err = idempotency.Execute(ctx, q, a.ID, operation, key, "POST", path, in, func() (idempotency.Result, error) {
			raw, err := json.Marshal(items)
			if err != nil {
				return result, err
			}
			row, err := q.ReconcileResourceOperation(ctx, sqlcdb.ReconcileResourceOperationParams{ID: id, ExpectedRevision: in.ExpectedRevision, Status: operationState(items), ResultRedacted: raw})
			if errors.Is(err, pgx.ErrNoRows) {
				return result, resourceReconciliationConflict()
			}
			if err != nil {
				return result, err
			}
			target, _ := json.Marshal(map[string]any{"operationId": id, "kind": row.Kind, "previousStatus": before.row.Status, "status": row.Status, "revision": row.Revision, "reasonLength": reasonLength, "items": items})
			auditResult := row.Status
			if auditResult == "partial" {
				auditResult = "succeeded"
			}
			if err = q.RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &a.ID, ClusterID: &row.ClusterID, Action: "resource.reconcile", Target: target, RequestID: requestID, Result: auditResult}); err != nil {
				return result, err
			}
			raw, err = json.Marshal(OperationReconciliation{OperationID: id, Revision: row.Revision, Status: row.Status, Items: items, CheckedAt: now.checkedAt})
			return idempotency.Result{Status: 200, Body: raw}, err
		})
		if err != nil {
			return result, err
		}
		// Return JSONB's stored representation on the first call as well.
		result, _, err = idempotency.Lookup(ctx, q, a.ID, operation, key, "POST", path, in)
		return result, err
	})
}
