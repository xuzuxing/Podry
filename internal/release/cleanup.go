package release

import (
	"context"

	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/kubernetes"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// Only obsolete per-deployment Jobs and Secrets are eligible. Deployments,
// Services, Ingresses and Helm records remain under Helm's own lifecycle.
// The caller holds application, cluster, target and deployment locks, and has
// rechecked the newer successful binding and all in-flight release/write work.
func (s *Service) CleanupResources(ctx context.Context, q *sqlcdb.Queries, id string) error {
	d, err := q.GetDeployment(ctx, id)
	if err != nil {
		return err
	}
	snapshot, err := q.GetReleaseSnapshot(ctx, d.SnapshotID)
	if err != nil {
		return err
	}
	p, err := Decode(snapshot.Snapshot, snapshot.SnapshotSha256)
	if err != nil {
		return err
	}
	if p.DeploymentID != d.ID || p.TargetID != d.TargetID || p.RequestID != d.RequestID || p.AppID != d.AppID || p.BindingID != d.BindingID {
		return kubernetes.CleanupBlocked("cleanup_snapshot_invalid")
	}
	refs, err := Objects(p)
	if err != nil {
		return err
	}
	known, err := q.ListDeploymentResources(ctx, id)
	if err != nil {
		return err
	}
	payload, err := s.secret(ctx, p.ClusterCredential)
	if err != nil {
		return err
	}
	c, err := kubernetes.New(payload)
	if err != nil {
		return err
	}
	defer c.Close()
	// Jobs go first so their Pods no longer reference the version Secret.
	for _, kind := range []string{"Job", "Secret"} {
		for _, ref := range refs {
			if ref.Kind != kind {
				continue
			}
			path, err := resourcePath(ref)
			if err != nil {
				return err
			}
			var o unstructured.Unstructured
			uid := ""
			for _, saved := range known {
				if saved.ApiVersion == ref.APIVersion && saved.Kind == ref.Kind && saved.Namespace == ref.Namespace && saved.Name == ref.Name {
					uid = saved.Uid
				}
			}
			err = c.Get(ctx, path, nil, &o)
			if kubernetes.IsMissing(err) {
				if kind == "Job" {
					if uid == "" {
						return kubernetes.CleanupBlocked("cleanup_resource_identity_unconfirmed")
					}
					pods, err := c.CleanupJobPods(ctx, ref.Namespace, uid)
					if err != nil {
						return err
					}
					if len(pods) != 0 {
						return kubernetes.CleanupBlocked("cleanup_deletion_unconfirmed")
					}
				}
				continue
			}
			if err != nil {
				return err
			}
			if uid == "" || uid != string(o.GetUID()) || !owned(&o, p) || o.GetAPIVersion() != ref.APIVersion || o.GetKind() != kind || o.GetNamespace() != ref.Namespace || o.GetName() != ref.Name {
				return kubernetes.CleanupBlocked("cleanup_resource_identity_conflict")
			}
			if kind == "Job" {
				if !imageMatches(&o, p) || !kubernetes.CleanupJobExited(&o, false) {
					return kubernetes.CleanupBlocked("cleanup_job_exit_unconfirmed")
				}
				if _, err = c.CleanupJobPods(ctx, ref.Namespace, string(o.GetUID())); err != nil {
					return err
				}
			} else if err = c.SecretUnused(ctx, ref.Namespace, ref.Name); err != nil {
				return err
			}
			if err = c.DeleteCollected(ctx, path, &o); err != nil {
				return err
			}
			if kind == "Job" {
				pods, err := c.CleanupJobPods(ctx, ref.Namespace, uid)
				if err != nil {
					return err
				}
				if len(pods) != 0 {
					return kubernetes.CleanupBlocked("cleanup_deletion_unconfirmed")
				}
			}
		}
	}
	return nil
}
