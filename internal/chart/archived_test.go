package chart_test

import (
	"bytes"
	"reflect"
	"testing"

	"github.com/xuzuxing/podry/internal/chart"
)

func TestArchivedChartPreservesPackageAndRenewsIdentities(t *testing.T) {
	in := chart.Input{AppID: "app", BindingID: "binding", DeploymentID: "old", Namespace: "demo", ReleaseName: "demo-job", WorkloadKind: "Job", ImageRef: "registry/demo@sha256:digest", Values: map[string]any{"env": map[string]any{"MODE": "historical"}}, SecretKeys: []string{"DATABASE_URL"}}
	old, err := chart.Render(in)
	if err != nil {
		t.Fatal(err)
	}
	in.DeploymentID = "new"
	in.Values = old.Values
	next, err := chart.RenderArchived(in, old)
	if err != nil {
		t.Fatal(err)
	}
	a, b := old.Values["podry"].(map[string]any), next.Values["podry"].(map[string]any)
	if !bytes.Equal(old.Package, next.Package) || next.SHA256 != old.SHA256 || !reflect.DeepEqual(old.Values["env"], next.Values["env"]) || a["workloadName"] == b["workloadName"] || a["secretName"] == b["secretName"] || a["deploymentId"] != "old" || b["deploymentId"] != "new" {
		t.Fatal("historical package/values lost or source identities reused/mutated")
	}
	for _, mutate := range []struct {
		name string
		fn   func(*chart.Result)
	}{
		{"missing", func(r *chart.Result) { r.Package = nil }},
		{"corrupt", func(r *chart.Result) { r.Package = append([]byte("broken"), r.Package...) }},
		{"unsupported", func(r *chart.Result) { r.Version = "2.0.0" }},
		{"unapproved", func(r *chart.Result) { r.Package = []byte("other"); r.SHA256 = chart.Hash(r.Package) }},
	} {
		t.Run(mutate.name, func(t *testing.T) {
			r := old
			mutate.fn(&r)
			if _, err := chart.RenderArchived(in, r); err == nil {
				t.Fatal("unavailable historical package silently replaced")
			}
		})
	}
}
