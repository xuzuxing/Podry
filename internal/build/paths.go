package build

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func contained(root, path string) bool {
	rel, e := filepath.Rel(root, path)
	return e == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}
func resolve(root, relative string) (string, error) {
	if relative == "" || strings.ContainsAny(relative, "\\:\x00\r\n") || filepath.IsAbs(relative) {
		return "", errors.New("invalid repository path")
	}
	for _, p := range strings.Split(relative, "/") {
		if p == ".." {
			return "", errors.New("path escapes repository")
		}
	}
	p, e := filepath.EvalSymlinks(filepath.Join(root, relative))
	if e != nil || !contained(root, p) {
		return "", errors.New("path escapes repository")
	}
	return p, nil
}

// RepositoryPaths validates checked-out paths before they are sent to BuildKit.
func RepositoryPaths(workspace, contextPath, dockerfilePath string) (string, string, error) {
	root, e := filepath.EvalSymlinks(workspace)
	if e != nil {
		return "", "", e
	}
	contextDir, e := resolve(root, contextPath)
	if e != nil {
		return "", "", e
	}
	dockerfile, e := resolve(root, dockerfilePath)
	if e != nil {
		return "", "", e
	}
	info, e := os.Stat(contextDir)
	if e != nil || !info.IsDir() {
		return "", "", errors.New("context must be a directory")
	}
	info, e = os.Stat(dockerfile)
	if e != nil || !info.Mode().IsRegular() {
		return "", "", errors.New("Dockerfile must be a regular file")
	}
	e = filepath.WalkDir(contextDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			target, e := filepath.EvalSymlinks(path)
			if e != nil || !contained(root, target) {
				return errors.New("context contains escaping symlink")
			}
		}
		return nil
	})
	return contextDir, dockerfile, e
}
