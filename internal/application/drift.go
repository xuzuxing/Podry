package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/release"
	"github.com/xuzuxing/podry/internal/resource"
)

type DriftObservation struct {
	ID            string    `json:"id"`
	DeploymentID  string    `json:"deploymentId"`
	Status        string    `json:"status"`
	Reason        string    `json:"reason"`
	ResourceCount int32     `json:"resourceCount"`
	ChangedCount  int32     `json:"changedCount"`
	MissingCount  int32     `json:"missingCount"`
	ObservedAt    time.Time `json:"observedAt"`
}

type DriftReport struct {
	BindingID            string             `json:"bindingId"`
	BaselineDeploymentID *string            `json:"baselineDeploymentId"`
	Status               string             `json:"status"`
	Reason               string             `json:"reason"`
	Current              *DriftObservation  `json:"current"`
	History              []DriftObservation `json:"history"`
	SecretValuesCompared bool               `json:"secretValuesCompared"`
}

type driftRead struct {
	State    applicationRead
	Baseline sqlcdb.GetDeploymentRow
	Plan     release.Plan
	Roots    []resource.Root
	Activity sqlcdb.ApplicationDriftActivityRow
	Complete bool
}

func (s *Service) readDrift(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, appID, bindingID string) (driftRead, error) {
	var out driftRead
	var err error
	out.State, err = s.readApplicationResources(ctx, q, a, appID, bindingID)
	if err != nil {
		return out, err
	}
	out.Activity, err = q.ApplicationDriftActivity(ctx, out.State.Binding.ClusterID)
	if err != nil || out.State.Binding.CurrentDeploymentID == nil {
		return out, err
	}
	out.Baseline, err = q.GetDeployment(ctx, *out.State.Binding.CurrentDeploymentID)
	if err != nil {
		return out, err
	}
	b := out.Baseline
	if b.AppID != appID || b.BindingID != bindingID || b.TargetID != out.State.Binding.TargetID || b.Status != "succeeded" {
		return out, httpx.Fail(409, "release_baseline_invalid", "当前成功发布基线无效")
	}
	snap, err := q.GetReleaseSnapshot(ctx, b.SnapshotID)
	if err != nil {
		return out, err
	}
	out.Plan, err = decodeReleasePlan(snap.Snapshot, snap.SnapshotSha256)
	if err != nil {
		return out, err
	}
	expected, err := release.Objects(out.Plan)
	if err != nil || len(expected) == 0 || len(expected) > 64 {
		return out, httpx.Fail(503, "release_snapshot_invalid", "发布快照资源无效")
	}
	rows, err := q.ListDeploymentResources(ctx, b.ID)
	if err != nil {
		return out, err
	}
	out.Complete = true
	for _, r := range expected {
		// Placeholder is used only for local authorization, never for a cluster GET.
		root := resource.Root{APIVersion: r.APIVersion, Kind: r.Kind, Namespace: r.Namespace, Name: r.Name, UID: "unconfirmed"}
		found := false
		for _, row := range rows {
			if row.ApiVersion == r.APIVersion && row.Kind == r.Kind && row.Namespace == r.Namespace && row.Name == r.Name && row.Uid != "" {
				root.UID, found = row.Uid, true
				break
			}
		}
		out.Complete = out.Complete && found
		out.Roots = append(out.Roots, root)
	}
	return out, nil
}

