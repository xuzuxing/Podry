// Package chart renders the versioned built-in chart without a Kubernetes client.
package chart

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"slices"
	"strings"

	helmchart "helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/engine"
)

//go:embed charts/podry/Chart.yaml charts/podry/values.yaml charts/podry/templates/*
var source embed.FS

// Chart content changes require a new version and an explicitly reviewed hash.
const PackageSHA256 = "ec64a72850fb0eba6408e24703ba31331f9e34172a5163b58b2badb469452228"

type Input struct {
	AppID, BindingID, DeploymentID, Namespace, ReleaseName, WorkloadKind, ImageRef string
	Values                                                                         map[string]any
	SecretKeys                                                                     []string
}
type Result struct {
	Name           string         `json:"name"`
	Version        string         `json:"version"`
	SHA256         string         `json:"sha256"`
	Package        []byte         `json:"package"`
	Values         map[string]any `json:"values"`
	Manifest       string         `json:"manifest"`
	ManifestSHA256 string         `json:"manifestSha256"`
}

func Hash(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }

func Render(in Input) (Result, error) {
	var out Result
	if in.WorkloadKind != "Deployment" && in.WorkloadKind != "Job" {
		return out, fmt.Errorf("unsupported workload")
	}
	var files []*loader.BufferedFile
	var archive bytes.Buffer
	zip := gzip.NewWriter(&archive)
	tarball := tar.NewWriter(zip)
	err := fs.WalkDir(source, "charts/podry", func(path string, d fs.DirEntry, e error) error {
		if e != nil || d.IsDir() {
			return e
		}
		data, e := source.ReadFile(path)
		if e != nil {
			return e
		}
		name := strings.TrimPrefix(path, "charts/podry/")
		files = append(files, &loader.BufferedFile{Name: name, Data: data})
		if e = tarball.WriteHeader(&tar.Header{Name: "podry/" + name, Mode: 0644, Size: int64(len(data))}); e != nil {
			return e
		}
		_, e = tarball.Write(data)
		return e
	})
	if err != nil {
		return out, err
	}
	if err = tarball.Close(); err != nil {
		return out, err
	}
	if err = zip.Close(); err != nil {
		return out, err
	}
	if Hash(archive.Bytes()) != PackageSHA256 {
		return out, fmt.Errorf("built-in chart checksum mismatch")
	}
	ch, err := loader.LoadFiles(files)
	if err != nil {
		return out, err
	}
	return render(in, ch, archive.Bytes())
}

// RenderArchived uses the exact approved historical package. Missing, altered or
// unsupported packages fail instead of falling back to the current built-in Chart.
func RenderArchived(in Input, archived Result) (Result, error) {
	if archived.Name != "podry" || archived.Version != "1.0.0" || archived.SHA256 != PackageSHA256 || Hash(archived.Package) != archived.SHA256 {
		return Result{}, fmt.Errorf("historical chart unavailable")
	}
	ch, err := loader.LoadArchive(bytes.NewReader(archived.Package))
	if err != nil || ch.Name() != archived.Name || ch.Metadata.Version != archived.Version {
		return Result{}, fmt.Errorf("historical chart invalid")
	}
	return render(in, ch, archived.Package)
}

func render(in Input, ch *helmchart.Chart, archive []byte) (Result, error) {
	var out Result
	if in.WorkloadKind != "Deployment" && in.WorkloadKind != "Job" {
		return out, fmt.Errorf("unsupported workload")
	}
	// Clone caller values; only platform-owned fields can supply image or identity.
	raw, err := json.Marshal(in.Values)
	if err != nil {
		return out, err
	}
	values := map[string]any{}
	if err = json.Unmarshal(raw, &values); err != nil {
		return out, err
	}
	workload := in.ReleaseName
	prefix := in.ReleaseName
	if len(prefix) > 15 {
		prefix = prefix[:15]
	}
	suffix := strings.ReplaceAll(in.DeploymentID, "-", "")
	if in.WorkloadKind == "Job" {
		workload = prefix + "-" + suffix
	}
	secretData := map[string]string{}
	for _, key := range in.SecretKeys {
		secretData[key] = base64.StdEncoding.EncodeToString([]byte("<redacted>"))
	}
	values["podry"] = map[string]any{"appId": in.AppID, "bindingId": in.BindingID, "deploymentId": in.DeploymentID, "workloadKind": in.WorkloadKind, "workloadName": workload, "secretName": prefix + "-s-" + suffix, "imageRef": in.ImageRef, "secretKeys": in.SecretKeys, "secretData": secretData}
	rendered, err := chartutil.ToRenderValues(ch, values, chartutil.ReleaseOptions{Name: in.ReleaseName, Namespace: in.Namespace, Revision: 1, IsInstall: true}, nil)
	if err != nil {
		return out, err
	}
	// No REST config, DNS lookups, user templates or hooks are accepted.
	manifests, err := (engine.Engine{Strict: true}).Render(ch, rendered)
	if err != nil {
		return out, err
	}
	keys := make([]string, 0, len(manifests))
	for k := range manifests {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	var manifest strings.Builder
	for _, k := range keys {
		if text := strings.TrimSpace(manifests[k]); text != "" {
			manifest.WriteString("---\n")
			manifest.WriteString(text)
			manifest.WriteByte('\n')
		}
	}
	merged, ok := rendered["Values"].(chartutil.Values)
	if !ok {
		return out, fmt.Errorf("invalid chart values")
	}
	return Result{Name: ch.Name(), Version: ch.Metadata.Version, SHA256: Hash(archive), Package: archive, Values: map[string]any(merged), Manifest: manifest.String(), ManifestSHA256: Hash([]byte(manifest.String()))}, nil
}
