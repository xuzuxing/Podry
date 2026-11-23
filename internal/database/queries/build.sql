-- name: CreateBuild :one
INSERT INTO builds(id,app_id,pipeline_id,config_version,commit_sha,requested_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *;
-- name: CreateBuildAttempt :one
INSERT INTO build_attempts(id,build_id,attempt_no,build_cluster_id,namespace,job_name,execution_spec,execution_hash)
VALUES($1,$2,1,$3,$4,$5,$6,$7) RETURNING *;
-- name: GetBuild :one
SELECT * FROM builds WHERE id=$1;
-- name: LockBuild :one
SELECT * FROM builds WHERE id=$1 FOR UPDATE;
-- name: LockBuildAttempt :one
SELECT * FROM build_attempts WHERE build_id=$1 AND attempt_no=$2 FOR UPDATE;
-- name: RequestBuildCancel :one
UPDATE build_attempts SET cancel_requested_at=COALESCE(cancel_requested_at,clock_timestamp()),
 cancel_requested_by=COALESCE(cancel_requested_by,sqlc.arg(actor_id)::uuid),
 status=CASE WHEN status='unknown' THEN status ELSE 'canceling' END,next_poll_at=clock_timestamp()
WHERE id=$1 AND stage<>'finished' RETURNING *;
-- name: CancelUnclaimedBuildAttempt :one
UPDATE build_attempts SET stage='finished',status='canceled',finished_at=clock_timestamp(),
 lease_owner=NULL,lease_expires_at=NULL,revision=revision+1
WHERE id=$1 AND stage='planned' AND job_uid IS NULL AND cancel_requested_at IS NOT NULL
 AND (lease_expires_at IS NULL OR lease_expires_at<clock_timestamp()) RETURNING *;
-- name: RetryBuild :one
UPDATE builds SET status='queued',attempt_no=attempt_no+1,artifact_id=NULL
WHERE id=$1 AND attempt_no=$2 AND status IN ('failed','canceled') AND artifact_id IS NULL RETURNING *;
-- name: CreateRetryBuildAttempt :one
INSERT INTO build_attempts(id,build_id,attempt_no,build_cluster_id,namespace,job_name,execution_spec,execution_hash)
VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *;
-- name: OtherActiveBuildAttempt :one
SELECT EXISTS(SELECT 1 FROM build_attempts WHERE build_id=$1 AND attempt_no<>$2
 AND (stage<>'finished' OR status IN ('queued','running','canceling','unknown') OR lease_expires_at>clock_timestamp()));
-- name: ListBuilds :many
SELECT * FROM builds WHERE app_id=$1 ORDER BY created_at DESC,id LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);
-- name: CountBuilds :one
SELECT count(*) FROM builds WHERE app_id=$1;
-- name: ListBuildAttempts :many
SELECT * FROM build_attempts WHERE build_id=$1 ORDER BY attempt_no;
-- name: GetBuildAttempt :one
SELECT * FROM build_attempts WHERE build_id=$1 AND attempt_no=$2;
-- name: BuildArtifactExecution :one
SELECT execution_spec,execution_hash FROM build_attempts WHERE id=$1 AND build_id=$2;
-- name: HasActiveBuilds :one
SELECT EXISTS(SELECT 1 FROM builds WHERE app_id=$1 AND status IN ('queued','running','canceling','unknown'));
-- name: ClaimBuildAttempt :one
WITH candidate AS (
 SELECT id FROM build_attempts WHERE status IN ('queued','running','canceling','unknown') AND next_poll_at<=now()
 AND (lease_expires_at IS NULL OR lease_expires_at<now()) ORDER BY next_poll_at,id FOR UPDATE SKIP LOCKED LIMIT 1
)
UPDATE build_attempts SET lease_owner=$1,lease_expires_at=now()+interval '60 seconds',revision=revision+1
WHERE id IN (SELECT id FROM candidate) RETURNING *;
-- name: TransitionBuildAttempt :one
UPDATE build_attempts SET stage=$4,status=$5,job_uid=COALESCE(job_uid,sqlc.narg(job_uid)::text),error_code=sqlc.narg(error_code),
 started_at=CASE WHEN $5::text='running' THEN COALESCE(started_at,now()) ELSE started_at END,
 finished_at=CASE WHEN $4::text='finished' THEN now() ELSE finished_at END,
 log_availability=CASE WHEN log_availability='archived' THEN log_availability ELSE sqlc.arg(log_availability)::text END,
 lease_owner=NULL,lease_expires_at=NULL,next_poll_at=now()+interval '2 seconds',revision=revision+1
WHERE id=$1 AND revision=$2 AND lease_owner=$3 AND lease_expires_at>clock_timestamp() RETURNING *;
-- name: MarkBuildCreateIntent :one
UPDATE build_attempts SET stage='creating',revision=revision+1
WHERE id=$1 AND revision=$2 AND lease_owner=$3 AND lease_expires_at>clock_timestamp() AND stage='planned'
 AND cancel_requested_at IS NULL RETURNING *;
-- name: SetBuildState :exec
UPDATE builds SET status=$2,artifact_id=COALESCE(sqlc.narg(artifact_id)::uuid,artifact_id) WHERE id=$1;
-- name: CreateArtifact :one
INSERT INTO artifacts(id,app_id,build_id,attempt_id,image_repository,digest) VALUES($1,$2,$3,$4,$5,$6) RETURNING *;
-- name: ListArtifacts :many
SELECT * FROM artifacts WHERE app_id=$1 ORDER BY created_at DESC,id LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);
-- name: CreateExternalArtifact :one
INSERT INTO artifacts(id,app_id,image_repository,digest,source,registry_id,registry_credential_id,registry_credential_version,imported_by)
VALUES($1,$2,$3,$4,'external',$5,$6,$7,$8) RETURNING *;
-- name: VerifiedArtifact :one
SELECT a.* FROM artifacts a
LEFT JOIN builds b ON b.id=a.build_id LEFT JOIN build_attempts t ON t.id=a.attempt_id
WHERE a.id=$1 AND a.app_id=$2 AND (
 (a.source='external' AND a.build_id IS NULL AND a.attempt_id IS NULL AND a.registry_id IS NOT NULL AND a.imported_by IS NOT NULL)
 OR (a.source='build' AND b.app_id=a.app_id AND t.build_id=b.id AND t.status='succeeded' AND b.status='succeeded' AND b.artifact_id=a.id));
-- name: CountArtifacts :one
SELECT count(*) FROM artifacts WHERE app_id=$1;
-- name: SaveLogArchive :exec
INSERT INTO log_archives(id,build_attempt_id,storage_key,byte_size,sha256,expires_at) VALUES($1,$2,$3,$4,$5,$6)
ON CONFLICT(build_attempt_id) DO NOTHING;
-- name: GetLogArchive :one
SELECT * FROM log_archives WHERE build_attempt_id=$1;
-- name: SetBuildLogAvailability :exec
UPDATE build_attempts SET log_availability=$2 WHERE id=$1;
-- name: NextBuildArchive :one
UPDATE build_attempts SET next_poll_at=now()+interval '30 seconds'
WHERE id=(SELECT id FROM build_attempts WHERE stage='finished' AND job_uid IS NOT NULL AND log_availability IN ('runtime','unavailable')
 AND finished_at>now()-interval '7 days' AND next_poll_at<=now()
 ORDER BY next_poll_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *;
-- name: ExpiredBuildArchives :many
SELECT l.* FROM log_archives l JOIN build_attempts a ON a.id=l.build_attempt_id
WHERE l.expires_at<=now() AND a.log_availability<>'expired' ORDER BY l.expires_at LIMIT 20;
