-- name: InsertResourcePreview :one
INSERT INTO resource_previews(id,cluster_id,requested_by,encrypted_documents,key_id,items_redacted,expires_at)
VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *;
-- name: LockResourcePreview :one
SELECT * FROM resource_previews WHERE id=$1 FOR UPDATE;
-- name: ConsumeResourcePreview :execrows
UPDATE resource_previews SET consumed_at=clock_timestamp() WHERE id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp();
-- name: InsertResourceOperation :one
INSERT INTO resource_operations(id,preview_id,cluster_id,requested_by,kind,encrypted_payload,key_id,payload_redacted,result_redacted,stop_on_error)
VALUES($1,$2,$3,$4,'apply',$5,$6,$7,$8,$9) RETURNING *;
-- name: GetResourceOperation :one
SELECT * FROM resource_operations WHERE id=$1;
-- name: LockResourceReconciliation :one
SELECT *, (lease_expires_at IS NOT NULL AND lease_expires_at>clock_timestamp())::boolean AS worker_active,
 clock_timestamp()::timestamptz AS checked_at FROM resource_operations WHERE id=$1 FOR UPDATE SKIP LOCKED;
-- name: ReconcileResourceOperation :one
UPDATE resource_operations SET status=sqlc.arg(status)::text,result_redacted=sqlc.arg(result_redacted)::jsonb,
 revision=revision+1,lease_owner=NULL,lease_expires_at=NULL,
 retry_at=CASE WHEN sqlc.arg(status)::text='unknown' THEN clock_timestamp()+interval '5 seconds' ELSE clock_timestamp() END,
 finished_at=CASE WHEN sqlc.arg(status)::text IN ('succeeded','failed','partial') THEN clock_timestamp() ELSE NULL END
WHERE id=sqlc.arg(id)::uuid AND revision=sqlc.arg(expected_revision)::bigint AND status IN ('running','unknown')
 AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) RETURNING *;
-- name: NextResourceOperation :one
SELECT * FROM resource_operations WHERE status IN ('queued','running','unknown')
AND retry_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<clock_timestamp()) ORDER BY retry_at,created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
-- name: ClaimResourceOperation :one
UPDATE resource_operations SET lease_owner=sqlc.narg(owner),lease_expires_at=clock_timestamp()+interval '60 seconds',revision=revision+1
WHERE id=$1 AND revision=$2 RETURNING *;
-- name: AdvanceResourceOperation :one
UPDATE resource_operations SET status=sqlc.arg(status)::text,result_redacted=sqlc.arg(result_redacted)::jsonb,revision=revision+1,
lease_owner=CASE WHEN sqlc.arg(release_lease)::boolean THEN NULL ELSE lease_owner END,
lease_expires_at=CASE WHEN sqlc.arg(release_lease)::boolean THEN NULL ELSE clock_timestamp()+interval '60 seconds' END,
retry_at=CASE WHEN sqlc.arg(status)::text='unknown' THEN clock_timestamp()+interval '5 seconds' ELSE clock_timestamp() END,
finished_at=CASE WHEN sqlc.arg(status)::text IN ('succeeded','failed','partial') THEN clock_timestamp() ELSE NULL END
WHERE id=sqlc.arg(id)::uuid AND revision=sqlc.arg(revision)::bigint AND lease_owner=sqlc.narg(owner) AND lease_expires_at>clock_timestamp() RETURNING *;

-- name: InsertResourceAction :one
INSERT INTO resource_operations(id,cluster_id,requested_by,kind,encrypted_payload,key_id,payload_redacted,result_redacted,stop_on_error)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *;
-- name: ResourceActionReleaseBusy :one
SELECT EXISTS(SELECT 1 FROM deployment_targets t WHERE t.cluster_id=sqlc.arg(cluster_id)::uuid
 AND (sqlc.arg(namespace)::text='' OR t.namespace=sqlc.arg(namespace))
 AND (t.active_deployment_id IS NOT NULL OR EXISTS(SELECT 1 FROM deployments d WHERE d.target_id=t.id AND d.status IN ('queued','submitting','observing','unknown'))));
-- name: ResourceActionBusy :one
SELECT EXISTS(SELECT 1 FROM resource_operations o, jsonb_array_elements(o.payload_redacted) doc
 WHERE o.cluster_id=sqlc.arg(cluster_id)::uuid AND o.kind<>'apply' AND o.status IN ('queued','running','unknown')
 AND (doc->'Ref'->>'namespace'='' OR doc->'Ref'->>'namespace'=sqlc.arg(namespace)::text));
