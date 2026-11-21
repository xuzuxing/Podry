// Package gitremote reads an application's HTTPS Git repository without a checkout.
// Explicit development host allowlists also support HTTP endpoints.
package gitremote

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/format/packfile"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/go-git/go-git/v5/plumbing/protocol/packp"
	"github.com/go-git/go-git/v5/plumbing/protocol/packp/capability"
	"github.com/go-git/go-git/v5/plumbing/transport"
	githttp "github.com/go-git/go-git/v5/plumbing/transport/http"
	"github.com/go-git/go-git/v5/storage/memory"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/httpx"
)

const maxPackBytes = 32 << 20
const maxObjectBytes = 64 << 20
const maxCommits = 20000

type Source struct {
	URL      string
	Username string `json:"-"`
	Token    string `json:"-"`
}
type Branch struct {
	Name      string `json:"name"`
	HeadSHA   string `json:"headSha"`
	IsDefault bool   `json:"isDefault"`
}
type Commit struct {
	SHA         string    `json:"sha"`
	Subject     string    `json:"subject"`
	AuthorName  string    `json:"authorName"`
	CommittedAt time.Time `json:"committedAt"`
}

type Reader struct {
	client transport.Transport
	slots  chan struct{}
	policy credential.URLPolicy
}

func (r *Reader) WithURLPolicy(p credential.URLPolicy) *Reader { r.policy = p; return r }

// Each reader owns its HTTP client; no process-wide protocol registry is changed.
// Custom clients are used for isolated TLS fixtures and enterprise trust stores.
func New(client *http.Client) *Reader {
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	copyClient := *client
	base := copyClient.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	copyClient.Transport = responseBudget{base}
	return &Reader{client: githttp.NewClientWithOptions(&copyClient, &githttp.ClientOptions{RedirectPolicy: githttp.NoFollowRedirects}), slots: make(chan struct{}, 4)}
}

var errBudget = errors.New("Git response budget exceeded")

type responseBudget struct{ http.RoundTripper }

func (b responseBudget) RoundTrip(req *http.Request) (*http.Response, error) {
	response, err := b.RoundTripper.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	limit := int64(maxPackBytes + 1)
	if req.Method == http.MethodGet {
		limit = 4 << 20
	}
	response.Body = &budgetBody{ReadCloser: response.Body, remaining: limit}
	return response, nil
}

type budgetBody struct {
	io.ReadCloser
	remaining int64
}

func (b *budgetBody) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if b.remaining == 0 {
		var probe [1]byte
		n, err := b.ReadCloser.Read(probe[:])
		if n > 0 {
			return 0, errBudget
		}
		return 0, err
	}
	if int64(len(p)) > b.remaining {
		p = p[:b.remaining]
	}
	n, err := b.ReadCloser.Read(p)
	b.remaining -= int64(n)
	return n, err
}

func ValidBranch(s string) bool {
	return len(s) > 0 && len(s) <= 255 && !strings.HasPrefix(s, "-") && plumbing.NewBranchReferenceName(s).Validate() == nil
}

func unavailable() error {
	return httpx.Fail(503, "git_unavailable", "Git 仓库暂时不可用，请稍后重试")
}
func queryLimit() error {
	return httpx.Fail(503, "git_query_limit", "仓库查询超过当前读取预算")
}
func classify(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, errBudget):
		return queryLimit()
	case errors.Is(err, transport.ErrAuthenticationRequired), errors.Is(err, transport.ErrAuthorizationFailed):
		return httpx.Fail(422, "git_auth_failed", "Git 仓库认证失败，请检查服务端凭据")
	case errors.Is(err, transport.ErrRepositoryNotFound):
		return httpx.Fail(422, "git_repository_invalid", "Git 仓库不存在或不可访问")
	default:
		// Upstream errors can contain URLs, credentials, response bodies or author data.
		return unavailable()
	}
}

func (r *Reader) session(ctx context.Context, source Source) (transport.UploadPackSession, error) {
	if err := r.policy.Validate(source.URL, false); err != nil {
		return nil, err
	}
	ep, err := transport.NewEndpoint(source.URL)
	if err != nil {
		return nil, httpx.Fail(422, "git_repository_invalid", "Git 仓库地址无效")
	}
	var auth transport.AuthMethod
	if source.Token != "" {
		auth = &githttp.BasicAuth{Username: source.Username, Password: source.Token}
	}
	s, err := r.client.NewUploadPackSession(ep, auth)
	return s, classify(err)
}

func (r *Reader) acquire(ctx context.Context) error {
	select {
	case r.slots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return unavailable()
	}
}

