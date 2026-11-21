-- name: RecordAudit :exec
INSERT INTO audit_events(actor_id,team_id,project_id,cluster_id,action,target,request_id,result)
VALUES($1,$2,$3,$4,$5,$6,$7,$8);

-- name: ListAuditEvents :many
SELECT a.* FROM audit_events a
WHERE (sqlc.narg(project_id)::uuid IS NULL OR a.project_id=sqlc.narg(project_id))
AND (sqlc.narg(cluster_id)::uuid IS NULL OR a.cluster_id=sqlc.narg(cluster_id))
AND (sqlc.arg(keyword)::text='' OR strpos(a.action,sqlc.arg(keyword))>0)
AND (sqlc.arg(action)::text='' OR a.action=sqlc.arg(action))
AND (sqlc.arg(is_super_admin)::boolean OR
 (a.project_id IS NOT NULL AND EXISTS(
 SELECT 1 FROM projects p JOIN team_members t ON t.team_id=p.team_id AND t.user_id=sqlc.arg(user_id)
 WHERE p.id=a.project_id AND (t.role='admin' OR EXISTS(
 SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=t.user_id)))) OR
 (a.team_id IS NOT NULL AND a.project_id IS NULL AND EXISTS(
 SELECT 1 FROM team_members t WHERE t.team_id=a.team_id AND t.user_id=sqlc.arg(user_id) AND t.role='admin')))
ORDER BY a.created_at DESC,a.id DESC LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: CountAuditEvents :one
SELECT count(*) FROM audit_events a
WHERE (sqlc.narg(project_id)::uuid IS NULL OR a.project_id=sqlc.narg(project_id))
AND (sqlc.narg(cluster_id)::uuid IS NULL OR a.cluster_id=sqlc.narg(cluster_id))
AND (sqlc.arg(keyword)::text='' OR strpos(a.action,sqlc.arg(keyword))>0)
AND (sqlc.arg(action)::text='' OR a.action=sqlc.arg(action))
AND (sqlc.arg(is_super_admin)::boolean OR
 (a.project_id IS NOT NULL AND EXISTS(
 SELECT 1 FROM projects p JOIN team_members t ON t.team_id=p.team_id AND t.user_id=sqlc.arg(user_id)
 WHERE p.id=a.project_id AND (t.role='admin' OR EXISTS(
 SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=t.user_id)))) OR
 (a.team_id IS NOT NULL AND a.project_id IS NULL AND EXISTS(
 SELECT 1 FROM team_members t WHERE t.team_id=a.team_id AND t.user_id=sqlc.arg(user_id) AND t.role='admin')));