func (in driftRead) key() string {
	// Include every identity that can invalidate a read, but no manifest values.
	b, l, d := in.State.Binding, in.State.Latest, in.Baseline
	data, _ := json.Marshal([]any{b.ID, b.Version, b.TargetID, b.ClusterID, b.Namespace, b.ReleaseName, b.CurrentDeploymentID,
		l.ID, l.Revision, l.Status, d.ID, d.Revision, d.Status,
		in.State.CredentialID, in.State.CredentialVersion, in.Roots, in.Activity})
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (in driftRead) unsettled() bool {
	return in.State.Latest.ID != in.Baseline.ID || in.State.Latest.Status != "succeeded"
}

// compareDrift reuses the live Diff projection, including Secret key-only data.
// Counts describe differences, not their cause. No values or hashes of values
// cross the persistence boundary; callers can request the authorized live Diff.
func compareDrift(in driftRead, live resource.Owned) (changed, missing int32, err error) {
	desired, err := manifestData(in.Plan.Chart.Manifest)
	if err != nil {
		return 0, 0, err
	}
	byUID := map[string]map[string]any{}
	for _, item := range live.Items {
		byUID[item.Ref.UID] = item.Data
	}
	for i, root := range in.Roots {
		actual, ok := byUID[root.UID]
		if !ok {
			missing++
			continue
		}
		// release.Objects and manifestData both follow immutable manifest order.
		before, e := resource.DiffManifest([]map[string]any{desired[i]})
		if e != nil {
			return 0, 0, e
		}
		after, e := resource.DiffManifest([]map[string]any{actual})
		if e != nil {
			return 0, 0, e
		}
		if before != after {
			changed++
		}
	}
	return changed, missing, nil
}

func driftDTO(row sqlcdb.ApplicationDriftObservation) DriftObservation {
	return DriftObservation{ID: row.ID, DeploymentID: row.DeploymentID, Status: row.Status, Reason: row.Reason,
		ResourceCount: row.ResourceCount, ChangedCount: row.ChangedCount, MissingCount: row.MissingCount, ObservedAt: row.ObservedAt}
}

// GetDrift is a local, permission-checked cache/history read by default. Explicit
// refresh performs GETs outside database locks and records even failed reads as
// unknown when authorization and version identities still match. History is
// scoped to the current successful deployment; historical Diff stays separate.
func (s *Service) GetDrift(ctx context.Context, a auth.Actor, appID, bindingID string, refresh bool) (DriftReport, error) {
	if err := httpx.UUID(bindingID); err != nil {
		return DriftReport{}, err
	}
	started := time.Now().UTC()
	load := func(q *sqlcdb.Queries) (driftRead, error) { return s.readDrift(ctx, q, a, appID, bindingID) }
	in, err := database.Tx(ctx, s.pool, load)
	if err != nil {
		return DriftReport{}, err
	}
	reader := resource.New(s.pool, s.vault, string(s.cursorKey))
	stamp, err := reader.AuthorizeOwned(ctx, a, in.State.Binding.ClusterID, in.Roots)
	if err != nil {
		return DriftReport{}, err
	}
	observation := sqlcdb.SaveApplicationDriftParams{ID: uuid.NewString(), BindingID: bindingID,
		DeploymentID: in.Baseline.ID, SnapshotKey: in.key(), Status: "unknown", Reason: "identity_unconfirmed",
		ResourceCount: int32(len(in.Roots)), ObservedAt: started}
	if refresh && in.Baseline.ID != "" {
		switch {
		case in.unsettled():
			observation.Reason = "release_unsettled"
		case in.Activity.Busy:
			observation.Reason = "resource_operation_pending"
		case !in.Complete:
			// Keep unknown until all snapshot roots have a recorded UID.
		default:
			live, readErr := reader.ReadOwned(ctx, a, in.State.Binding.ClusterID, in.Roots, true, false)
			observation.Reason = "read_failed"
			if readErr == nil {
				observation.ChangedCount, observation.MissingCount, err = compareDrift(in, live)
				if err != nil {
					return DriftReport{}, err
				}
				observation.Status, observation.Reason = "aligned", "compared"
				if observation.ChangedCount+observation.MissingCount > 0 {
					observation.Status = "drifted"
				}
			} else {
				var api *httpx.Error
				if errors.As(readErr, &api) && api.Code == "resource_identity_changed" {
					observation.Reason = "identity_changed"
				}
			}
		}
	}
	if err = reader.RecheckOwned(ctx, a, stamp); err != nil {
		return DriftReport{}, err
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (DriftReport, error) {
		now, e := load(q)
		if e != nil {
			return DriftReport{}, e
		}
		if e = reader.RecheckOwnedQuery(ctx, q, a, stamp); e != nil {
			return DriftReport{}, e
		}
		if in.key() != now.key() {
			return DriftReport{}, httpx.Fail(409, "revision_conflict", "绑定、发布、凭据或资源身份已变化，请重新查询")
		}
		out := DriftReport{BindingID: bindingID, BaselineDeploymentID: in.State.Binding.CurrentDeploymentID,
			Status: "unknown", Reason: "no_baseline", History: []DriftObservation{}}
		if in.Baseline.ID == "" {
			return out, nil
		}
		if refresh {
			if e = q.SaveApplicationDrift(ctx, observation); e != nil {
				return out, e
			}
			if e = q.TrimApplicationDrift(ctx, bindingID); e != nil {
				return out, e
			}
		}
		rows, e := q.ListApplicationDrift(ctx, sqlcdb.ListApplicationDriftParams{BindingID: bindingID, DeploymentID: in.Baseline.ID})
		if e != nil {
			return out, e
		}
		for _, row := range rows {
			out.History = append(out.History, driftDTO(row))
		}
		out.Reason = "no_observation"
		if len(rows) > 0 {
			latest := rows[0]
			out.Reason = "stale"
			if latest.SnapshotKey == in.key() && latest.ObservedAt.After(time.Now().UTC().Add(-60*time.Second)) {
				current := driftDTO(latest)
				out.Current, out.Status, out.Reason = &current, current.Status, current.Reason
			}
		}
		if in.Activity.Busy {
			out.Status, out.Reason, out.Current = "unknown", "resource_operation_pending", nil
		}
		if in.unsettled() {
			out.Status, out.Reason, out.Current = "unknown", "release_unsettled", nil
		}
		return out, nil
	})
}
