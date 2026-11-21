package idempotency

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
)

type Result struct {
	Status int
	Body   json.RawMessage
}

// Execute must run inside the SAME transaction as the business mutation and audit.
// A conflicting insert waits for the first transaction. A rollback removes the reservation.
// Authorization is rechecked by the caller even when returning a stored result.
func Execute(ctx context.Context, q *sqlcdb.Queries, userID, operation, key, method, path string, input any, fn func() (Result, error)) (Result, error) {
	hash, err := requestHash(key, method, path, input)
	if err != nil {
		return Result{}, err
	}
	n, err := q.InsertIdempotency(ctx, sqlcdb.InsertIdempotencyParams{UserID: userID, OperationID: operation, Key: key, RequestHash: hash})
	if err != nil {
		return Result{}, err
	}
	if n == 0 {
		result, found, err := Lookup(ctx, q, userID, operation, key, method, path, input)
		if err == nil && !found {
			err = httpx.Fail(409, "request_in_progress", "幂等结果暂不可用，请重试")
		}
		return result, err
	}
	result, err := fn()
	if err != nil {
		return Result{}, err
	}
	if result.Status < 200 || result.Status > 299 || !json.Valid(result.Body) {
		return Result{}, httpx.Fail(500, "internal_error", "幂等结果无效")
	}
	status := int32(result.Status)
	err = q.CompleteIdempotency(ctx, sqlcdb.CompleteIdempotencyParams{UserID: userID, OperationID: operation, Key: key, ResponseStatus: &status, ResponseBody: result.Body})
	return result, err
}

// Lookup performs no reservation. Callers authorize the stored result before
// returning it, and use Execute in the final business transaction on a miss.
func Lookup(ctx context.Context, q *sqlcdb.Queries, userID, operation, key, method, path string, input any) (Result, bool, error) {
	hash, err := requestHash(key, method, path, input)
	if err != nil {
		return Result{}, false, err
	}
	old, err := q.GetIdempotency(ctx, sqlcdb.GetIdempotencyParams{UserID: userID, OperationID: operation, Key: key})
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, false, nil
	}
	if err != nil {
		return Result{}, false, err
	}
	if old.RequestHash != hash {
		return Result{}, true, httpx.Fail(409, "idempotency_conflict", "幂等键已用于不同请求")
	}
	if old.InProgress {
		return Result{}, true, httpx.Fail(409, "request_in_progress", "请求正在处理")
	}
	if old.ResponseStatus == nil || !json.Valid(old.ResponseBody) {
		return Result{}, true, httpx.Fail(500, "internal_error", "幂等结果无效")
	}
	return Result{int(*old.ResponseStatus), old.ResponseBody}, true, nil
}

func requestHash(key, method, path string, input any) (string, error) {
	if len(key) < 8 || len(key) > 200 || strings.TrimSpace(key) != key {
		return "", httpx.Invalid("Idempotency-Key 长度必须为 8–200")
	}
	for _, c := range key {
		if c < 33 || c > 126 {
			return "", httpx.Invalid("Idempotency-Key 必须为可打印 ASCII")
		}
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(append([]byte(method+"\n"+path+"\n"), payload...))
	return hex.EncodeToString(sum[:]), nil
}
