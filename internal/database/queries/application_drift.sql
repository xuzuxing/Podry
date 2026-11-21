-- name: SaveApplicationDrift :exec
INSERT INTO application_drift_observations(id,binding_id,deployment_id,snapshot_key,status,reason,resource_count,changed_count,missing_count,observed_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
-- name: ListApplicationDrift :many
SELECT * FROM application_drift_observations WHERE binding_id=$1 AND deployment_id=$2
ORDER BY observed_at DESC,id DESC LIMIT 20;
-- name: TrimApplicationDrift :exec
DELETE FROM application_drift_observations AS target WHERE target.binding_id=$1 AND target.id IN (
 SELECT old.id FROM application_drift_observations old WHERE old.binding_id=$1 ORDER BY old.observed_at DESC,old.id DESC OFFSET 100
);
-- name: ApplicationDriftActivity :one
SELECT count(*)::bigint AS operations, coalesce(sum(revision),0)::bigint AS revisions,
coalesce(bool_or(status IN ('queued','running','unknown')),false)::boolean AS busy
FROM resource_operations WHERE cluster_id=$1;
