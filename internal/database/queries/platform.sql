-- name: CreateCredential :one
INSERT INTO credentials(id,team_id,name,kind,version) VALUES($1,$2,$3,$4,1) RETURNING *;
-- name: InsertSecretVersion :exec
INSERT INTO secret_versions(credential_id,version,encrypted_payload,key_id) VALUES($1,$2,$3,$4);
-- name: GetCredential :one
SELECT * FROM credentials WHERE id=$1;
-- name: LockCredential :one
SELECT * FROM credentials WHERE id=$1 FOR UPDATE;
-- name: SetCredentialVersion :one
UPDATE credentials SET version=version+1 WHERE id=$1 RETURNING *;
-- name: GetSecretVersion :one
SELECT * FROM secret_versions WHERE credential_id=$1 AND version=$2;
-- name: ListCredentials :many
SELECT c.* FROM credentials c WHERE sqlc.arg(is_super_admin)::boolean
 OR (c.team_id IS NULL AND c.kind <> 'kubeconfig')
 OR EXISTS(SELECT 1 FROM team_members m WHERE m.team_id=c.team_id AND m.user_id=sqlc.arg(user_id))
ORDER BY c.name,c.id;
-- name: CreateRegistry :one
INSERT INTO registries(name,endpoint,credential_id) VALUES($1,$2,$3) RETURNING *;
-- name: GetRegistry :one
SELECT * FROM registries WHERE id=$1;
-- name: ListRegistries :many
SELECT * FROM registries ORDER BY name,id;
-- name: CreateEnvironment :one
INSERT INTO environments(name,production) VALUES($1,$2) RETURNING *;
-- name: GetEnvironment :one
SELECT * FROM environments WHERE id=$1;
-- name: ListEnvironments :many
SELECT * FROM environments ORDER BY name,id;
-- name: CreateCluster :one
INSERT INTO clusters(name,api_server,credential_id) VALUES($1,$2,$3) RETURNING *;
-- name: GetCluster :one
SELECT * FROM clusters WHERE id=$1;
-- name: ShareCluster :one
SELECT * FROM clusters WHERE id=$1 FOR SHARE;
-- name: LockCluster :one
SELECT * FROM clusters WHERE id=$1 FOR UPDATE;
-- name: UpdateCluster :one
UPDATE clusters SET name=$2,credential_id=$3,connection_status='unknown',server_version=NULL,last_checked_at=NULL
WHERE id=$1 RETURNING *;
-- name: InvalidateCredentialClusters :exec
UPDATE clusters SET connection_status='unknown',server_version=NULL,last_checked_at=NULL WHERE credential_id=$1;
-- name: ListClusters :many
SELECT c.* FROM clusters c WHERE sqlc.arg(is_super_admin)::boolean OR EXISTS (
 SELECT 1 FROM resource_grants g WHERE g.cluster_id=c.id AND (
  g.user_id=sqlc.arg(user_id) OR EXISTS(SELECT 1 FROM team_members t WHERE t.team_id=g.team_id AND t.user_id=sqlc.arg(user_id))
  OR EXISTS(SELECT 1 FROM projects p JOIN team_members t ON t.team_id=p.team_id AND t.user_id=sqlc.arg(user_id)
    LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=t.user_id WHERE p.id=g.project_id AND (t.role='admin' OR m.user_id IS NOT NULL))
 )) ORDER BY c.name,c.id;
-- name: ListResourceGrants :many
SELECT * FROM resource_grants WHERE cluster_id=$1 ORDER BY id;
-- name: CreateResourceGrant :one
INSERT INTO resource_grants(user_id,team_id,project_id,cluster_id,namespace,resources,actions)
VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *;
-- name: DeleteResourceGrant :execrows
DELETE FROM resource_grants WHERE id=$1 AND cluster_id=$2;
-- name: ActorResourceGrants :many
SELECT g.* FROM resource_grants g WHERE g.cluster_id=sqlc.arg(cluster_id) AND (
 g.user_id=sqlc.arg(user_id)
 OR EXISTS(SELECT 1 FROM team_members t WHERE t.team_id=g.team_id AND t.user_id=sqlc.arg(user_id))
 OR (g.project_id=sqlc.narg(project_id)::uuid AND EXISTS (
   SELECT 1 FROM projects p JOIN team_members t ON t.team_id=p.team_id AND t.user_id=sqlc.arg(user_id)
   LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=t.user_id
   WHERE p.id=g.project_id AND (t.role='admin' OR m.user_id IS NOT NULL)))
);
-- name: LockGrantMembership :one
SELECT role FROM team_members WHERE team_id=$1 AND user_id=$2 FOR SHARE;
-- name: ActorClusterGrants :many
SELECT g.* FROM resource_grants g WHERE g.cluster_id=sqlc.arg(cluster_id) AND (
 g.user_id=sqlc.arg(user_id)
 OR EXISTS(SELECT 1 FROM team_members t WHERE t.team_id=g.team_id AND t.user_id=sqlc.arg(user_id))
 OR EXISTS(SELECT 1 FROM projects p JOIN team_members t ON t.team_id=p.team_id AND t.user_id=sqlc.arg(user_id)
 LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=t.user_id
 WHERE p.id=g.project_id AND (t.role='admin' OR m.user_id IS NOT NULL))) ORDER BY g.id;
-- name: SetClusterObservation :one
UPDATE clusters SET connection_status=$2,server_version=$3,last_checked_at=$4 WHERE id=$1 RETURNING *;
