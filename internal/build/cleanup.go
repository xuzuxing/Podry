package build

import (
	"context"
	"errors"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/kubernetes"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// CleanupResources is called with the terminal attempt locked by the cleanup
// worker. Execution/retry history and artifacts are never removed.
func (s *Service) CleanupResources(ctx context.Context, q *sqlcdb.Queries, row sqlcdb.BuildAttempt) error {
	b, err := q.GetBuild(ctx, row.BuildID)
	if err != nil {
		return err
	}
	spec, err := DecodeExecution(b, row)
	if err != nil {
		return err
	}
	if row.JobUid == nil || row.FinishedAt == nil || row.Stage != "finished" ||
		(row.Status != "succeeded" && row.Status != "failed" && row.Status != "canceled") {
		return kubernetes.CleanupBlocked("cleanup_execution_active")
	}
	archive, err := q.GetLogArchive(ctx, row.ID)
	switch {
	case err == nil && archive.ExpiresAt.After(time.Now()):
		if archive.StorageKey != "logs/builds/"+row.ID+".ndjson" {
			return logUnavailable()
		}
		if _, err = s.ReadLogs(ctx, row); err != nil {
			return err
		}
	case err == nil:
		// Marking expired before removing the file would hide it from the
		// existing archive purger, whose cursor is log_availability<>'expired'.
		if archive.StorageKey != "logs/builds/"+row.ID+".ndjson" {
			return logUnavailable()
		}
		root, openErr := os.OpenRoot(s.Settings.DataDir)
		if openErr != nil && !errors.Is(openErr, os.ErrNotExist) {
			return openErr
		}
		if root != nil {
			removeErr := root.Remove(archive.StorageKey)
			root.Close()
			if removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
				return removeErr
			}
		}
		if err = q.SetBuildLogAvailability(ctx, sqlcdb.SetBuildLogAvailabilityParams{ID: row.ID, LogAvailability: "expired"}); err != nil {
			return err
		}
	case errors.Is(err, pgx.ErrNoRows) && time.Since(*row.FinishedAt) >= 7*24*time.Hour:
		// Persist expiry before removing the last possible runtime log source.
		if err = q.SetBuildLogAvailability(ctx, sqlcdb.SetBuildLogAvailabilityParams{ID: row.ID, LogAvailability: "expired"}); err != nil {
			return err
		}
	case errors.Is(err, pgx.ErrNoRows):
		return kubernetes.CleanupBlocked("cleanup_logs_unarchived")
	default:
		return err
	}
	c, err := s.client(ctx, spec)
	if err != nil {
		return err
	}
	defer c.Close()
	path := "/apis/batch/v1/namespaces/" + spec.Namespace + "/jobs/" + spec.JobName
	var job unstructured.Unstructured
	err = c.Get(ctx, path, nil, &job)
	if err != nil && !kubernetes.IsMissing(err) {
		return err
	}
	missing := kubernetes.IsMissing(err)
	if !missing && (string(job.GetUID()) != *row.JobUid || !owned(object(job.Object), spec) || !kubernetes.CleanupJobExited(&job, row.Status == "canceled" || row.Status == "failed")) {
		return kubernetes.CleanupBlocked("cleanup_job_identity_or_exit_conflict")
	}
	pods, err := c.CleanupJobPods(ctx, spec.Namespace, *row.JobUid)
	if err != nil {
		return err
	}
	if !missing {
		if err = c.DeleteCollected(ctx, path, &job); err != nil {
			return err
		}
		pods, err = c.CleanupJobPods(ctx, spec.Namespace, *row.JobUid)
		if err != nil {
			return err
		}
	}
	if len(pods) != 0 {
		return kubernetes.CleanupBlocked("cleanup_deletion_unconfirmed")
	}
	for _, item := range []struct{ plural, suffix string }{{"secrets", "-auth"}, {"configmaps", "-spec"}} {
		path = "/api/v1/namespaces/" + spec.Namespace + "/" + item.plural + "/" + spec.JobName + item.suffix
		var o unstructured.Unstructured
		err = c.Get(ctx, path, nil, &o)
		if kubernetes.IsMissing(err) {
			continue
		}
		if err != nil {
			return err
		}
		if !owned(object(o.Object), spec) || !hasOwner(object(o.Object), *row.JobUid) {
			return kubernetes.CleanupBlocked("cleanup_resource_identity_conflict")
		}
		if err = c.DeleteCollected(ctx, path, &o); err != nil {
			return err
		}
	}
	return nil
}
