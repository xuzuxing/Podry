package build

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
)

const logBudget = 20 << 20

type LogLine struct {
	Phase     string `json:"phase"`
	Timestamp string `json:"timestamp"`
	Message   string `json:"message"`
}

func logUnavailable() error {
	return httpx.Fail(404, "log_unavailable", "构建日志尚未可用、已丢失或不可读取")
}
func (s *Service) ReadLogs(ctx context.Context, row sqlcdb.BuildAttempt) ([]LogLine, error) {
	archive, e := s.q.GetLogArchive(ctx, row.ID)
	if e == nil {
		if time.Now().After(archive.ExpiresAt) {
			return nil, logUnavailable()
		}
		root, e := os.OpenRoot(s.Settings.DataDir)
		if e != nil {
			return nil, logUnavailable()
		}
		defer root.Close()
		file, e := root.Open(archive.StorageKey)
		if e != nil {
			return nil, logUnavailable()
		}
		defer file.Close()
		raw, e := io.ReadAll(io.LimitReader(file, logBudget+1))
		sum := sha256.Sum256(raw)
		if e != nil || len(raw) > logBudget || int64(len(raw)) != archive.ByteSize || hex.EncodeToString(sum[:]) != archive.Sha256 {
			return nil, logUnavailable()
		}
		return decodeLogLines(raw)
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return nil, e
	}
	if row.LogAvailability == "expired" {
		return nil, logUnavailable()
	}
	return s.runtimeLogs(ctx, row)
}

