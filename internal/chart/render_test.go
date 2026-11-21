package chart

import (
	"bytes"
	"strings"
	"testing"

	"helm.sh/helm/v3/pkg/chart/loader"
	"sigs.k8s.io/yaml"
)

func TestBuiltinChartRenderingAndFrozenArchive(t *testing.T) {
	in := Input{AppID: "11111111-1111-4111-8111-111111111111", BindingID: "22222222-2222-4222-8222-222222222222", DeploymentID: "33333333-3333-4333-8333-333333333333", Namespace: "demo", ReleaseName: "demo", WorkloadKind: "Deployment", ImageRef: "registry.test/demo@sha256:" + strings.Repeat("a", 64), Values: map[string]any{"replicaCount": float64(0), "env": map[string]any{"LITERAL": "{{ .Release.Name }}"}}, SecretKeys: []string{"DATABASE_URL"}}
	one, e := Render(in)
	if e != nil {
		t.Fatal(e)
	}
	two, e := Render(in)
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal(one.Package, two.Package) || one.Manifest != two.Manifest {
		t.Fatal("chart archive/render is not deterministic")
	}
	ch, e := loader.LoadArchive(bytes.NewReader(one.Package))
	if e != nil {
		t.Fatal("stored chart is not a Helm archive", e)
	}
	if ch.Name() != "podry" || ch.Metadata.Version != "1.0.0" || len(ch.Dependencies()) != 0 {
		t.Fatal("unexpected chart identity/dependencies")
	}
	if !strings.Contains(one.Manifest, "replicas: 0") || !strings.Contains(one.Manifest, in.ImageRef) || !strings.Contains(one.Manifest, "{{ .Release.Name }}") {
		t.Fatal("fixed digest, zero replicas or literal env changed")
	}
	for _, document := range strings.Split(one.Manifest, "---\n") {
		if strings.TrimSpace(document) == "" {
			continue
		}
		var object map[string]any
		if e = yaml.UnmarshalStrict([]byte(document), &object); e != nil {
			t.Fatal("invalid rendered YAML", e)
		}
		if object["kind"] != "Deployment" && object["kind"] != "Secret" {
			t.Fatal("unexpected resource")
		}
	}
	t.Log("chart SHA-256:", one.SHA256)
}
