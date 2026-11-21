-- name: NextRelease :one
SELECT d.*,r.requested_by,s.snapshot,s.snapshot_sha256,s.app_id,s.binding_id FROM deployments d
JOIN deployment_targets t ON t.id=d.target_id
JOIN release_requests r ON r.id=d.request_id JOIN release_snapshots s ON s.id=r.snapshot_id
WHERE d.status IN ('queued','submitting','observing','unknown') AND d.next_poll_at<=clock_timestamp()
 AND (d.lease_until IS NULL OR d.lease_until<clock_timestamp())
 AND (t.active_deployment_id IS NULL OR t.active_deployment_id=d.id)
ORDER BY d.next_poll_at,d.created_at,d.id FOR UPDATE OF d,t SKIP LOCKED LIMIT 1;
-- name: OccupyReleaseTarget :one
UPDATE deployment_targets SET active_deployment_id=sqlc.arg(deployment_id),
 fencing_token=fencing_token+CASE WHEN active_deployment_id IS NULL THEN 1 ELSE 0 END
WHERE id=sqlc.arg(target_id) AND (active_deployment_id IS NULL OR active_deployment_id=sqlc.arg(deployment_id)) RETURNING fencing_token;
-- name: ClaimRelease :one
UPDATE deployments SET revision=revision+1,lease_owner=sqlc.arg(owner),lease_until=clock_timestamp()+interval '60 seconds',
 fencing_token=sqlc.arg(fencing_token),started_at=COALESCE(started_at,clock_timestamp())
WHERE id=sqlc.arg(id) RETURNING *;
-- name: MarkReleaseIntent :one
UPDATE deployments SET status='submitting'
WHERE id=$1 AND revision=$2 AND lease_owner=$3 AND lease_until>clock_timestamp() AND status='queued' RETURNING *;
-- name: TransitionRelease :one
UPDATE deployments SET status=sqlc.arg(status),helm_revision=COALESCE(helm_revision,sqlc.narg(helm_revision)),
 error_code=sqlc.narg(error_code),lease_owner=NULL,lease_until=NULL,next_poll_at=clock_timestamp()+interval '3 seconds',
 finished_at=CASE WHEN sqlc.arg(status)::text IN ('succeeded','failed') THEN clock_timestamp() ELSE NULL END
WHERE deployments.id=sqlc.arg(id) AND deployments.revision=sqlc.arg(revision) AND deployments.lease_owner=sqlc.arg(owner) AND deployments.lease_until>clock_timestamp()
 AND EXISTS(SELECT 1 FROM deployment_targets t WHERE t.id=deployments.target_id AND t.active_deployment_id=deployments.id AND t.fencing_token=deployments.fencing_token)
RETURNING *;
-- name: SetReleaseRequestState :exec
UPDATE release_requests SET status=$2 WHERE id=$1;
-- name: ReleaseTarget :execrows
UPDATE deployment_targets SET active_deployment_id=NULL WHERE id=$1 AND active_deployment_id=$2 AND fencing_token=$3;
-- name: SetCurrentDeployment :execrows
UPDATE app_environment_bindings SET current_deployment_id=$2 WHERE id=$1 AND target_id=$3;
-- name: SaveDeploymentResource :execrows
INSERT INTO deployment_resources(deployment_id,api_version,kind,namespace,name,uid,owner_references,observed_generation)
VALUES($1,$2,$3,$4,$5,$6,$7,$8)
ON CONFLICT(deployment_id,api_version,kind,namespace,name) DO UPDATE
SET owner_references=EXCLUDED.owner_references,observed_generation=EXCLUDED.observed_generation,observed_at=clock_timestamp()
WHERE deployment_resources.uid=EXCLUDED.uid;
-- name: ListDeploymentResources :many
SELECT * FROM deployment_resources WHERE deployment_id=$1 ORDER BY api_version,kind,namespace,name;
