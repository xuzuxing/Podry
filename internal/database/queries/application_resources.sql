-- name: BindingResourceRoots :many
SELECT DISTINCT ON (dr.api_version,dr.kind,dr.namespace,dr.name) dr.*
FROM deployment_resources dr JOIN deployments d ON d.id=dr.deployment_id
JOIN release_requests r ON r.id=d.request_id JOIN release_snapshots s ON s.id=r.snapshot_id
WHERE s.binding_id=$1 AND d.target_id=$2
ORDER BY dr.api_version,dr.kind,dr.namespace,dr.name,d.created_at DESC,d.id DESC LIMIT 65;
-- name: LatestBindingDeployment :one
SELECT d.* FROM deployments d JOIN release_requests r ON r.id=d.request_id JOIN release_snapshots s ON s.id=r.snapshot_id
WHERE s.binding_id=$1 ORDER BY d.created_at DESC,d.id DESC LIMIT 1;
-- name: SaveBindingObservation :exec
INSERT INTO binding_observations(binding_id,binding_version,deployment_id,deployment_revision,credential_id,credential_version,health,observed_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8)
ON CONFLICT(binding_id) DO UPDATE SET binding_version=EXCLUDED.binding_version,deployment_id=EXCLUDED.deployment_id,
 deployment_revision=EXCLUDED.deployment_revision,credential_id=EXCLUDED.credential_id,credential_version=EXCLUDED.credential_version,
 health=EXCLUDED.health,observed_at=EXCLUDED.observed_at
WHERE binding_observations.observed_at<=EXCLUDED.observed_at;
-- name: GetApplicationHealth :one
SELECT health FROM application_health WHERE app_id=$1;

-- name: BindingObservationClock :one
SELECT clock_timestamp()::timestamptz AS observed_at;
-- name: LatestVerifiedArtifact :one
SELECT a.* FROM artifacts a LEFT JOIN builds b ON b.id=a.build_id LEFT JOIN build_attempts t ON t.id=a.attempt_id
WHERE a.app_id=$1 AND ((a.source='external' AND a.build_id IS NULL AND a.attempt_id IS NULL AND a.registry_id IS NOT NULL AND a.imported_by IS NOT NULL)
OR (b.app_id=a.app_id AND t.build_id=b.id AND a.source='build'
AND b.status='succeeded' AND t.status='succeeded' AND b.artifact_id=a.id))
ORDER BY a.created_at DESC,a.id DESC LIMIT 1;
