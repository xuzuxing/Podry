-- name: CreateApplication :one
INSERT INTO applications(project_id,name,description,source_mode) VALUES($1,$2,$3,$4) RETURNING *;
-- name: GetApplication :one
SELECT * FROM applications WHERE id=$1;
-- name: LockApplication :one
SELECT * FROM applications WHERE id=$1 FOR UPDATE;
-- name: ShareApplication :one
SELECT * FROM applications WHERE id=$1 FOR SHARE;
-- name: UpdateApplication :one
UPDATE applications SET description=$2,archived_at=$3,updated_at=now() WHERE id=$1 RETURNING *;
-- name: TouchApplication :exec
UPDATE applications SET updated_at=now() WHERE id=$1;
-- name: NextWorkflowVersion :one
UPDATE applications SET workflow_version=workflow_version+1,updated_at=now() WHERE id=$1 RETURNING workflow_version;
-- name: ListApplications :many
SELECT a.*,h.health AS effective_health FROM applications a JOIN projects p ON p.id=a.project_id JOIN application_health h ON h.app_id=a.id
WHERE (sqlc.narg(project_id)::uuid IS NULL OR a.project_id=sqlc.narg(project_id))
AND (sqlc.arg(keyword)::text='' OR strpos(lower(a.name || ' ' || a.description),lower(sqlc.arg(keyword)))>0)
AND (sqlc.narg(environment_id)::uuid IS NULL OR EXISTS(SELECT 1 FROM app_environment_bindings b WHERE b.app_id=a.id AND b.detached_at IS NULL AND b.environment_id=sqlc.narg(environment_id)))
AND (sqlc.arg(health)::text='' OR h.health=sqlc.arg(health))
AND (sqlc.arg(is_super_admin)::boolean OR EXISTS(SELECT 1 FROM team_members t WHERE t.team_id=p.team_id AND t.user_id=sqlc.arg(user_id)
 AND (t.role='admin' OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=t.user_id))))
ORDER BY a.updated_at DESC,a.id LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);
-- name: CountApplications :one
SELECT count(*) FROM applications a JOIN projects p ON p.id=a.project_id JOIN application_health h ON h.app_id=a.id
WHERE (sqlc.narg(project_id)::uuid IS NULL OR a.project_id=sqlc.narg(project_id))
AND (sqlc.arg(keyword)::text='' OR strpos(lower(a.name || ' ' || a.description),lower(sqlc.arg(keyword)))>0)
AND (sqlc.narg(environment_id)::uuid IS NULL OR EXISTS(SELECT 1 FROM app_environment_bindings b WHERE b.app_id=a.id AND b.detached_at IS NULL AND b.environment_id=sqlc.narg(environment_id)))
AND (sqlc.arg(health)::text='' OR h.health=sqlc.arg(health))
AND (sqlc.arg(is_super_admin)::boolean OR EXISTS(SELECT 1 FROM team_members t WHERE t.team_id=p.team_id AND t.user_id=sqlc.arg(user_id)
 AND (t.role='admin' OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=t.user_id))));
-- name: GetAppConfig :one
SELECT * FROM app_config_versions WHERE app_id=$1 AND (sqlc.arg(version)::integer=0 OR version=sqlc.arg(version)) ORDER BY version DESC LIMIT 1;
-- name: InsertAppConfig :exec
INSERT INTO app_config_versions(app_id,version,git_config,build_config,chart_config,deploy_values,secret_refs,created_by)
VALUES($1,$2,$3,$4,$5,$6,$7,$8);
-- name: CreateTarget :one
INSERT INTO deployment_targets(cluster_id,namespace,release_name) VALUES($1,$2,$3) RETURNING *;
-- name: CreateBinding :one
INSERT INTO app_environment_bindings(app_id,environment_id,target_id,override_values,auto_deploy)
VALUES($1,$2,$3,COALESCE(sqlc.narg(override_values)::jsonb,'{}'::jsonb),$4) RETURNING *;
-- name: UpdateBinding :one
UPDATE app_environment_bindings SET override_values=$3,auto_deploy=sqlc.arg(auto_deploy),version=version+1
WHERE id=$1 AND app_id=$2 AND version=sqlc.arg(expected_version) RETURNING *;
-- name: BindingTargetBusy :one
SELECT EXISTS(
 SELECT 1 FROM deployment_targets t WHERE t.id=sqlc.arg(target_id)::uuid AND t.active_deployment_id IS NOT NULL
 UNION ALL
 SELECT 1 FROM deployments d WHERE d.target_id=sqlc.arg(target_id)::uuid AND d.status IN ('queued','submitting','observing','unknown')
) AS busy;
-- name: ListBindings :many
SELECT b.*,t.cluster_id,t.namespace,t.release_name FROM app_environment_bindings b
JOIN deployment_targets t ON t.id=b.target_id WHERE b.app_id=$1 AND b.detached_at IS NULL ORDER BY b.id;
-- name: ListPipelines :many
SELECT pipelines.* FROM pipelines WHERE pipelines.app_id=$1
AND (binding_id IS NULL OR EXISTS(SELECT 1 FROM app_environment_bindings b WHERE b.id=pipelines.binding_id AND b.detached_at IS NULL))
ORDER BY kind DESC,id;
-- name: CreatePipeline :one
INSERT INTO pipelines(id,app_id,binding_id,kind,definition,enabled) VALUES($1,$2,$3,$4,$5,$6) RETURNING *;
-- name: UpdatePipeline :one
UPDATE pipelines SET definition=$3,enabled=$4,version=version+1 WHERE id=$1 AND app_id=$2 RETURNING *;
-- name: DeletePipeline :exec
DELETE FROM pipelines WHERE id=$1 AND app_id=$2;
