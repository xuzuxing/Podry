-- name: NextBuildResourceCleanup :one
SELECT * FROM build_attempts
WHERE stage='finished' AND status IN ('succeeded','failed','canceled')
 AND job_uid IS NOT NULL AND resources_cleaned_at IS NULL
 AND finished_at<=clock_timestamp()-make_interval(secs => sqlc.arg(retention_seconds)::int)
 AND next_cleanup_at<=clock_timestamp()
 AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp())
ORDER BY next_cleanup_at,finished_at,id FOR UPDATE SKIP LOCKED LIMIT 1;

-- name: CompleteBuildResourceCleanup :exec
UPDATE build_attempts SET cleanup_attempts=cleanup_attempts+1,cleanup_error_code=sqlc.narg(error_code),
 next_cleanup_at=clock_timestamp()+interval '5 minutes',
 resources_cleaned_at=CASE WHEN sqlc.arg(completed)::boolean THEN clock_timestamp() ELSE NULL END
WHERE id=sqlc.arg(id);

-- name: ReleaseResourceCleanupCandidates :many
SELECT d.id,s.app_id,t.cluster_id,t.id AS target_id FROM deployments d
JOIN deployment_targets t ON t.id=d.target_id
JOIN release_requests r ON r.id=d.request_id JOIN release_snapshots s ON s.id=r.snapshot_id
WHERE d.status IN ('succeeded','failed') AND d.resources_cleaned_at IS NULL
 AND d.finished_at<=clock_timestamp()-make_interval(secs => sqlc.arg(retention_seconds)::int)
 AND d.next_cleanup_at<=clock_timestamp() AND (d.lease_until IS NULL OR d.lease_until<=clock_timestamp())
 AND t.active_deployment_id IS NULL
 AND EXISTS(SELECT 1 FROM app_environment_bindings b JOIN deployments current ON current.id=b.current_deployment_id
  WHERE b.id=s.binding_id AND b.target_id=t.id AND current.status='succeeded' AND current.id<>d.id
   AND current.created_at>d.created_at)
ORDER BY d.next_cleanup_at,d.finished_at,d.id LIMIT 20;

-- name: LockCleanupApplication :one
SELECT * FROM applications WHERE id=$1 FOR UPDATE SKIP LOCKED;
-- name: LockCleanupCluster :one
SELECT * FROM clusters WHERE id=$1 FOR UPDATE SKIP LOCKED;
-- name: LockCleanupTarget :one
SELECT * FROM deployment_targets WHERE id=$1 FOR UPDATE SKIP LOCKED;
-- name: LockCleanupDeployment :one
SELECT * FROM deployments WHERE id=$1 FOR UPDATE SKIP LOCKED;

-- name: ReleaseResourceCleanupAllowed :one
SELECT EXISTS(SELECT 1 FROM deployments d
 JOIN deployment_targets t ON t.id=d.target_id JOIN release_requests r ON r.id=d.request_id
 JOIN release_snapshots s ON s.id=r.snapshot_id
 JOIN app_environment_bindings b ON b.id=s.binding_id JOIN deployments current ON current.id=b.current_deployment_id
 WHERE d.id=sqlc.arg(id) AND d.status IN ('succeeded','failed') AND d.resources_cleaned_at IS NULL
 AND d.finished_at<=clock_timestamp()-make_interval(secs => sqlc.arg(retention_seconds)::int)
 AND d.next_cleanup_at<=clock_timestamp() AND (d.lease_until IS NULL OR d.lease_until<=clock_timestamp())
 AND t.active_deployment_id IS NULL AND b.target_id=t.id AND current.status='succeeded'
 AND current.id<>d.id AND current.created_at>d.created_at
 AND NOT EXISTS(SELECT 1 FROM deployments other WHERE other.target_id=t.id AND other.status IN ('queued','submitting','observing','unknown'))
 AND NOT EXISTS(SELECT 1 FROM resource_operations o WHERE o.cluster_id=t.cluster_id AND o.status IN ('queued','running','unknown'))
);

-- name: CompleteReleaseResourceCleanup :exec
UPDATE deployments SET cleanup_attempts=cleanup_attempts+1,cleanup_error_code=sqlc.narg(error_code),
 next_cleanup_at=clock_timestamp()+interval '5 minutes',
 resources_cleaned_at=CASE WHEN sqlc.arg(completed)::boolean THEN clock_timestamp() ELSE NULL END
WHERE id=sqlc.arg(id);
