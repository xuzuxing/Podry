package application

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/release"
	"github.com/xuzuxing/podry/internal/resource"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/util/yaml"
)

type applicationRead struct {
	Binding           sqlcdb.GetReleaseBindingRow
	Roots             []sqlcdb.DeploymentResource
	Latest            sqlcdb.Deployment
	Plan              release.Plan
	CredentialID      string
	CredentialVersion int32
}

func (s *Service) readApplicationResources(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, appID, bindingID string) (applicationRead, error) {
	var out applicationRead
	if err := auth.LockActor(ctx, q, a); err != nil {
		return out, err
	}
	if _, err := view(ctx, q, a, appID); err != nil {
		return out, err
	}
	var err error
	out.Binding, err = q.GetReleaseBinding(ctx, sqlcdb.GetReleaseBindingParams{ID: bindingID, AppID: appID})
	if err != nil {
		return out, err
	}
	out.Roots, err = q.BindingResourceRoots(ctx, sqlcdb.BindingResourceRootsParams{BindingID: bindingID, TargetID: out.Binding.TargetID})
	if err != nil {
		return out, err
	}
	cluster, err := q.ShareCluster(ctx, out.Binding.ClusterID)
	if err != nil {
		return out, err
	}
	cr, err := q.GetCredential(ctx, cluster.CredentialID)
	if err != nil {
		return out, err
	}
	out.CredentialID, out.CredentialVersion = cr.ID, cr.Version
	out.Latest, err = q.LatestBindingDeployment(ctx, bindingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	d, err := q.GetDeployment(ctx, out.Latest.ID)
	if err != nil {
		return out, err
	}
	snap, err := q.GetReleaseSnapshot(ctx, d.SnapshotID)
	if err != nil {
		return out, err
	}
	out.Plan, err = decodeReleasePlan(snap.Snapshot, snap.SnapshotSha256)
	return out, err
}

func sameRead(a, b applicationRead) bool {
	// Ignore observation timestamps; worker refreshes may repeat the same identity.
	for _, rows := range [][]sqlcdb.DeploymentResource{a.Roots, b.Roots} {
		for i := range rows {
			rows[i].ObservedAt = time.Time{}
		}
	}
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

func rootsForRead(rows []sqlcdb.DeploymentResource) []resource.Root {
	out := make([]resource.Root, 0, len(rows))
	for _, r := range rows {
		out = append(out, resource.Root{APIVersion: r.ApiVersion, Kind: r.Kind, Namespace: r.Namespace, Name: r.Name, UID: r.Uid})
	}
	return out
}

func (s *Service) ListResources(ctx context.Context, a auth.Actor, id, binding string) ([]resource.Object, error) {
	if err := httpx.UUID(binding); err != nil {
		return nil, err
	}
	before, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (applicationRead, error) {
		return s.readApplicationResources(ctx, q, a, id, binding)
	})
	if err != nil {
		return nil, err
	}
	reader := resource.New(s.pool, s.vault, string(s.cursorKey))
	out, readErr := reader.ReadOwned(ctx, a, before.Binding.ClusterID, rootsForRead(before.Roots), false, true)
	if readErr != nil && out.CredentialID == "" {
		return nil, readErr
	}
	// Revalidate actor, target, resource records, execution revision and credential
	// in a short transaction after all network reads. No database lock spans I/O.
	if err = reader.RecheckOwned(ctx, a, out); err != nil {
		return nil, err
	}
	_, err = database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		after, e := s.readApplicationResources(ctx, q, a, id, binding)
		if e != nil {
			return false, e
		}
		if !sameRead(before, after) {
			return false, httpx.Fail(409, "revision_conflict", "绑定、发布或资源身份已变化，请重新查询")
		}
		if before.Latest.ID != "" && out.CredentialID == before.CredentialID && out.CredentialVersion == before.CredentialVersion {
			health := "unknown"
			if readErr == nil {
				health = observedHealth(before, out)
			}
			e = q.SaveBindingObservation(ctx, sqlcdb.SaveBindingObservationParams{BindingID: binding, BindingVersion: before.Binding.Version, DeploymentID: before.Latest.ID, DeploymentRevision: before.Latest.Revision, CredentialID: out.CredentialID, CredentialVersion: out.CredentialVersion, Health: health, ObservedAt: out.ObservedAt})
		}
		return true, e
	})
	if err != nil {
		return nil, err
	}
	if readErr != nil {
		return nil, readErr
	}
	return out.Items, nil
}