func (r *Reader) Branches(ctx context.Context, source Source) ([]Branch, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err := r.acquire(ctx); err != nil {
		return nil, err
	}
	defer func() { <-r.slots }()
	s, err := r.session(ctx, source)
	if err != nil {
		return nil, err
	}
	defer s.Close()
	refs, err := s.AdvertisedReferencesContext(ctx)
	if errors.Is(err, transport.ErrEmptyRemoteRepository) {
		return []Branch{}, nil
	}
	if err != nil {
		return nil, classify(err)
	}
	out := []Branch{}
	defaultRef := ""
	for _, sym := range refs.Capabilities.Get(capability.SymRef) {
		if strings.HasPrefix(sym, "HEAD:") {
			defaultRef = strings.TrimPrefix(sym, "HEAD:")
		}
	}
	for name, sha := range refs.References {
		ref := plumbing.ReferenceName(name)
		if ref.IsBranch() && !sha.IsZero() {
			out = append(out, Branch{ref.Short(), sha.String(), name == defaultRef})
		}
	}
	if len(out) > 50000 {
		return nil, queryLimit()
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// Commits reads only the graph reachable from an advertised branch tip. It never
// fetches a user supplied SHA, checks out files, runs hooks, or persists a clone.
func (r *Reader) Commits(ctx context.Context, source Source, branch string) ([]Commit, string, error) {
	if !ValidBranch(branch) {
		return nil, "", httpx.Invalid("ref 必须是有效的分支名")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err := r.acquire(ctx); err != nil {
		return nil, "", err
	}
	defer func() { <-r.slots }()
	s, err := r.session(ctx, source)
	if err != nil {
		return nil, "", err
	}
	defer s.Close()
	refs, err := s.AdvertisedReferencesContext(ctx)
	if errors.Is(err, transport.ErrEmptyRemoteRepository) {
		return []Commit{}, "", nil
	}
	if err != nil {
		return nil, "", classify(err)
	}
	tip, ok := refs.References[plumbing.NewBranchReferenceName(branch).String()]
	if !ok || tip.IsZero() {
		return nil, "", httpx.Fail(422, "git_ref_not_found", "Git 分支不存在")
	}
	req := packp.NewUploadPackRequest()
	req.Wants = []plumbing.Hash{tip}
	if refs.Capabilities.Supports(capability.Filter) {
		_ = req.Capabilities.Set(capability.Filter)
		req.Filter = packp.FilterTreeDepth(0)
	}
	response, err := s.UploadPack(ctx, req)
	if err != nil {
		return nil, "", classify(err)
	}
	defer response.Close()
	// A seekable, bounded pack also avoids the parser's nonseekable delta cache.
	packed, err := io.ReadAll(io.LimitReader(response, maxPackBytes+1))
	if err != nil {
		return nil, "", classify(err)
	}
	if len(packed) > maxPackBytes {
		return nil, "", queryLimit()
	}
	if err = checkPack(ctx, packed); err != nil {
		return nil, "", err
	}
	storage := &boundedStorage{Storage: memory.NewStorage(), ctx: ctx}
	parser, err := packfile.NewParserWithStorage(packfile.NewScanner(bytes.NewReader(packed)), storage)
	if err == nil {
		_, err = parser.Parse()
	}
	if err != nil {
		if storage.exceeded {
			return nil, "", queryLimit()
		}
		return nil, "", classify(err)
	}
	out := []Commit{}
	seen := map[plumbing.Hash]bool{}
	pending := []plumbing.Hash{tip}
	for len(pending) > 0 {
		if ctx.Err() != nil {
			return nil, "", unavailable()
		}
		h := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if seen[h] {
			continue
		}
		seen[h] = true
		if len(seen) > maxCommits {
			return nil, "", queryLimit()
		}
		c, err := object.GetCommit(storage, h)
		if err != nil {
			return nil, "", classify(err)
		}
		out = append(out, Commit{c.Hash.String(), strings.TrimSpace(strings.SplitN(c.Message, "\n", 2)[0]), c.Author.Name, c.Committer.When.UTC()})
		pending = append(pending, c.ParentHashes...)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CommittedAt.Equal(out[j].CommittedAt) {
			return out[i].SHA < out[j].SHA
		}
		return out[i].CommittedAt.After(out[j].CommittedAt)
	})
	return out, tip.String(), nil
}

// Inspect compressed object sizes before the parser allocates object buffers.
func checkPack(ctx context.Context, data []byte) error {
	scanner := packfile.NewScanner(bytes.NewReader(data))
	defer scanner.Close()
	_, count, err := scanner.Header()
	if err != nil {
		return classify(err)
	}
	if count > 50000 {
		return queryLimit()
	}
	var total int64
	for i := uint32(0); i < count; i++ {
		if ctx.Err() != nil {
			return unavailable()
		}
		h, err := scanner.NextObjectHeader()
		if err != nil {
			return classify(err)
		}
		if h.Length < 0 || h.Length > 8<<20 {
			return queryLimit()
		}
		stream, err := scanner.ReadObject()
		if err != nil {
			return classify(err)
		}
		buffer := bufio.NewReader(stream)
		size := uint64(h.Length)
		if h.Type == plumbing.OFSDeltaObject || h.Type == plumbing.REFDeltaObject {
			_, err = binary.ReadUvarint(buffer)
			if err == nil {
				size, err = binary.ReadUvarint(buffer)
			}
			if err != nil {
				_ = stream.Close()
				return classify(err)
			}
		}
		if size > 8<<20 {
			_ = stream.Close()
			return queryLimit()
		}
		total += int64(size)
		if total > maxObjectBytes {
			_ = stream.Close()
			return queryLimit()
		}
		_, err = io.Copy(io.Discard, buffer)
		closeErr := stream.Close()
		if err != nil {
			return classify(err)
		}
		if closeErr != nil {
			return classify(closeErr)
		}
	}
	return nil
}

type boundedStorage struct {
	*memory.Storage
	ctx      context.Context
	bytes    int64
	exceeded bool
}

func (s *boundedStorage) SetEncodedObject(o plumbing.EncodedObject) (plumbing.Hash, error) {
	if s.ctx.Err() != nil {
		return plumbing.ZeroHash, s.ctx.Err()
	}
	s.bytes += o.Size()
	if o.Size() > 8<<20 || s.bytes > maxObjectBytes {
		s.exceeded = true
		return plumbing.ZeroHash, queryLimit()
	}
	return s.Storage.SetEncodedObject(o)
}
