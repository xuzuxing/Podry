-- name: InsertIdempotency :execrows
INSERT INTO idempotency_records(user_id,operation_id,key,request_hash,expires_at)
VALUES($1,$2,$3,$4,now()+interval '24 hours') ON CONFLICT DO NOTHING;

-- name: GetIdempotency :one
SELECT * FROM idempotency_records WHERE user_id=$1 AND operation_id=$2 AND key=$3 FOR UPDATE;

-- name: CompleteIdempotency :exec
UPDATE idempotency_records SET in_progress=false,response_status=$4,response_body=$5
WHERE user_id=$1 AND operation_id=$2 AND key=$3;
