package integration_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/release"
)

// Use the PostgreSQL tools already present in the integration container. Native
// test runs may omit them; no host tools are installed by this test.
func postgresArchiveCommand(t *testing.T, dsn, command string, args ...string) {
	t.Helper()
	tool, err := exec.LookPath(command)
	if err != nil {
		t.Skip("pg_dump and pg_restore are required; run scripts/test-backend.ps1 without -Native")
	}
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid isolated database configuration")
	}
	u, _ := url.Parse(dsn)
	sslmode := u.Query().Get("sslmode")
	if sslmode == "" {
		sslmode = "prefer"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, tool, args...)
	// Passwords stay in the child environment, never command arguments/output.
	cmd.Env = append(os.Environ(), "PGHOST="+cfg.Host, "PGPORT="+strconv.Itoa(int(cfg.Port)), "PGUSER="+cfg.User, "PGPASSWORD="+cfg.Password, "PGDATABASE="+cfg.Database, "PGSSLMODE="+sslmode)
	if err := cmd.Run(); err != nil {
		t.Fatalf("%s failed in the isolated restore rehearsal (connection details withheld)", command)
	}
}

func TestDatabaseRestorePreservesUnknownTargetAndFrozenSecrets(t *testing.T) {
	// Fail/skip before seeding when the native host lacks the PostgreSQL tools.
	for _, command := range []string{"pg_dump", "pg_restore"} {
		if _, err := exec.LookPath(command); err != nil {
			t.Skip("PostgreSQL backup tools required; use the default Linux integration harness")
		}
	}
	f := setupRelease(t, "Job")
	var submits atomic.Int32
	w := releaseWorker(t, f, releaseExecutor{
		submit: func(ctx context.Context, in release.Input) (release.Observation, error) {
			submits.Add(1)
			return release.Observation{State: "unknown", Code: "release_outcome_unknown", Resources: releaseResources(t, in)}, nil
		},
	})
	first := decode[application.ReleaseRequest](t, f.confirm(t, f.preview(t, 3), "restore-release-first", 202))
	second := decode[application.ReleaseRequest](t, f.confirm(t, f.preview(t, 3), "restore-release-second", 202))
	releaseStep(t, w)
	releaseState(t, f, *first.DeploymentID, "unknown")
	f.c.f.call("PUT", "/api/credentials/"+f.secret, f.c.admin, map[string]any{"expectedVersion": 1, "payload": map[string]any{"data": map[string]any{"DATABASE_URL": "rotated-after-frozen-plan"}}}, 200)
	// Log metadata lives in PostgreSQL; the immutable NDJSON file is a separate
	// required part of the backup bundle. Seed only this test-owned archive.
	var attemptID, buildID string
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT attempt_id::text,build_id::text FROM artifacts WHERE id=$1", f.artifact).Scan(&attemptID, &buildID); err != nil {
		t.Fatal(err)
	}
	logData := []byte("{\"phase\":\"build\",\"timestamp\":\"2026-11-21T00:00:00Z\",\"message\":\"restore fixture\"}\n")
	logHash := sha256.Sum256(logData)
	storageKey := "logs/builds/" + attemptID + ".ndjson"
	sourceData := t.TempDir()
	sourceFile := filepath.Join(sourceData, filepath.FromSlash(storageKey))
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sourceFile, logData, 0600); err != nil {
		t.Fatal(err)
	}
	if err := sqlcdb.New(f.c.f.pool).SaveLogArchive(context.Background(), sqlcdb.SaveLogArchiveParams{ID: uuid.NewString(), BuildAttemptID: attemptID, StorageKey: storageKey, ByteSize: int64(len(logData)), Sha256: hex.EncodeToString(logHash[:]), ExpiresAt: time.Now().Add(7 * 24 * time.Hour)}); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "podry.dump")
	postgresArchiveCommand(t, f.c.f.dsn, "pg_dump", "--format=custom", "--no-owner", "--no-acl", "--file="+archive)
	restoredDSN, pool := isolatedDatabase(t, false)
	restoredConfig, _ := pgx.ParseConfig(restoredDSN)
	postgresArchiveCommand(t, restoredDSN, "pg_restore", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "--dbname="+restoredConfig.Database, archive)
	ctx := context.Background()
	if err := database.CheckSchema(ctx, pool); err != nil {
		t.Fatal("restored schema is incompatible", err)
	}
	q := sqlcdb.New(pool)
	var active, state string
	var fence int64
	if err := pool.QueryRow(ctx, "SELECT d.status,t.active_deployment_id::text,t.fencing_token FROM deployments d JOIN deployment_targets t ON t.id=d.target_id WHERE d.id=$1", *first.DeploymentID).Scan(&state, &active, &fence); err != nil || state != "unknown" || active != *first.DeploymentID || fence != 1 {
		t.Fatal("restore lost target occupancy/fencing", err)
	}
	var raw []byte
	var hash string
	if err := pool.QueryRow(ctx, "SELECT s.snapshot,s.snapshot_sha256 FROM release_snapshots s JOIN release_requests r ON r.snapshot_id=s.id JOIN deployments d ON d.request_id=r.id WHERE d.id=$1", *first.DeploymentID).Scan(&raw, &hash); err != nil {
		t.Fatal(err)
	}
	plan, err := release.Decode(raw, hash)
	if err != nil {
		t.Fatal("restored snapshot or embedded Chart failed integrity checks", err)
	}
	secret, err := q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: f.secret, Version: 1})
	if err != nil {
		t.Fatal(err)
	}
	vault, _ := credential.New(testCredentialKey)
	payload, err := vault.Open(f.secret, 1, secret.KeyID, secret.EncryptedPayload)
	if err != nil || bm(payload["data"])["DATABASE_URL"] != "private-db-value-never-return" || len(plan.SecretRefs) != 1 || plan.SecretRefs[0].Version != 1 {
		t.Fatal("restore lost the exact historical credential version")
	}
	wrongVault, _ := credential.New(base64.StdEncoding.EncodeToString([]byte(strings.Repeat("x", 32))))
	if _, err := wrongVault.Open(f.secret, 1, secret.KeyID, secret.EncryptedPayload); err == nil {
		t.Fatal("replacing the encryption key incorrectly unlocked the restored credential")
	}
	dataDir := t.TempDir()
	logReader := build.New(pool, vault, build.Settings{DataDir: dataDir})
	attempt, err := q.GetBuildAttempt(ctx, sqlcdb.GetBuildAttemptParams{BuildID: buildID, AttemptNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := logReader.ReadLogs(ctx, attempt); err == nil {
		t.Fatal("database-only restore incorrectly reported archived logs as readable")
	}
	restoredFile := filepath.Join(dataDir, filepath.FromSlash(storageKey))
	if err := os.MkdirAll(filepath.Dir(restoredFile), 0700); err != nil {
		t.Fatal(err)
	}
	fileBackup, err := os.ReadFile(sourceFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(restoredFile, fileBackup, 0600); err != nil {
		t.Fatal(err)
	}
	if lines, err := logReader.ReadLogs(ctx, attempt); err != nil || len(lines) != 1 || lines[0].Message != "restore fixture" {
		t.Fatal("restored log file did not match its database checksum", err)
	}
	if err := os.WriteFile(restoredFile, []byte("corrupted archive"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := logReader.ReadLogs(ctx, attempt); err == nil {
		t.Fatal("corrupted restored archive was accepted")
	}
	w = release.New(pool, vault, release.Settings{Enabled: true, Concurrency: 1}, releaseExecutor{
		submit: func(context.Context, release.Input) (release.Observation, error) {
			submits.Add(1)
			return release.Observation{State: "failed"}, nil
		},
		observe: func(ctx context.Context, in release.Input) (release.Observation, error) {
			if len(in.Known) != 2 || in.Values != nil {
				return release.Observation{State: "unknown", Code: "fixture_restore_mismatch"}, nil
			}
			return release.Observation{State: "succeeded", Resources: in.Known}, nil
		},
	})
	if _, err := pool.Exec(ctx, "UPDATE deployments SET next_poll_at=clock_timestamp()-interval '1 second' WHERE id=$1", *first.DeploymentID); err != nil {
		t.Fatal(err)
	}
	releaseStep(t, w)
	var current, secondState string
	if err := pool.QueryRow(ctx, "SELECT current_deployment_id::text FROM app_environment_bindings WHERE id=$1", f.binding).Scan(&current); err != nil || current != *first.DeploymentID {
		t.Fatal("restored worker did not advance the successful current pointer", err)
	}
	if err := pool.QueryRow(ctx, "SELECT status FROM deployments WHERE id=$1", *second.DeploymentID).Scan(&secondState); err != nil || secondState != "queued" || submits.Load() != 1 {
		t.Fatal("restore duplicated an unknown submission or lost queued work", err)
	}
}
