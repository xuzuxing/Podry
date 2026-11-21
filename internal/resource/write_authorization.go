package resource

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
)

// Stabilize grant membership in the same team -> project -> cluster order as
// application and membership mutations. No network I/O occurs under these locks.
func (s *Service) lockedSnapshot(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, id string) (snapshot, error) {
	if err := auth.LockActor(ctx, q, a); err != nil {
		return snapshot{}, err
	}
	grants, err := q.ActorClusterGrants(ctx, sqlcdb.ActorClusterGrantsParams{ClusterID: id, UserID: &a.ID})
	if err != nil {
		return snapshot{}, err
	}
	teams, projects := []string{}, []string{}
	add := func(ids *[]string, id string) {
		if !slices.Contains(*ids, id) {
			*ids = append(*ids, id)
		}
	}
	for _, g := range grants {
		if g.TeamID != nil {
			add(&teams, *g.TeamID)
		}
		if g.ProjectID != nil {
			add(&projects, *g.ProjectID)
			p, e := q.GetProject(ctx, *g.ProjectID)
			if e != nil {
				return snapshot{}, e
			}
			add(&teams, p.TeamID)
		}
	}
	slices.Sort(teams)
	slices.Sort(projects)
	for _, id := range teams {
		if _, err = q.LockTeam(ctx, id); err != nil {
			return snapshot{}, err
		}
	}
	for _, id := range projects {
		if _, err = q.LockProject(ctx, id); err != nil {
			return snapshot{}, err
		}
	}
	if _, err = q.LockCluster(ctx, id); err != nil {
		return snapshot{}, err
	}
	x, err := s.snapshotQuery(ctx, q, a, id, false)
	if err != nil {
		return x, err
	}
	before, _ := json.Marshal(grants)
	after, _ := json.Marshal(x.grants)
	if string(before) != string(after) {
		return x, httpx.Fail(409, "revision_conflict", "资源授权已变化，请重新预览")
	}
	return x, nil
}
func authorizeDocuments(x snapshot, docs []writeDocument) error {
	for _, d := range docs {
		if !actionAllowed(x, d.Type, d.Ref, d.Action) {
			return httpx.NotFound()
		}
	}
	return nil
}
func requireStamp(x snapshot, a auth.Actor, p writePlan) error {
	if stamp(x, a.TokenVersion) != p.Stamp {
		return httpx.Fail(409, "revision_conflict", "集群、凭据、用户或资源授权已变化，请重新预览")
	}
	return authorizeDocuments(x, p.Documents)
}
