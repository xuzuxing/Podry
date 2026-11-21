package resource

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"reflect"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/kubernetes"
)

func (s *Service) RunWritesDraining(drain, work context.Context) {
	if !s.WritesEnabled {
		return
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for drain.Err() == nil && work.Err() == nil {
		if _, err := s.processResourceOperation(drain, work); err != nil && work.Err() == nil {
			slog.Warn("resource reconciliation failed", "error_type", "bounded_step")
		}
		select {
		case <-drain.Done():
			return
		case <-work.Done():
			return
		case <-ticker.C:
		}
	}
}
func (s *Service) ProcessResourceOperation(ctx context.Context) (bool, error) {
	return s.processResourceOperation(ctx, ctx)
}
func operationState(items []OperationItem) string {
	pending, unknown, succeeded, failed := false, false, 0, 0
	for _, item := range items {
		switch item.Status {
		case "pending":
			pending = true
		case "running", "unknown":
			unknown = true
		case "succeeded":
			succeeded++
		default:
			failed++
		}
	}
	if unknown {
		return "unknown"
	}
	if pending {
		return "running"
	}
	if failed == 0 {
		return "succeeded"
	}
	if succeeded > 0 {
		return "partial"
	}
	return "failed"
}
func skipPending(items []OperationItem) {
	for i := range items {
		if items[i].Status == "pending" {
			items[i].Status = "skipped"
			items[i].Error = &OperationError{"resource_operation_stopped", "前序结果不确定或操作已停止"}
		}
	}
}
func (s *Service) advanceOperation(ctx context.Context, row sqlcdb.ResourceOperation, items []OperationItem, status string, release bool) (sqlcdb.ResourceOperation, error) {
	raw, err := json.Marshal(items)
	if err != nil {
		return row, err
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (sqlcdb.ResourceOperation, error) {
		next, e := q.AdvanceResourceOperation(ctx, sqlcdb.AdvanceResourceOperationParams{ID: row.ID, Revision: row.Revision, Owner: row.LeaseOwner, Status: status, ResultRedacted: raw, ReleaseLease: release})
		if e != nil {
			return row, e
		}
		if string(raw) != string(row.ResultRedacted) || status != row.Status {
			target, _ := json.Marshal(map[string]any{"operationId": row.ID, "clusterId": row.ClusterID, "status": status, "items": items})
			result := "accepted"
			switch status {
			case "unknown", "failed":
				result = status
			case "succeeded", "partial":
				result = "succeeded"
			}
			e = q.RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &row.RequestedBy, ClusterID: &row.ClusterID, Action: "resource." + row.Kind + ".result", Target: target, RequestID: "resource-worker", Result: result})
		}
		return next, e
	})
}
func (s *Service) markOperationIntent(ctx context.Context, row sqlcdb.ResourceOperation, a auth.Actor, plan writePlan, items []OperationItem) (sqlcdb.ResourceOperation, error) {
	raw, _ := json.Marshal(items)
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (sqlcdb.ResourceOperation, error) {
		x, e := s.lockedSnapshot(ctx, q, a, row.ClusterID)
		if e != nil {
			return row, e
		}
		if e = requireStamp(x, a, plan); e != nil {
			return row, e
		}
		if e = actionReleaseGuard(ctx, q, row.ClusterID, plan.Documents); e != nil {
			return row, e
		}
		next, e := q.AdvanceResourceOperation(ctx, sqlcdb.AdvanceResourceOperationParams{ID: row.ID, Revision: row.Revision, Owner: row.LeaseOwner, Status: "running", ResultRedacted: raw})
		if e != nil {
			return row, e
		}
		target, _ := json.Marshal(map[string]any{"operationId": row.ID, "status": "running", "items": items})
		e = q.RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &row.RequestedBy, ClusterID: &row.ClusterID, Action: "resource." + row.Kind + ".intent", Target: target, RequestID: "resource-worker", Result: "accepted"})
		return next, e
	})
}
func (s *Service) markedManifest(id string, index int, d writeDocument) (map[string]any, string, string) {
	manifest := copyMap(d.Manifest)
	meta := obj(manifest, "metadata")
	anns := obj(meta, "annotations")
	if anns == nil {
		anns = map[string]any{}
		meta["annotations"] = anns
	}
	identity := fmt.Sprintf("%s/%d", id, index)
	mac := hmac.New(sha256.New, s.signingKey)
	mac.Write([]byte("resource-operation/v1/" + identity + "/"))
	raw, _ := json.Marshal(d.Expected)
	mac.Write(raw)
	token := hex.EncodeToString(mac.Sum(nil))
	anns[operationAnnotation], anns[planAnnotation] = identity, token
	return manifest, identity, token
}
func (s *Service) observeWrite(ctx context.Context, c *kubernetes.Client, row sqlcdb.ResourceOperation, index int, d writeDocument) (Ref, error) {
	if d.Action == "delete" {
		return observeDelete(ctx, c, d)
	}
	_, identity, token := s.markedManifest(row.ID, index, d)
	current, err := readWriteObject(ctx, c, d.Type.path(d.Ref.Namespace, d.Ref.Name))
	if err != nil {
		return d.Ref, err
	}
	if err := responseIdentity(d.Type, d.Ref, current, true); err != nil {
		return d.Ref, err
	}
	anns := obj(obj(current, "metadata"), "annotations")
	if str(anns, operationAnnotation) != identity || !hmac.Equal([]byte(str(anns, planAnnotation)), []byte(token)) || !reflect.DeepEqual(normalized(current), d.Expected) {
		return d.Ref, httpx.Fail(409, "resource_outcome_unknown", "尚无足够证据确认该写入结果；不会重复提交")
	}
	return refFor(d.Type, current), nil
}
func (s *Service) processResourceOperation(drain, work context.Context) (bool, error) {
	if !s.WritesEnabled {
		return false, nil
	}
	row, err := database.Tx(drain, s.pool, func(q *sqlcdb.Queries) (sqlcdb.ResourceOperation, error) {
		r, e := q.NextResourceOperation(drain)
		if e != nil {
			return r, e
		}
		owner := uuid.NewString()
		return q.ClaimResourceOperation(drain, sqlcdb.ClaimResourceOperationParams{ID: r.ID, Revision: r.Revision, Owner: &owner})
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	ctx, cancel := context.WithTimeout(work, 40*time.Second)
	defer cancel()
	var items []OperationItem
	if json.Unmarshal(row.ResultRedacted, &items) != nil || len(items) == 0 {
		return true, errors.New("invalid resource operation state")
	}
	index := -1
	// A previously durable intent is always observed first. It is never sent again.
	for i, item := range items {
		if item.Status == "running" || item.Status == "unknown" {
			index = i
			break
		}
	}
	if index < 0 {
		for i, item := range items {
			if item.Status == "pending" {
				index = i
				break
			}
		}
	}
	if index < 0 {
		_, err = s.advanceOperation(ctx, row, items, operationState(items), true)
		return true, err
	}
	recovering := items[index].Status != "pending"
	fail := func(e error, global bool) (bool, error) {
		if recovering {
			items[index].Status = "unknown"
			items[index].Error = &OperationError{"resource_outcome_unknown", "写入结果尚未核对；不会重复提交"}
			skipPending(items)
		} else {
			items[index].Status = "failed"
			items[index].Error = safeError(e)
			if row.StopOnError || global {
				skipPending(items)
			}
		}
		_, save := s.advanceOperation(ctx, row, items, operationState(items), true)
		return true, save
	}
	plan, err := s.openPlan("resource-operation", row.ID, row.KeyID, row.EncryptedPayload)
	if err != nil {
		return fail(err, true)
	}
	if len(plan.Documents) != len(items) {
		return fail(httpx.Fail(503, "resource_snapshot_invalid", "资源操作快照无效"), true)
	}
	q := sqlcdb.New(s.pool)
	u, err := q.GetUser(ctx, row.RequestedBy)
	if err != nil {
		return fail(err, true)
	}
	a := auth.Actor{User: auth.Public(u), TokenVersion: u.TokenVersion}
	if u.DisabledAt != nil || a.TokenVersion != plan.Stamp.TokenVersion {
		return fail(httpx.Forbidden(), true)
	}
	x, c, err := s.client(ctx, a, row.ClusterID, "", actionPermission(row.Kind))
	if err != nil {
		return fail(err, true)
	}
	defer c.Close()
	if err = requireStamp(x, a, plan); err != nil {
		return fail(err, true)
	}
	d := plan.Documents[index]
	all, err := types(ctx, c, d.Type.Group, d.Type.Version)
	if err != nil {
		return fail(err, false)
	}
	matched := false
	for _, t := range all {
		if t.Resource == d.Type.Resource && t.Kind == d.Type.Kind && t.Namespaced == d.Type.Namespaced && slices.Contains(t.Verbs, "get") && slices.Contains(t.Verbs, actionVerb(d)) {
			matched = true
		}
	}
	if !matched {
		return fail(httpx.Fail(409, "resource_type_changed", "资源类型或可用动作已变化，请重新预览"), false)
	}
	if recovering {
		ref, e := s.observeWrite(ctx, c, row, index, d)
		if e != nil {
			return fail(e, false)
		}
		if e = s.recheck(ctx, a, x); e != nil {
			return fail(e, true)
		}
		items[index].Status, items[index].Ref, items[index].Error = "succeeded", &ref, nil
		_, err = s.advanceOperation(ctx, row, items, operationState(items), true)
		return true, err
	}
	if _, err = currentObject(ctx, c, d); err != nil {
		return fail(err, false)
	}
	if err = checkHPA(ctx, c, d); err != nil {
		return fail(err, false)
	}
	items[index].Status = "running"
	row, err = s.markOperationIntent(ctx, row, a, plan, items)
	if err != nil {
		return true, err
	}
	manifest := d.Manifest
	if d.Action != "delete" {
		manifest, _, _ = s.markedManifest(row.ID, index, d)
	}
	method, path := "POST", d.Type.path(d.Ref.Namespace, "")
	if d.Action == "update" || d.Action == "restart" || d.Action == "scale" {
		method, path = "PUT", d.Type.path(d.Ref.Namespace, d.Ref.Name)
	}
	if d.Action == "delete" {
		method, path, manifest = "DELETE", d.Type.path(d.Ref.Namespace, d.Ref.Name), d.Manifest
	}
	result, ambiguous, writeErr := c.ResourceWrite(ctx, method, path, manifest, false)
	if writeErr == nil && d.Action == "delete" {
		_, writeErr = observeDelete(ctx, c, d)
		ambiguous = writeErr != nil
	} else if writeErr == nil {
		writeErr = responseIdentity(d.Type, d.Ref, result, true)
		ambiguous = writeErr != nil
		if writeErr == nil && isAction(d) && !reflect.DeepEqual(normalized(result), d.Expected) {
			writeErr = httpx.Fail(409, "resource_outcome_unknown", "资源响应与冻结动作不一致")
			ambiguous = true
		}
	}
	if writeErr != nil {
		if ambiguous {
			items[index].Status = "unknown"
			items[index].Error = &OperationError{"resource_outcome_unknown", "远端响应不确定；等待读取核对，不会重复提交"}
			skipPending(items)
		} else {
			items[index].Status = "failed"
			items[index].Error = safeError(writeErr)
			if row.StopOnError {
				skipPending(items)
			}
		}
	} else {
		ref := d.Ref
		if d.Action != "delete" {
			ref = refFor(d.Type, result)
		}
		items[index].Status, items[index].Ref, items[index].Error = "succeeded", &ref, nil
	}
	_, err = s.advanceOperation(ctx, row, items, operationState(items), true)
	return true, err
}
