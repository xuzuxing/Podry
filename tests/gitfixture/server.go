// Package gitfixture serves generated Git objects over isolated HTTPS smart Git.
// It never contacts a hosted repository or starts a Git executable.
package gitfixture

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/format/packfile"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/go-git/go-git/v5/plumbing/protocol/packp"
	"github.com/go-git/go-git/v5/plumbing/protocol/packp/capability"
	"github.com/go-git/go-git/v5/storage/memory"
)

type Fixture struct {
	Server            *httptest.Server
	Main              []plumbing.Hash
	Feature           plumbing.Hash
	Merge             plumbing.Hash
	UseMerge          atomic.Bool
	AdvertiseFilter   atomic.Bool
	SawFilter         atomic.Bool
	Status            atomic.Int32
	RequireAuth       atomic.Bool
	Empty             atomic.Bool
	MoveMainToFeature atomic.Bool
	Requests          atomic.Int32
	// Install before starting a query, for controlled concurrent revocation tests.
	Before       func(*http.Request)
	PackOverride []byte
	storage      *memory.Storage
	branches     map[string]plumbing.Hash
	tree         plumbing.Hash
}

func New(t *testing.T) *Fixture {
	t.Helper()
	f := &Fixture{storage: memory.NewStorage(), branches: map[string]plumbing.Hash{}}
	tree := f.storage.NewEncodedObject()
	if err := (&object.Tree{}).Encode(tree); err != nil {
		t.Fatal(err)
	}
	var err error
	f.tree, err = f.storage.SetEncodedObject(tree)
	if err != nil {
		t.Fatal(err)
	}
	add := func(message string, parents ...plumbing.Hash) plumbing.Hash {
		sig := object.Signature{Name: "Fixture author", Email: "private-author@example.test", When: time.Date(2026, 11, 20, 10, len(f.Main), 0, 0, time.UTC)}
		c := object.Commit{Author: sig, Committer: sig, Message: message, ParentHashes: parents, TreeHash: f.tree}
		o := f.storage.NewEncodedObject()
		if err := c.Encode(o); err != nil {
			t.Fatal(err)
		}
		h, err := f.storage.SetEncodedObject(o)
		if err != nil {
			t.Fatal(err)
		}
		return h
	}
	f.Main = append(f.Main, add("Initial commit\n\nPrivate details"))
	f.Main = append(f.Main, add("Second commit", f.Main[0]))
	f.Main = append(f.Main, add("Third commit", f.Main[1]))
	f.Feature = add("Feature only", f.Main[0])
	f.Merge = add("Merge feature", f.Main[2], f.Feature)
	f.branches["main"] = f.Main[2]
	f.branches["feature/demo"] = f.Feature
	f.Server = httptest.NewTLSServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.Server.Close)
	return f
}
func (f *Fixture) URL() string { return f.Server.URL + "/team/repo.git" }
func (f *Fixture) serve(w http.ResponseWriter, r *http.Request) {
	f.Requests.Add(1)
	if f.Before != nil {
		f.Before(r)
	}
	if code := f.Status.Load(); code != 0 {
		http.Error(w, "upstream secret: do-not-echo", int(code))
		return
	}
	if f.RequireAuth.Load() {
		u, p, ok := r.BasicAuth()
		if !ok || u != "git" || p != "fixture-private-token" {
			w.WriteHeader(401)
			return
		}
	}
	if strings.HasSuffix(r.URL.Path, "/info/refs") && r.Method == "GET" {
		w.Header().Set("Content-Type", "application/x-git-upload-pack-advertisement")
		adv := packp.NewAdvRefs()
		adv.Prefix = [][]byte{[]byte("# service=git-upload-pack\n"), {}}
		if !f.Empty.Load() {
			head := f.Main[2]
			if f.UseMerge.Load() {
				head = f.Merge
			}
			if f.MoveMainToFeature.Load() {
				head = f.Feature
			}
			adv.Head = &head
			_ = adv.Capabilities.Set(capability.SymRef, "HEAD:refs/heads/main")
			if f.AdvertiseFilter.Load() {
				_ = adv.Capabilities.Set(capability.Filter)
			}
			for name, h := range f.branches {
				if name == "main" {
					h = head
				}
				adv.References["refs/heads/"+name] = h
			}
		}
		_ = adv.Encode(w)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/git-upload-pack") && r.Method == "POST" {
		data, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "invalid request", 400)
			return
		}
		filterLine := "filter tree:0\n"
		filterPacket := []byte(fmt.Sprintf("%04x%s", 4+len(filterLine), filterLine))
		if bytes.Contains(data, filterPacket) {
			f.SawFilter.Store(true)
			data = bytes.ReplaceAll(data, filterPacket, nil)
		}
		var req = packp.NewUploadPackRequest()
		if err := req.Decode(bytes.NewReader(data)); err != nil {
			http.Error(w, "invalid request", 400)
			return
		}
		if len(req.Wants) != 1 {
			http.Error(w, "only one branch", 400)
			return
		}
		want := req.Wants[0]
		valid := f.UseMerge.Load() && want == f.Merge
		for _, h := range f.branches {
			valid = valid || h == want
		}
		if !valid {
			http.Error(w, "unadvertised object", 400)
			return
		}
		hashes := []plumbing.Hash{}
		if !f.SawFilter.Load() {
			hashes = append(hashes, f.tree)
		}
		seen := map[plumbing.Hash]bool{}
		pending := []plumbing.Hash{want}
		for len(pending) > 0 {
			h := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if seen[h] {
				continue
			}
			seen[h] = true
			hashes = append(hashes, h)
			c, err := object.GetCommit(f.storage, h)
			if err != nil {
				http.Error(w, "bad fixture", 500)
				return
			}
			pending = append(pending, c.ParentHashes...)
		}
		var pack bytes.Buffer
		if _, err := packfile.NewEncoder(&pack, f.storage, false).Encode(hashes, 10); err != nil {
			http.Error(w, "bad pack", 500)
			return
		}
		w.Header().Set("Content-Type", "application/x-git-upload-pack-result")
		response := packp.NewUploadPackResponseWithPackfile(req, io.NopCloser(bytes.NewReader(pack.Bytes())))
		if f.PackOverride != nil {
			response = packp.NewUploadPackResponseWithPackfile(req, io.NopCloser(bytes.NewReader(f.PackOverride)))
		}
		_ = response.Encode(w)
		return
	}
	http.Error(w, fmt.Sprintf("unexpected fixture path %s", r.URL.Path), 404)
}
