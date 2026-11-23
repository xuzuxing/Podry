package gitfixture_test

import (
	"bytes"
	"context"
	"io"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/xuzuxing/podry/internal/gitremote"
	"github.com/xuzuxing/podry/tests/gitfixture"
)

func TestRootFilesGraphAndNativeShallowCheckout(t *testing.T) {
	f := gitfixture.NewWithRootFiles(t, map[string]string{"Dockerfile": "FROM scratch\n"})
	commits, head, err := gitremote.New(f.Server.Client()).Commits(context.Background(), gitremote.Source{URL: f.URL()}, "main")
	if err != nil || len(commits) != 3 || head != f.Main[2].String() {
		t.Fatal("root-file fixture lost its readable commit graph", err)
	}
	git, err := exec.LookPath("git")
	if err != nil {
		t.Skip("native Git unavailable; graph assertion passed, native checkout skipped")
	}
	httpGit := httptest.NewServer(f.Server.Config.Handler)
	defer httpGit.Close()
	dir := t.TempDir()
	config := filepath.Join(t.TempDir(), "empty-git-config")
	if os.WriteFile(config, nil, 0600) != nil {
		t.Fatal("empty Git configuration unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	for _, args := range [][]string{{"init"}, {"fetch", "--depth=1", "--no-tags", httpGit.URL + "/team/repo.git", head}, {"checkout", "--detach", "FETCH_HEAD"}} {
		cmd := exec.CommandContext(ctx, git, args...)
		var diagnostic bytes.Buffer
		cmd.Dir, cmd.Stdout, cmd.Stderr = dir, io.Discard, &diagnostic
		cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+config)
		if cmd.Run() != nil {
			t.Fatalf("native Git fixture %s failed: %s", args[0], diagnostic.String())
		}
	}
	contents, err := os.ReadFile(filepath.Join(dir, "Dockerfile"))
	if err != nil || string(contents) != "FROM scratch\n" {
		t.Fatal("native checkout lost the Dockerfile")
	}
}
