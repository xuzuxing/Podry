package main

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/xuzuxing/podry/internal/build"
)

func TestCheckSuccessFailureEnvironmentAndDeadline(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("runner executes in Linux containers")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "Dockerfile"), []byte("FROM scratch"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PODRY_PARENT_SECRET", "must-not-inherit")
	for _, tc := range []struct {
		name, script string
		failure      bool
	}{
		{"success", `test -f Dockerfile; test "$CI" = true; test -z "${PODRY_PARENT_SECRET:-}"`, false},
		{"failure", `exit 9`, true},
		{"unset", `echo "$UNSET_PODRY_VARIABLE"`, true},
		{"empty", " ", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			spec := build.ExecutionSpec{Context: ".", Dockerfile: "Dockerfile", CheckScript: &tc.script}
			if err := checkRepository(context.Background(), spec, root); (err != nil) != tc.failure {
				t.Fatalf("failure=%v err=%v", tc.failure, err)
			}
		})
	}
	script := "exec sleep 10"
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := checkRepository(ctx, build.ExecutionSpec{Context: ".", Dockerfile: "Dockerfile", CheckScript: &script}, root); err == nil {
		t.Fatal("deadline did not stop checks")
	}
}
