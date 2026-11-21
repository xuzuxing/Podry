package resource

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
)

func (s *Service) DryRun(ctx context.Context, a auth.Actor, cluster string, in DryRunInput, requestID string) (Preview, error) {
	if err := httpx.UUID(cluster); err != nil {
		return Preview{}, err
	}
	if len(in.Documents) < 1 || len(in.Documents) > 50 {
		return Preview{}, httpx.Invalid("documents 数量必须为 1–50，每个元素只含一个 YAML/JSON 对象")
	}
	total := 0
	for _, d := range in.Documents {
		total += len(d.Manifest)
	}
	if total > 768<<10 {
		return Preview{}, httpx.Invalid("文档总大小超过预览预算")
	}
	access, err := s.snapshot(ctx, a, cluster, false)
	if err != nil {
		return Preview{}, err
	}
	if !access.any("", "resource.write") || !access.any("", "resource.view") {
		return Preview{}, httpx.NotFound()
	}
	x, c, err := s.client(ctx, a, cluster, "", "resource.write")
	if err != nil {
		return Preview{}, err
	}
	defer c.Close()
	if !x.any("", "resource.view") {
		return Preview{}, httpx.NotFound()
	}
	out := Preview{PreviewID: uuid.NewString(), ExpiresAt: time.Now().UTC().Add(10 * time.Minute), Items: []PreviewItem{}}
	plan := writePlan{Stamp: stamp(x, a.TokenVersion), Documents: []writeDocument{}}
	seen := map[string]bool{}
	for index, input := range in.Documents {
		d, diff, e := s.prepareDocument(ctx, c, x, input)
		item := PreviewItem{Index: index, Action: d.Action, Diff: diff, Valid: e == nil}
		if d.Ref.Name != "" {
			ref := d.Ref
			item.Ref = &ref
		}
		if item.Action == "" {
			item.Action = "create"
		}
		key := strings.Join([]string{d.Type.Group, d.Type.Resource, d.Ref.Namespace, d.Ref.Name}, "/")
		if e == nil && seen[key] {
			e = httpx.Invalid("同一预览不能重复提交同一个物理资源（包括不同 API 版本）")
			item.Valid = false
		}
		if e != nil {
			item.Error = safeError(e)
		} else {
			seen[key] = true
		}
		out.Items = append(out.Items, item)
		plan.Documents = append(plan.Documents, d)
	}
	if err = ctx.Err(); err != nil {
		return Preview{}, err
	}
	encrypted, key, err := s.sealPlan("resource-preview", out.PreviewID, plan)
	if err != nil {
		return Preview{}, err
	}
	items, _ := json.Marshal(out.Items)
	_, err = database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		now, e := s.lockedSnapshot(ctx, q, a, cluster)
		if e != nil {
			return false, e
		}
		if stamp(now, a.TokenVersion) != plan.Stamp {
			return false, httpx.Fail(409, "revision_conflict", "预览期间集群、凭据或授权变化")
		}
		if _, e = q.InsertResourcePreview(ctx, sqlcdb.InsertResourcePreviewParams{ID: out.PreviewID, ClusterID: cluster, RequestedBy: a.ID, EncryptedDocuments: encrypted, KeyID: key, ItemsRedacted: items, ExpiresAt: out.ExpiresAt}); e != nil {
			return false, e
		}
		target, _ := json.Marshal(map[string]any{"clusterId": cluster, "previewId": out.PreviewID, "documentCount": len(in.Documents)})
		return true, q.RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &a.ID, ClusterID: &cluster, Action: "resource.preview", RequestID: requestID, Target: target, Result: "succeeded"})
	})
	return out, err
}
