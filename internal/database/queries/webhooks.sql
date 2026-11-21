-- name: GetPipeline :one
SELECT * FROM pipelines WHERE id=$1;
-- name: GetPushAuthorization :one
SELECT * FROM pipeline_push_authorizations WHERE pipeline_id=$1;
-- name: SavePushAuthorization :exec
INSERT INTO pipeline_push_authorizations(pipeline_id,authorized_by,pipeline_version,repository_url)
VALUES($1,$2,$3,$4) ON CONFLICT(pipeline_id) DO UPDATE
SET authorized_by=EXCLUDED.authorized_by,pipeline_version=EXCLUDED.pipeline_version,
 repository_url=EXCLUDED.repository_url,created_at=now();
-- name: DeletePushAuthorization :exec
DELETE FROM pipeline_push_authorizations WHERE pipeline_id=$1;
-- name: GetWebhookDelivery :one
SELECT * FROM webhook_deliveries WHERE provider=$1 AND pipeline_id=$2 AND delivery_id=$3;
-- name: CreateWebhookDelivery :one
INSERT INTO webhook_deliveries(id,provider,pipeline_id,delivery_id,request_hash,build_id,status)
VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *;