func observedHealth(state applicationRead, out resource.Owned) string {
	p := state.Plan
	if state.Latest.TargetID != state.Binding.TargetID || state.Latest.Status == "unknown" {
		return "unknown"
	}
	var identity *sqlcdb.DeploymentResource
	for i := range state.Roots {
		r := &state.Roots[i]
		if r.DeploymentID == state.Latest.ID && r.Kind == p.WorkloadKind {
			identity = r
			break
		}
	}
	if identity == nil {
		return "unknown"
	}
	for _, r := range out.Missing {
		if r.UID == identity.Uid {
			return "degraded"
		}
	}
	for _, item := range out.Items {
		if item.Ref.UID != identity.Uid {
			continue
		}
		data, _ := json.Marshal(item.Data)
		var object unstructured.Unstructured
		if object.UnmarshalJSON(data) != nil {
			return "unknown"
		}
		health := release.ResourceHealth(&object, p)
		if health == "completed" {
			// Completion also needs a current, UID-owned successful application Pod.
			for _, pod := range out.Items {
				if pod.Kind != "Pod" || pod.Status != "Succeeded" {
					continue
				}
				for _, owner := range pod.OwnerRefs {
					if owner.UID == identity.Uid && owner.Name == identity.Name && owner.Resource == "jobs" {
						if release.SuccessfulApplicationPod(pod.Data, p, identity.Uid) {
							return "completed"
						}
					}
				}
			}
			return "unknown"
		}
		return health
	}
	return "unknown"
}

func manifestData(text string) ([]map[string]any, error) {
	d := yaml.NewYAMLOrJSONDecoder(strings.NewReader(text), 4096)
	out := []map[string]any{}
	for {
		var raw map[string]any
		err := d.Decode(&raw)
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return nil, err
		}
		if len(raw) > 0 {
			out = append(out, raw)
		}
	}
}

func (s *Service) GetDeploymentDiff(ctx context.Context, a auth.Actor, id string) (Diff, error) {
	type input struct {
		Plan  release.Plan
		Roots []sqlcdb.DeploymentResource
		AppID string
	}
	load := func(q *sqlcdb.Queries) (input, error) {
		var out input
		if err := auth.LockActor(ctx, q, a); err != nil {
			return out, err
		}
		d, err := q.GetDeployment(ctx, id)
		if err != nil {
			return out, err
		}
		out.AppID = d.AppID
		if _, err = view(ctx, q, a, d.AppID); err != nil {
			return out, err
		}
		snap, err := q.GetReleaseSnapshot(ctx, d.SnapshotID)
		if err != nil {
			return out, err
		}
		out.Plan, err = decodeReleasePlan(snap.Snapshot, snap.SnapshotSha256)
		if err != nil {
			return out, err
		}
		out.Roots, err = q.ListDeploymentResources(ctx, id)
		return out, err
	}
	in, err := database.Tx(ctx, s.pool, load)
	if err != nil {
		return Diff{}, err
	}
	expected, err := release.Objects(in.Plan)
	if err != nil {
		return Diff{}, httpx.Fail(503, "release_snapshot_invalid", "发布快照资源无效")
	}
	roots := []resource.Root{}
	for _, r := range expected {
		uid := ""
		for _, record := range in.Roots {
			if record.ApiVersion == r.APIVersion && record.Kind == r.Kind && record.Namespace == r.Namespace && record.Name == r.Name {
				uid = record.Uid
				break
			}
		}
		if uid == "" {
			return Diff{}, httpx.Fail(409, "resource_identity_unconfirmed", "发布尚未捕获完整资源身份，无法读取实时差异")
		}
		roots = append(roots, resource.Root{APIVersion: r.APIVersion, Kind: r.Kind, Namespace: r.Namespace, Name: r.Name, UID: uid})
	}
	reader := resource.New(s.pool, s.vault, string(s.cursorKey))
	out, err := reader.ReadOwned(ctx, a, in.Plan.Target.ClusterID, roots, true, false)
	if err != nil {
		return Diff{}, err
	}
	desired, err := manifestData(in.Plan.Chart.Manifest)
	if err != nil {
		return Diff{}, err
	}
	before, err := resource.DiffManifest(desired)
	if err != nil {
		return Diff{}, err
	}
	live := []map[string]any{}
	for _, o := range out.Items {
		live = append(live, o.Data)
	}
	after, err := resource.DiffManifest(live)
	if err != nil {
		return Diff{}, err
	}
	if err = reader.RecheckOwned(ctx, a, out); err != nil {
		return Diff{}, err
	}
	_, err = database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		now, e := load(q)
		if e != nil {
			return false, e
		}
		x, _ := json.Marshal(rootsForRead(in.Roots))
		y, _ := json.Marshal(rootsForRead(now.Roots))
		if string(x) != string(y) {
			return false, httpx.Fail(409, "revision_conflict", "发布资源身份已变化")
		}
		return true, nil
	})
	return Diff{Before: before, After: after}, err
}
