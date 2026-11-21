-- name: ClaimHealthPoll :one
WITH candidate AS (
 SELECT p.binding_id FROM binding_health_polls p
 JOIN app_environment_bindings b ON b.id=p.binding_id
 JOIN applications a ON a.id=b.app_id
 WHERE a.archived_at IS NULL AND p.next_poll_at<=clock_timestamp()
 AND (p.lease_until IS NULL OR p.lease_until<=clock_timestamp())
 ORDER BY p.next_poll_at,p.binding_id FOR UPDATE OF p SKIP LOCKED LIMIT 1
)
UPDATE binding_health_polls p SET lease_token=sqlc.arg(token),
 lease_until=clock_timestamp()+interval '45 seconds',started_at=clock_timestamp()
FROM candidate c WHERE p.binding_id=c.binding_id RETURNING p.*;

-- name: GetHealthPollApp :one
SELECT app_id FROM app_environment_bindings WHERE id=$1;

-- name: LockHealthPoll :one
SELECT * FROM binding_health_polls WHERE binding_id=$1 AND lease_token=$2
AND lease_until>clock_timestamp() FOR UPDATE;

-- name: FinishHealthPoll :execrows
UPDATE binding_health_polls SET lease_token=NULL,lease_until=NULL,
 next_poll_at=clock_timestamp()+interval '30 seconds',last_error_code=sqlc.narg(error_code)
WHERE binding_id=sqlc.arg(binding_id) AND lease_token=sqlc.arg(token) AND lease_until>clock_timestamp();

-- name: InvalidatePolledHealth :exec
DELETE FROM binding_observations WHERE binding_id=$1 AND observed_at<=sqlc.arg(started_at);
