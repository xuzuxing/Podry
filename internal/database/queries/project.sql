-- name: ListTeams :many
SELECT t.* FROM teams t WHERE sqlc.arg(is_super_admin)::boolean
OR EXISTS(SELECT 1 FROM team_members m WHERE m.team_id=t.id AND m.user_id=sqlc.arg(user_id))
ORDER BY t.name,t.id;

-- name: CreateTeam :one
INSERT INTO teams(name) VALUES($1) RETURNING *;

-- name: GetTeam :one
SELECT * FROM teams WHERE id=$1;

-- name: LockTeam :one
SELECT * FROM teams WHERE id=$1 FOR UPDATE;

-- name: GetTeamRole :one
SELECT role FROM team_members WHERE team_id=$1 AND user_id=$2;

-- name: ListTeamMembers :many
SELECT user_id,role FROM team_members WHERE team_id=$1 ORDER BY user_id;

-- name: CountTeamAdmins :one
SELECT count(*) FROM team_members m JOIN users u ON u.id=m.user_id
WHERE m.team_id=$1 AND m.role='admin' AND u.disabled_at IS NULL;

-- name: UpsertTeamMember :exec
INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,$3)
ON CONFLICT(team_id,user_id) DO UPDATE SET role=excluded.role;

-- name: RemoveTeamMember :execrows
DELETE FROM team_members WHERE team_id=$1 AND user_id=$2;

-- name: ListProjects :many
SELECT p.* FROM projects p WHERE (sqlc.narg(team_id)::uuid IS NULL OR p.team_id=sqlc.narg(team_id))
AND (sqlc.arg(is_super_admin)::boolean OR EXISTS(
 SELECT 1 FROM team_members t WHERE t.team_id=p.team_id AND t.user_id=sqlc.arg(user_id)
 AND (t.role='admin' OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=t.user_id))
)) ORDER BY p.name,p.id;

-- name: CreateProject :one
INSERT INTO projects(team_id,name) VALUES($1,$2) RETURNING *;

-- name: GetProject :one
SELECT * FROM projects WHERE id=$1;

-- name: LockProject :one
SELECT * FROM projects WHERE id=$1 FOR UPDATE;

-- name: GetProjectRole :one
SELECT CASE WHEN t.role='admin' THEN 'admin' ELSE m.role END::text AS role
FROM projects p JOIN team_members t ON t.team_id=p.team_id AND t.user_id=sqlc.arg(user_id)
LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=t.user_id
WHERE p.id=sqlc.arg(project_id) AND (t.role='admin' OR m.role IS NOT NULL);

-- name: ListProjectMembers :many
SELECT user_id,role FROM project_members WHERE project_id=$1 ORDER BY user_id;

-- name: CountProjectAdmins :one
SELECT count(*) FROM project_members m JOIN users u ON u.id=m.user_id
WHERE m.project_id=$1 AND m.role='admin' AND u.disabled_at IS NULL;

-- name: UpsertProjectMember :exec
INSERT INTO project_members(project_id,team_id,user_id,role) VALUES($1,$2,$3,$4)
ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role;

-- name: RemoveProjectMember :execrows
DELETE FROM project_members WHERE project_id=$1 AND user_id=$2;
