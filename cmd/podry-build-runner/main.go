// podry-build-runner is the platform-controlled source/BuildKit tool. User code
// receives no Kubernetes credential or ServiceAccount token.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/credential"
)

const workspace = "/workspace/repository"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "git-askpass" {
		if e := askpass(); e != nil {
			os.Exit(1)
		}
		return
	}
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, "Podry controlled build step failed; inspect phase logs and cluster events.")
		os.Exit(1)
	}
}
func loadSpec() (build.ExecutionSpec, error) {
	var s build.ExecutionSpec
	f, e := os.Open("/run/podry/input.json")
	if e != nil {
		return s, e
	}
	defer f.Close()
	raw, e := io.ReadAll(io.LimitReader(f, 1<<20))
	if e != nil {
		return s, e
	}
	e = json.Unmarshal(raw, &s)
	if e != nil || s.Version != 1 || s.TimeoutSeconds < 60 || s.TimeoutSeconds > 14400 || !regexp.MustCompile(`^[0-9a-f]{40}$`).MatchString(s.CommitSHA) {
		return s, errors.New("invalid execution input")
	}
	return s, nil
}
func run() error {
	spec, e := loadSpec()
	if e != nil {
		return e
	}
	if len(os.Args) != 2 {
		return errors.New("mode required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(spec.TimeoutSeconds)*time.Second)
	defer cancel()
	switch os.Args[1] {
	case "source":
		return source(ctx, spec)
	case "build":
		return image(ctx, spec)
	default:
		return errors.New("unsupported mode")
	}
}
func askpass() error {
	raw, e := os.ReadFile("/run/podry-auth/git.json")
	if e != nil {
		return e
	}
	var p map[string]string
	if e = json.Unmarshal(raw, &p); e != nil {
		return e
	}
	key := "token"
	if len(os.Args) > 2 && strings.Contains(strings.ToLower(os.Args[2]), "username") {
		key = "username"
	}
	value := p[key]
	if strings.ContainsAny(value, "\x00\r\n") {
		return errors.New("invalid authentication input")
	}
	_, e = fmt.Fprintln(os.Stdout, value)
	return e
}
func git(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = workspace
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_ASKPASS=/usr/local/bin/podry-build-runner git-askpass", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_LFS_SKIP_SMUDGE=1", "HOME=/tmp")
	// Git can include credential-dependent remote messages in stderr. Only the
	// fixed phase marker is logged; auth data is never copied into remote URLs.
	cmd.Stderr = io.Discard
	out, e := cmd.Output()
	if e != nil {
		return "", errors.New("source operation failed")
	}
	if len(out) > 1<<20 {
		return "", errors.New("source output budget exceeded")
	}
	return strings.TrimSpace(string(out)), nil
}
func source(ctx context.Context, spec build.ExecutionSpec) error {
	fmt.Println("source: fetching fixed commit")
	u, e := url.Parse(spec.RepositoryURL)
	if e != nil || u.User != nil || credential.WebURL(spec.RepositoryURL, false, spec.GitHTTPAllowed) != nil {
		return errors.New("unsupported repository")
	}
	if e = os.MkdirAll(workspace, 0755); e != nil {
		return e
	}
	for _, args := range [][]string{{"init"}, {"config", "core.hooksPath", "/dev/null"}, {"config", "http.followRedirects", "false"}, {"config", "credential.helper", ""}, {"remote", "add", "origin", spec.RepositoryURL}, {"fetch", "--depth=1", "--no-tags", "origin", spec.CommitSHA}, {"checkout", "--detach", "FETCH_HEAD"}} {
		if _, e = git(ctx, args...); e != nil {
			return e
		}
	}
	head, e := git(ctx, "rev-parse", "HEAD")
	if e != nil || head != spec.CommitSHA {
		return errors.New("commit identity mismatch")
	}
	if _, _, e = build.RepositoryPaths(workspace, spec.Context, spec.Dockerfile); e != nil {
		return e
	}
	fmt.Println("source: fixed commit and repository paths verified")
	return nil
}
func image(ctx context.Context, spec build.ExecutionSpec) error {
	contextDir, dockerfile, e := build.RepositoryPaths(workspace, spec.Context, spec.Dockerfile)
	if e != nil {
		return e
	}
	metadata := "/tmp/podry-buildkit-metadata.json"
	output, e := spec.ImageOutput()
	if e != nil {
		return e
	}
	args := []string{"--addr", spec.BuilderEndpoint, "build", "--frontend", "dockerfile.v0", "--local", "context=" + contextDir, "--local", "dockerfile=" + filepath.Dir(dockerfile), "--opt", "filename=" + filepath.Base(dockerfile), "--opt", "platform=" + spec.Platform, "--output", output, "--metadata-file", metadata}
	keys := []string{}
	for key := range spec.BuildArgs {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		args = append(args, "--opt", "build-arg:"+key+"="+spec.BuildArgs[key])
	}
	cmd := exec.CommandContext(ctx, "/usr/local/bin/buildctl", args...)
	cmd.Env = append(os.Environ(), "DOCKER_CONFIG=/run/podry-auth", "HOME=/tmp")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	fmt.Println("build: invoking BuildKit and pushing attempt image")
	if e = cmd.Run(); e != nil {
		return errors.New("BuildKit execution failed")
	}
	f, e := os.Open(metadata)
	if e != nil {
		return e
	}
	defer f.Close()
	raw, e := io.ReadAll(io.LimitReader(f, 1<<20))
	if e != nil {
		return e
	}
	var result map[string]json.RawMessage
	if e = json.Unmarshal(raw, &result); e != nil {
		return e
	}
	var digest string
	if e = json.Unmarshal(result["containerimage.digest"], &digest); e != nil || !regexp.MustCompile(`^sha256:[0-9a-f]{64}$`).MatchString(digest) {
		return errors.New("BuildKit digest missing")
	}
	u, _ := url.Parse(spec.RegistryEndpoint)
	message, e := json.Marshal(build.RunnerResult{Version: 1, AttemptID: spec.AttemptID, ImageRepository: u.Host + "/" + spec.ImageRepository, Digest: digest})
	if e != nil || len(message) > 1024 {
		return errors.New("result exceeds protocol budget")
	}
	return os.WriteFile("/dev/termination-log", message, 0600)
}
