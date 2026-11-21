package application

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/gitremote"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/platform"
)

// GitReader isolates remote I/O so authorization and version races can be tested.
type GitReader interface {
	Branches(context.Context, gitremote.Source) ([]gitremote.Branch, error)
	Commits(context.Context, gitremote.Source, string) ([]gitremote.Commit, string, error)
}
type GitQuery struct {
	Ref, Keyword, SHAPrefix, Cursor string
	Limit                           int
}
type GitBranchList struct {
	Items         []gitremote.Branch `json:"items"`
	NextCursor    *string            `json:"nextCursor"`
	ConfigVersion int32              `json:"configVersion"`
	ObservedAt    time.Time          `json:"observedAt"`
}
type GitCommitList struct {
	Items         []gitremote.Commit `json:"items"`
	NextCursor    *string            `json:"nextCursor"`
	ConfigVersion int32              `json:"configVersion"`
	ResolvedRef   string             `json:"resolvedRef"`
	ObservedAt    time.Time          `json:"observedAt"`
}
type gitSnapshot struct {
	Config            Config
	CredentialVersion int32
	Source            gitremote.Source
}

func parseGitQuery(values url.Values, commits bool) (GitQuery, error) {
	q := GitQuery{Ref: values.Get("ref"), Keyword: values.Get("keyword"), SHAPrefix: values.Get("shaPrefix"), Cursor: values.Get("cursor"), Limit: 20}
	for k, v := range values {
		allowed := k == "cursor" || k == "limit" || !commits && k == "keyword" || commits && (k == "ref" || k == "shaPrefix")
		if !allowed || len(v) != 1 {
			return q, httpx.Invalid("Git 查询参数无效或重复")
		}
	}
	if values.Has("limit") {
		n, err := strconv.Atoi(values.Get("limit"))
		if err != nil || n < 1 || n > 100 {
			return q, httpx.Invalid("limit 必须在 1 到 100 之间")
		}
		q.Limit = n
	}
	if len(q.Keyword) > 255 || strings.ContainsAny(q.Keyword, "\x00\r\n") || len(q.Cursor) > 4096 {
		return q, httpx.Invalid("Git 查询参数过长或无效")
	}
	if commits && (!validBranch(q.Ref) || q.SHAPrefix != "" && !regexp.MustCompile(`^[0-9a-f]{7,64}$`).MatchString(q.SHAPrefix)) {
		return q, httpx.Invalid("ref 或 shaPrefix 无效")
	}
	return q, nil
}

// The transaction holds actor/team/project/application locks only while reading
// authorization and immutable input. No database lock survives remote Git I/O.
func (s *Service) gitSnapshot(ctx context.Context, a auth.Actor, id string, decrypt bool) (gitSnapshot, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (gitSnapshot, error) {
		var out gitSnapshot
		if err := auth.LockActor(ctx, q, a); err != nil {
			return out, err
		}
		app, err := q.GetApplication(ctx, id)
		if err != nil {
			return out, err
		}
		p, err := lockProject(ctx, q, a, app.ProjectID, "build")
		if err != nil {
			return out, err
		}
		if _, err = q.ShareApplication(ctx, id); err != nil {
			return out, err
		}
		out.Config, err = readConfig(ctx, q, id, 0)
		if err != nil {
			return out, err
		}
		g := out.Config.GitConfig
		if g == nil {
			return out, httpx.Fail(422, "git_not_configured", "请先保存应用 Git 配置")
		}
		out.Source.URL = g.RepositoryURL
		if g.CredentialID == nil {
			return out, nil
		}
		cr, err := q.GetCredential(ctx, *g.CredentialID)
		if err != nil {
			return out, err
		}
		if cr.Kind != "git" {
			return out, httpx.Invalid("凭据类型与 Git 配置不符")
		}
		if err = platform.CredentialAccess(ctx, q, a, cr, &p.TeamID, false); err != nil {
			return out, err
		}
		out.CredentialVersion = cr.Version
		if !decrypt {
			return out, nil
		}
		version, err := q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: cr.ID, Version: cr.Version})
		if err != nil {
			return out, err
		}
		payload, err := s.vault.Open(cr.ID, cr.Version, version.KeyID, version.EncryptedPayload)
		if err != nil {
			return out, err
		}
		out.Source.Username, _ = payload["username"].(string)
		out.Source.Token, _ = payload["token"].(string)
		return out, nil
	})
}
func (s *Service) recheckGit(ctx context.Context, a auth.Actor, id string, before gitSnapshot) error {
	after, err := s.gitSnapshot(ctx, a, id, false)
	if err != nil {
		return err
	}
	if before.Config.Version != after.Config.Version || before.CredentialVersion != after.CredentialVersion {
		return httpx.Fail(409, "revision_conflict", "Git 配置或凭据版本已变化，请重新查询")
	}
	return nil
}

type gitCursor struct {
	Scope    string `json:"s"`
	Snapshot string `json:"h"`
	Offset   int    `json:"o"`
	Expires  int64  `json:"e"`
}

