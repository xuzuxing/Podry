-- name: CreateUser :one
INSERT INTO users(email,name,password_hash,is_super_admin)
VALUES($1,$2,$3,$4) RETURNING *;

-- name: GetUser :one
SELECT * FROM users WHERE id=$1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email=$1;

-- name: LockUser :one
SELECT * FROM users WHERE id=$1 FOR SHARE;

-- name: LockUserForUpdate :one
SELECT * FROM users WHERE email=$1 FOR UPDATE;

-- name: LockAccountAdministration :exec
SELECT pg_advisory_xact_lock(7070240001);

-- name: CountSuperAdmins :one
SELECT count(*) FROM users WHERE is_super_admin AND disabled_at IS NULL;

-- name: InvalidateTokens :one
UPDATE users SET token_version=token_version+1 WHERE id=$1 RETURNING *;

-- name: DisableUser :one
UPDATE users SET disabled_at=now(), token_version=token_version+1 WHERE id=$1 RETURNING *;

-- name: ResetPassword :one
UPDATE users SET password_hash=$2, token_version=token_version+1 WHERE id=$1 RETURNING *;
