-- name: SaveDeployAuthorization :exec
INSERT INTO pipeline_deploy_authorizations(pipeline_id,authorized_by,pipeline_version)
VALUES($1,$2,$3) ON CONFLICT(pipeline_id) DO UPDATE
SET authorized_by=EXCLUDED.authorized_by,pipeline_version=EXCLUDED.pipeline_version,created_at=now();
-- name: DeleteDeployAuthorization :exec
DELETE FROM pipeline_deploy_authorizations WHERE pipeline_id=$1;
-- name: GetDeployAuthorization :one
SELECT * FROM pipeline_deploy_authorizations WHERE pipeline_id=$1;
-- name: NextAutoDeployIntent :one
SELECT i.* FROM auto_deploy_intents i JOIN builds b ON b.id=i.build_id
WHERE i.status IN ('waiting','blocked') AND i.next_poll_at<=now()
 AND b.status='succeeded' AND b.artifact_id IS NOT NULL
ORDER BY i.next_poll_at,i.id LIMIT 1;
-- name: LockAutoDeployIntent :one
SELECT * FROM auto_deploy_intents WHERE id=$1 FOR UPDATE;
-- name: FinishAutoDeployIntent :execrows
UPDATE auto_deploy_intents SET status=$2,error_code=$3,request_id=$4,
 next_poll_at=now()+interval '30 seconds',updated_at=now()
WHERE id=$1 AND status IN ('waiting','blocked');
-- name: ListBuildAutoDeployIntents :many
SELECT * FROM auto_deploy_intents WHERE build_id=$1 ORDER BY created_at,id;
-- name: RequestAutoDeployAllowed :one
SELECT NOT EXISTS(SELECT 1 FROM auto_deploy_intents original WHERE original.request_id=sqlc.narg(request_id)::uuid) OR EXISTS(
 SELECT 1 FROM auto_deploy_intents i
 JOIN builds build ON build.id=i.build_id
 JOIN applications a ON a.id=build.app_id AND a.workflow_version=i.workflow_version
 JOIN pipelines ci ON ci.id=build.pipeline_id AND ci.enabled AND ci.version=i.ci_version
 JOIN pipelines cd ON cd.id=i.pipeline_id AND cd.enabled AND cd.version=i.pipeline_version
 JOIN pipeline_deploy_authorizations d ON d.pipeline_id=cd.id AND d.pipeline_version=cd.version AND d.authorized_by=i.authorized_by
 JOIN app_environment_bindings b ON b.id=i.binding_id AND b.auto_deploy AND b.version=i.binding_version
 JOIN environments e ON e.id=b.environment_id AND e.auto_deploy_allowed AND NOT e.production
 WHERE i.request_id=sqlc.narg(request_id)::uuid AND cd.definition->>'triggerMode'='on_ci_success'
 AND cd.definition->>'upstreamPipelineId'=ci.id::text
 AND i.config_version=(SELECT max(version) FROM app_config_versions WHERE app_id=a.id)
) AS allowed;