func digest(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func (s *Service) cursorMAC(data []byte) []byte {
	h := hmac.New(sha256.New, s.cursorKey)
	h.Write([]byte("podry/git-cursor/v1\x00"))
	h.Write(data)
	return h.Sum(nil)
}
func (s *Service) readGitCursor(raw, scope string) (gitCursor, error) {
	return s.readSignedCursor(raw, scope, 1, 50000, "Git")
}
func (s *Service) readSignedCursor(raw, scope string, minOffset, maxOffset int, kind string) (gitCursor, error) {
	var out gitCursor
	if raw == "" {
		return out, nil
	}
	invalid := httpx.Invalid(kind + " 游标无效、过期或不属于当前查询")
	parts := strings.Split(raw, ".")
	if len(parts) != 2 || len(raw) > 4096 {
		return out, invalid
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return out, invalid
	}
	mac, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(mac, s.cursorMAC(data)) {
		return out, invalid
	}
	if json.Unmarshal(data, &out) != nil || out.Scope != scope || out.Offset < minOffset || out.Offset > maxOffset || out.Expires <= time.Now().Unix() {
		return out, invalid
	}
	return out, nil
}
func (s *Service) nextGitCursor(scope, snapshot string, offset, total int) *string {
	if offset >= total {
		return nil
	}
	data, _ := json.Marshal(gitCursor{scope, snapshot, offset, time.Now().Add(5 * time.Minute).Unix()})
	encoded := base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(s.cursorMAC(data))
	return &encoded
}
func cursorScope(a auth.Actor, id string, snap gitSnapshot, q GitQuery, kind string) string {
	return digest([]any{a.ID, a.TokenVersion, id, snap.Config.Version, snap.CredentialVersion, q.Ref, q.Keyword, q.SHAPrefix, kind})
}
func pageBounds(cursor gitCursor, snapshot string, total, limit int) (int, int, error) {
	if cursor.Scope != "" && cursor.Snapshot != snapshot {
		return 0, 0, httpx.Fail(409, "git_ref_changed", "Git 仓库已变化，请重新查询")
	}
	if cursor.Offset > total {
		return 0, 0, httpx.Invalid("Git 游标位置无效")
	}
	return cursor.Offset, min(cursor.Offset+limit, total), nil
}

func (s *Service) GitBranches(ctx context.Context, a auth.Actor, id string, q GitQuery) (GitBranchList, error) {
	out := GitBranchList{Items: []gitremote.Branch{}}
	snap, err := s.gitSnapshot(ctx, a, id, true)
	if err != nil {
		return out, err
	}
	scope := cursorScope(a, id, snap, q, "branches")
	cursor, err := s.readGitCursor(q.Cursor, scope)
	if err != nil {
		return out, err
	}
	branches, remoteErr := s.git.Branches(ctx, snap.Source)
	if err = s.recheckGit(ctx, a, id, snap); err != nil {
		return out, err
	}
	if remoteErr != nil {
		return out, remoteErr
	}
	observed := time.Now().UTC()
	items := []gitremote.Branch{}
	for _, b := range branches {
		if strings.Contains(strings.ToLower(b.Name), strings.ToLower(q.Keyword)) {
			items = append(items, b)
		}
	}
	snapshot := digest(branches)
	start, end, err := pageBounds(cursor, snapshot, len(items), q.Limit)
	if err != nil {
		return out, err
	}
	out.Items = items[start:end]
	out.ConfigVersion = snap.Config.Version
	out.ObservedAt = observed
	out.NextCursor = s.nextGitCursor(scope, snapshot, end, len(items))
	return out, nil
}
func (s *Service) GitCommits(ctx context.Context, a auth.Actor, id string, q GitQuery) (GitCommitList, error) {
	out := GitCommitList{Items: []gitremote.Commit{}}
	snap, err := s.gitSnapshot(ctx, a, id, true)
	if err != nil {
		return out, err
	}
	scope := cursorScope(a, id, snap, q, "commits")
	cursor, err := s.readGitCursor(q.Cursor, scope)
	if err != nil {
		return out, err
	}
	commits, head, remoteErr := s.git.Commits(ctx, snap.Source, q.Ref)
	if err = s.recheckGit(ctx, a, id, snap); err != nil {
		return out, err
	}
	if remoteErr != nil {
		return out, remoteErr
	}
	items := []gitremote.Commit{}
	for _, c := range commits {
		if strings.HasPrefix(c.SHA, q.SHAPrefix) {
			items = append(items, c)
		}
	}
	start, end, err := pageBounds(cursor, head, len(items), q.Limit)
	if err != nil {
		return out, err
	}
	out.Items = items[start:end]
	out.ConfigVersion = snap.Config.Version
	out.ResolvedRef = head
	out.ObservedAt = time.Now().UTC()
	out.NextCursor = s.nextGitCursor(scope, head, end, len(items))
	return out, nil
}
