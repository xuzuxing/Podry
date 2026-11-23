package release

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/kube/fake"
	helmrelease "helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage"
	"helm.sh/helm/v3/pkg/storage/driver"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestRemovalConditionalDeletesReadOnlyObserveAndReinstall(t *testing.T) {
	for _, scenario := range []string{"success", "uid replaced", "finalizer", "pods remain", "incomplete inventory", "helm foreign"} {
		t.Run(scenario, func(t *testing.T) {
			f := newHelmFixture(t, "Deployment")
			refs, _ := Objects(f.input.Plan)
			for i := range refs {
				refs[i].UID = "uid-" + refs[i].Name
			}
			p := f.input.Plan
			p.Removal = &RemovalPlan{DeploymentID: p.DeploymentID, SnapshotSHA256: f.input.Hash, HelmRevision: 7, Resources: refs}
			p.DeploymentID = "33333333-3333-3333-3333-333333333333"
			in := Input{Plan: p, Hash: strings.Repeat("c", 64)}
			cfg := &action.Configuration{Releases: storage.Init(driver.NewMemory()), KubeClient: &fake.PrintingKubeClient{Out: io.Discard}, Capabilities: chartutil.DefaultCapabilities, Log: func(string, ...interface{}) {}}
			if scenario == "helm foreign" {
				f.release.Config["podry"].(map[string]any)["bindingId"] = "other"
			}
			if err := cfg.Releases.Create(f.release); err != nil {
				t.Fatal(err)
			}
			h := &Helm{configure: func(context.Context, Input) (*action.Configuration, error) { return cfg, nil }}
			deletes := 0
			for _, obj := range f.objects {
				obj.SetResourceVersion("10")
				if scenario == "uid replaced" {
					obj.SetUID("replaced")
				}
			}
			api := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				obj := f.objects[r.URL.Path]
				if r.Method == "DELETE" {
					deletes++
					var options metav1.DeleteOptions
					if err := json.NewDecoder(r.Body).Decode(&options); err != nil || options.Preconditions == nil || options.Preconditions.UID == nil || options.Preconditions.ResourceVersion == nil || *options.Preconditions.UID != obj.GetUID() || *options.Preconditions.ResourceVersion != "10" || options.PropagationPolicy == nil || *options.PropagationPolicy != metav1.DeletePropagationForeground {
						t.Error("deletion lost atomic identity preconditions")
					}
					if scenario != "finalizer" {
						delete(f.objects, r.URL.Path)
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"kind": "Status", "status": "Success"})
					return
				}
				if r.Method != "GET" {
					t.Error("unexpected write", r.Method)
					w.WriteHeader(405)
					return
				}
				if obj != nil {
					_ = json.NewEncoder(w).Encode(obj)
					return
				}
				if strings.HasSuffix(r.URL.Path, "/pods") {
					list := map[string]any{"apiVersion": "v1", "kind": "PodList", "items": []any{}}
					if scenario == "pods remain" {
						list["items"] = []any{map[string]any{"apiVersion": "v1", "kind": "Pod"}}
					}
					if scenario == "incomplete inventory" {
						delete(list, "items")
					}
					_ = json.NewEncoder(w).Encode(list)
					return
				}
				for _, resource := range []string{"replicationcontrollers", "serviceaccounts", "deployments", "replicasets", "statefulsets", "daemonsets", "jobs", "cronjobs", "ingresses"} {
					if strings.HasSuffix(r.URL.Path, "/"+resource) {
						items := []any{}
						for path, obj := range f.objects {
							if strings.HasPrefix(path, r.URL.Path+"/") {
								items = append(items, obj.Object)
							}
						}
						_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
						return
					}
				}
				w.WriteHeader(404)
			}))
			t.Cleanup(api.Close)
			in.Cluster = map[string]any{"apiServer": api.URL, "token": "fixture", "insecureSkipTLSVerify": true}
			before, _ := h.Observe(context.Background(), in)
			if before.State == "succeeded" || deletes != 0 {
				t.Fatal("observation mutated resources or declared live workload offline")
			}
			o, err := h.Submit(context.Background(), in)
			if scenario != "success" {
				if o.State == "succeeded" {
					t.Fatal("uncertain removal cleared target", scenario)
				}
				if (scenario == "uid replaced" || scenario == "helm foreign") && deletes != 0 {
					t.Fatal("deleted foreign identity")
				}
				return
			}
			if err != nil || o.State != "succeeded" || deletes != len(refs) {
				t.Fatalf("removal=%+v deletes=%d err=%v", o, deletes, err)
			}
			r, _ := cfg.Releases.Last("demo")
			if r.Info.Status != helmrelease.StatusUninstalled || len(r.Config) == 0 {
				t.Fatal("Helm history lost")
			}
			if _, err = h.Observe(context.Background(), in); err != nil || deletes != len(refs) {
				t.Fatal("reconcile replay mutated resources", err)
			}
			// The real Helm SDK must reuse the release name after confirmed offline.
			next := newHelmFixtureID(t, "Deployment", "44444444-4444-4444-4444-444444444444")
			raw, _ := json.Marshal(next.input.Plan.Chart.Values)
			_ = json.Unmarshal(raw, &next.input.Values)
			o, err = h.Submit(context.Background(), next.input)
			if err != nil || o.State != "succeeded" || o.Revision == nil || *o.Revision != 8 {
				t.Fatalf("reinstall=%+v err=%v", o, err)
			}
		})
	}
}

func TestMountPermissionCoverage(t *testing.T) {
	values := map[string]any{"volumes": []any{map[string]any{"secret": map[string]any{"secretName": "tls"}, "readOnly": true}, map[string]any{"persistentVolumeClaim": map[string]any{"claimName": "data"}, "readOnly": false}}}
	permissions := MountPermissions(values)
	seen := map[ReferencePermission]bool{}
	for _, p := range permissions {
		seen[p] = true
	}
	for _, p := range []ReferencePermission{{"core/secrets", "resource.view"}, {"core/secrets", "secret.reveal"}, {"core/persistentvolumeclaims", "resource.view"}, {"core/persistentvolumeclaims", "resource.write"}} {
		if !seen[p] {
			t.Fatal("missing mount permission", p)
		}
	}
}
