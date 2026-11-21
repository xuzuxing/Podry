-- name: GetArtifact :one
SELECT * FROM artifacts WHERE id=$1;
-- name: GetReleaseBinding :one
SELECT b.*,t.cluster_id,t.namespace,t.release_name FROM app_environment_bindings b
JOIN deployment_targets t ON t.id=b.target_id WHERE b.id=$1 AND b.app_id=$2 FOR UPDATE OF b,t;
-- name: CreateDeploymentPreview :one
INSERT INTO deployment_previews(id,app_id,binding_id,artifact_id,config_version,binding_version,snapshot,snapshot_sha256,created_by,expires_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *;
-- name: LockDeploymentPreview :one
SELECT * FROM deployment_previews WHERE id=$1 AND app_id=$2 FOR UPDATE;
-- name: ConsumeDeploymentPreview :execrows
UPDATE deployment_previews SET consumed_at=clock_timestamp() WHERE id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp();
-- name: CreateReleaseSnapshot :one
INSERT INTO release_snapshots(id,preview_id,app_id,binding_id,artifact_id,config_version,binding_version,snapshot,snapshot_sha256)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *;
-- name: CreateReleaseRequest :one
INSERT INTO release_requests(id,snapshot_id,requested_by) VALUES($1,$2,$3) RETURNING *;
-- name: CreateDerivedReleaseRequest :one
INSERT INTO release_requests(id,snapshot_id,requested_by,kind,source_deployment_id,reason)
VALUES($1,$2,$3,$4,$5,$6) RETURNING *;
-- name: CreateDeployment :one
INSERT INTO deployments(id,request_id,target_id) VALUES($1,$2,$3) RETURNING *;
-- name: GetReleaseSnapshot :one
SELECT * FROM release_snapshots WHERE id=$1;
-- name: GetReleaseRequest :one
SELECT r.*,s.app_id,s.binding_id,d.id AS deployment_id FROM release_requests r
JOIN release_snapshots s ON s.id=r.snapshot_id JOIN deployments d ON d.request_id=r.id WHERE r.id=$1;
-- name: GetDeployment :one
SELECT d.*,r.snapshot_id,r.kind,r.source_deployment_id,s.app_id,s.binding_id,s.artifact_id,s.config_version,s.snapshot FROM deployments d
JOIN release_requests r ON r.id=d.request_id JOIN release_snapshots s ON s.id=r.snapshot_id WHERE d.id=$1;
-- name: ListDeployments :many
SELECT d.*,r.snapshot_id,r.kind,r.source_deployment_id,s.app_id,s.binding_id,s.artifact_id,s.config_version,s.snapshot FROM deployments d
JOIN release_requests r ON r.id=d.request_id JOIN release_snapshots s ON s.id=r.snapshot_id
WHERE s.app_id=$1 AND (sqlc.narg(binding_id)::uuid IS NULL OR s.binding_id=sqlc.narg(binding_id))
ORDER BY d.created_at DESC,d.id LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);
-- name: CountDeployments :one
SELECT count(*) FROM deployments d JOIN release_requests r ON r.id=d.request_id JOIN release_snapshots s ON s.id=r.snapshot_id
WHERE s.app_id=$1 AND (sqlc.narg(binding_id)::uuid IS NULL OR s.binding_id=sqlc.narg(binding_id));
-- name: HasActiveDeployments :one
SELECT EXISTS(SELECT 1 FROM deployments d JOIN release_requests r ON r.id=d.request_id JOIN release_snapshots s ON s.id=r.snapshot_id
WHERE s.app_id=$1 AND d.status IN ('queued','submitting','observing','unknown'));
