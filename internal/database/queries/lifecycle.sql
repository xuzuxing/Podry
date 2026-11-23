-- name: DisableBindingDelivery :exec
UPDATE app_environment_bindings SET auto_deploy=false,version=version+1 WHERE id=$1;
-- name: DisableBindingPipelines :exec
UPDATE pipelines SET enabled=false,version=version+1 WHERE binding_id=$1;
-- name: DetachBinding :execrows
UPDATE app_environment_bindings SET detached_at=clock_timestamp(),auto_deploy=false,version=version+1
WHERE id=$1 AND current_deployment_id IS NULL AND detached_at IS NULL;
-- name: CompleteBindingOffline :execrows
UPDATE app_environment_bindings SET current_deployment_id=NULL,auto_deploy=false,version=version+1
WHERE id=$1 AND target_id=$2 AND detached_at IS NULL;
-- name: BindingHasHistory :one
SELECT EXISTS(SELECT 1 FROM release_snapshots WHERE binding_id=$1);
-- name: BindingSafelyOffline :one
SELECT EXISTS(SELECT 1 FROM deployments d JOIN release_requests r ON r.id=d.request_id
JOIN release_snapshots s ON s.id=r.snapshot_id
WHERE s.binding_id=$1 AND r.kind='offline' AND d.status='succeeded'
AND NOT EXISTS(SELECT 1 FROM deployments newer JOIN release_requests nr ON nr.id=newer.request_id
JOIN release_snapshots ns ON ns.id=nr.snapshot_id WHERE ns.binding_id=$1 AND newer.id<>d.id AND newer.created_at>=d.created_at));