func (s *Service) PurgeExpiredArchives(ctx context.Context) error {
	rows, e := s.q.ExpiredBuildArchives(ctx)
	if e != nil || len(rows) == 0 {
		return e
	}
	root, e := os.OpenRoot(s.Settings.DataDir)
	if e != nil {
		return e
	}
	defer root.Close()
	for _, row := range rows {
		if row.StorageKey != "logs/builds/"+row.BuildAttemptID+".ndjson" {
			return logUnavailable()
		}
		if e = root.Remove(row.StorageKey); e != nil && !errors.Is(e, os.ErrNotExist) {
			return e
		}
		if e = s.q.SetBuildLogAvailability(ctx, sqlcdb.SetBuildLogAvailabilityParams{ID: row.BuildAttemptID, LogAvailability: "expired"}); e != nil {
			return e
		}
	}
	return nil
}
func decodeLogLines(raw []byte) ([]LogLine, error) {
	out := []LogLine{}
	scan := bufio.NewScanner(bytes.NewReader(raw))
	scan.Buffer(make([]byte, 4096), 256<<10)
	for scan.Scan() {
		if len(out) >= 100000 {
			return nil, logUnavailable()
		}
		var line LogLine
		if json.Unmarshal(scan.Bytes(), &line) != nil {
			return nil, logUnavailable()
		}
		out = append(out, line)
	}
	if scan.Err() != nil {
		return nil, logUnavailable()
	}
	return out, nil
}
func (s *Service) runtimeLogs(ctx context.Context, row sqlcdb.BuildAttempt) ([]LogLine, error) {
	if row.JobUid == nil {
		return nil, logUnavailable()
	}
	var spec ExecutionSpec
	if json.Unmarshal(row.ExecutionSpec, &spec) != nil || Hash(spec) != row.ExecutionHash {
		return nil, logUnavailable()
	}
	c, e := s.client(ctx, spec)
	if e != nil {
		return nil, logUnavailable()
	}
	defer c.Close()
	var j object
	if e = c.Get(ctx, "/apis/batch/v1/namespaces/"+spec.Namespace+"/jobs/"+spec.JobName, nil, &j); e != nil || !owned(j, spec) || obj(j["metadata"])["uid"] != *row.JobUid {
		return nil, logUnavailable()
	}
	pods, e := readPods(ctx, c, spec, *row.JobUid)
	if e != nil || len(pods) != 1 {
		return nil, logUnavailable()
	}
	p := pods[0]
	name := text(obj(p["metadata"])["name"])
	uid := text(obj(p["metadata"])["uid"])
	out := []LogLine{}
	used := 0
	available := false
	for _, container := range []string{"source", "build"} {
		body, e := c.Open(ctx, "/api/v1/namespaces/"+spec.Namespace+"/pods/"+name+"/log", url.Values{"container": {container}, "timestamps": {"true"}, "follow": {"false"}})
		if e != nil {
			if code(e) == "kubernetes_invalid_query" {
				continue
			}
			return nil, logUnavailable()
		}
		available = true
		raw, e := io.ReadAll(io.LimitReader(body, int64(logBudget-used+1)))
		body.Close()
		used += len(raw)
		if e != nil || used > logBudget {
			return nil, logUnavailable()
		}
		scanner := bufio.NewScanner(bytes.NewReader(raw))
		scanner.Buffer(make([]byte, 4096), 64<<10)
		for scanner.Scan() {
			if len(out) >= 100000 {
				return nil, logUnavailable()
			}
			message := scanner.Text()
			ts := ""
			if head, rest, ok := strings.Cut(message, " "); ok {
				if _, e := time.Parse(time.RFC3339Nano, head); e == nil {
					ts = head
					message = rest
				}
			}
			out = append(out, LogLine{Phase: container, Timestamp: ts, Message: message})
		}
		if scanner.Err() != nil {
			return nil, logUnavailable()
		}
	}
	var after object
	if e = c.Get(ctx, "/api/v1/namespaces/"+spec.Namespace+"/pods/"+name, nil, &after); e != nil || obj(after["metadata"])["uid"] != uid || !hasOwner(after, *row.JobUid) {
		return nil, logUnavailable()
	}
	if !available {
		return nil, logUnavailable()
	}
	return out, nil
}
func (s *Service) ArchiveOne(ctx context.Context) error {
	row, e := s.q.NextBuildArchive(ctx)
	if errors.Is(e, pgx.ErrNoRows) {
		return nil
	}
	if e != nil {
		return e
	}
	lines, e := s.runtimeLogs(ctx, row)
	if e != nil {
		_ = s.q.SetBuildLogAvailability(ctx, sqlcdb.SetBuildLogAvailabilityParams{ID: row.ID, LogAvailability: "unavailable"})
		return e
	}
	var data bytes.Buffer
	enc := json.NewEncoder(&data)
	for _, line := range lines {
		if e = enc.Encode(line); e != nil {
			return e
		}
		if data.Len() > logBudget {
			return logUnavailable()
		}
	}
	if e = os.MkdirAll(s.Settings.DataDir, 0700); e != nil {
		return e
	}
	root, e := os.OpenRoot(s.Settings.DataDir)
	if e != nil {
		return e
	}
	defer root.Close()
	if e = root.MkdirAll("logs/builds", 0700); e != nil {
		return e
	}
	key := "logs/builds/" + row.ID + ".ndjson"
	temporary := key + "." + uuid.NewString() + ".tmp"
	f, e := root.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return e
	}
	defer root.Remove(temporary)
	_, e = f.Write(data.Bytes())
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	if e = root.Rename(temporary, key); e != nil {
		return e
	}
	sum := sha256.Sum256(data.Bytes())
	_, e = database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		e := q.SaveLogArchive(ctx, sqlcdb.SaveLogArchiveParams{ID: uuid.NewString(), BuildAttemptID: row.ID, StorageKey: key, ByteSize: int64(data.Len()), Sha256: hex.EncodeToString(sum[:]), ExpiresAt: time.Now().Add(7 * 24 * time.Hour)})
		if e != nil {
			return false, e
		}
		return true, q.SetBuildLogAvailability(ctx, sqlcdb.SetBuildLogAvailabilityParams{ID: row.ID, LogAvailability: "archived"})
	})
	return e
}
