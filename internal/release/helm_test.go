package release

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/xuzuxing/podry/internal/chart"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/kube"
	"helm.sh/helm/v3/pkg/kube/fake"
	helmrelease "helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage"
	"helm.sh/helm/v3/pkg/storage/driver"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/client-go/rest"
)

type helmFixture struct {
	input   Input
	release *helmrelease.Release
	objects map[string]*unstructured.Unstructured
	pods    []unstructured.Unstructured
	writes  atomic.Int32
}

func TestHelmReusesDiscoveryWithinStepAndRefreshesNextStep(t *testing.T) {
	var coreRequests, groupRequests, writes atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet {
			writes.Add(1)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var value any
		switch r.URL.Path {
		case "/api":
			coreRequests.Add(1)
			value = metav1.APIVersions{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "APIVersions"}, Versions: []string{"v1"}}
		case "/apis":
			groupRequests.Add(1)
			version := metav1.GroupVersionForDiscovery{GroupVersion: "apps/v1", Version: "v1"}
			value = metav1.APIGroupList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "APIGroupList"}, Groups: []metav1.APIGroup{{Name: "apps", Versions: []metav1.GroupVersionForDiscovery{version}, PreferredVersion: version}}}
		case "/api/v1":
			value = metav1.APIResourceList{GroupVersion: "v1", APIResources: []metav1.APIResource{{Name: "services", Kind: "Service", Namespaced: true}}}
		case "/apis/apps/v1":
			value = metav1.APIResourceList{GroupVersion: "apps/v1", APIResources: []metav1.APIResource{{Name: "deployments", Kind: "Deployment", Namespaced: true}}}
		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(value)
	}))
	defer api.Close()
	manifest := "apiVersion: v1\nkind: Service\nmetadata:\n  name: demo\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: demo\n"
	for step := int32(1); step <= 2; step++ {
		g, err := newGetter(&rest.Config{Host: api.URL}, "demo")
		if err != nil {
			t.Fatal(err)
		}
		client := kube.New(g)
		for build := 0; build < 3; build++ {
			resources, err := client.Build(strings.NewReader(manifest), false)
			if err != nil || len(resources) != 2 {
				t.Fatalf("step %d build %d: resources=%d err=%v", step, build, len(resources), err)
			}
		}
		if coreRequests.Load() != step || groupRequests.Load() != step || writes.Load() != 0 {
			t.Fatalf("discovery cache boundary: core=%d groups=%d writes=%d step=%d", coreRequests.Load(), groupRequests.Load(), writes.Load(), step)
		}
	}
}

func newHelmFixture(t *testing.T, kind string) *helmFixture {
	return newHelmFixtureID(t, kind, "11111111-1111-1111-1111-111111111111")
}
func newHelmFixtureID(t *testing.T, kind, id string) *helmFixture {
	t.Helper()
	p := Plan{SchemaVersion: 1, AppID: "app-id", BindingID: "binding-id", DeploymentID: id, Target: Target{ClusterID: "cluster-id", Namespace: "demo", ReleaseName: "demo"}, ImageRef: "registry.example.test/demo@sha256:" + strings.Repeat("b", 64), WorkloadKind: kind}
	var err error
	p.Chart, err = chart.Render(chart.Input{AppID: p.AppID, BindingID: p.BindingID, DeploymentID: p.DeploymentID, Namespace: p.Target.Namespace, ReleaseName: p.Target.ReleaseName, WorkloadKind: kind, ImageRef: p.ImageRef, Values: map[string]any{}, SecretKeys: []string{"PASSWORD"}})
	if err != nil {
		t.Fatal(err)
	}
	f := &helmFixture{input: Input{Plan: p, Hash: strings.Repeat("a", 64)}, objects: map[string]*unstructured.Unstructured{}}
	f.release = &helmrelease.Release{Name: p.Target.ReleaseName, Namespace: p.Target.Namespace, Version: 7, Config: p.Chart.Values, Info: &helmrelease.Info{Description: marker(f.input), Status: helmrelease.StatusDeployed}}
	f.release.Config["podry"].(map[string]any)["snapshotSHA256"] = f.input.Hash
	decoder := yaml.NewYAMLOrJSONDecoder(strings.NewReader(p.Chart.Manifest), 4096)
	for {
		var o unstructured.Unstructured
		err := decoder.Decode(&o)
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if len(o.Object) == 0 {
			continue
		}
		o.SetUID(types.UID("uid-" + o.GetName()))
		o.SetGeneration(2)
		if o.GetKind() == "Deployment" {
			o.Object["status"] = map[string]any{"observedGeneration": int64(2), "replicas": int64(1), "updatedReplicas": int64(1), "readyReplicas": int64(1), "availableReplicas": int64(1), "conditions": []any{map[string]any{"type": "Available", "status": "True"}}}
		} else if o.GetKind() == "Job" {
			o.Object["status"] = map[string]any{"succeeded": int64(1), "conditions": []any{map[string]any{"type": "Complete", "status": "True"}}}
			pod := unstructured.Unstructured{Object: map[string]any{"apiVersion": "v1", "kind": "Pod", "status": map[string]any{"phase": "Succeeded"}, "spec": map[string]any{"containers": []any{map[string]any{"name": "app", "image": p.ImageRef}}}}}
			pod.SetNamespace(p.Target.Namespace)
			pod.SetUID("successful-pod-uid")
			pod.SetLabels(o.GetLabels())
			controller := true
			pod.SetOwnerReferences([]metav1.OwnerReference{{APIVersion: "batch/v1", Kind: "Job", Name: o.GetName(), UID: o.GetUID(), Controller: &controller}})
			f.pods = append(f.pods, pod)
		}
		path, _ := resourcePath(Resource{APIVersion: o.GetAPIVersion(), Kind: o.GetKind(), Namespace: o.GetNamespace(), Name: o.GetName()})
		f.objects[path] = &o
	}
	api := httptest.NewTLSServer(http.HandlerFunc(f.serve))
	t.Cleanup(api.Close)
	f.input.Cluster = map[string]any{"apiServer": api.URL, "token": "release-fixture-token", "insecureSkipTLSVerify": true}
	f.input.Cluster["certificateAuthorityData"] = base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: api.Certificate().Raw}))
	return f
}
func (f *helmFixture) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Header.Get("Authorization") != "Bearer release-fixture-token" {
		w.WriteHeader(401)
		return
	}
	if r.Method != "GET" {
		f.writes.Add(1)
		w.WriteHeader(405)
		return
	}
	if r.URL.Path == "/api/v1/namespaces/demo/secrets" {
		items := []corev1.Secret{}
		if f.release != nil {
			raw, _ := json.Marshal(f.release)
			var compressed bytes.Buffer
			zip := gzip.NewWriter(&compressed)
			_, _ = zip.Write(raw)
			_ = zip.Close()
			items = append(items, corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "sh.helm.release.v1.demo.v7", Namespace: "demo", Labels: map[string]string{"owner": "helm", "name": "demo", "status": "deployed", "version": "7"}}, Data: map[string][]byte{"release": []byte(base64.StdEncoding.EncodeToString(compressed.Bytes()))}, Type: "helm.sh/release.v1"})
		}
		_ = json.NewEncoder(w).Encode(corev1.SecretList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "SecretList"}, Items: items})
		return
	}
	if r.URL.Path == "/api/v1/namespaces/demo/pods" {
		_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": "v1", "kind": "PodList", "items": f.pods})
		return
	}
	if o := f.objects[r.URL.Path]; o != nil {
		_ = json.NewEncoder(w).Encode(o)
		return
	}
	w.WriteHeader(404)
	_ = json.NewEncoder(w).Encode(map[string]any{"kind": "Status", "apiVersion": "v1", "status": "Failure", "reason": "NotFound", "code": 404})
}
func (f *helmFixture) workload() *unstructured.Unstructured {
	for _, o := range f.objects {
		if o.GetKind() == f.input.Plan.WorkloadKind {
			return o
		}
	}
	return nil
}

func TestHelmObservesExecutionIdentityAndWorkloadConditions(t *testing.T) {
	tests := []struct {
		name, kind, state, code string
		change                  func(*helmFixture)
	}{
		{"deployment-ready", "Deployment", "succeeded", "", func(*helmFixture) {}},
		{"generation-not-observed", "Deployment", "observing", "", func(f *helmFixture) {
			_ = unstructured.SetNestedField(f.workload().Object, int64(1), "status", "observedGeneration")
		}},
		{"old-replicas-remain", "Deployment", "observing", "", func(f *helmFixture) {
			_ = unstructured.SetNestedField(f.workload().Object, int64(2), "status", "replicas")
		}},
		{"job-complete-successful-pod", "Job", "succeeded", "", func(*helmFixture) {}},
		{"job-running", "Job", "observing", "", func(f *helmFixture) { f.workload().Object["status"] = map[string]any{"active": int64(1)} }},
		{"job-complete-no-pod-evidence", "Job", "observing", "", func(f *helmFixture) { f.pods = nil }},
		{"job-complete-foreign-owner", "Job", "observing", "", func(f *helmFixture) {
			owners := f.pods[0].GetOwnerReferences()
			owners[0].UID = "different-job"
			f.pods[0].SetOwnerReferences(owners)
		}},
		{"job-failed", "Job", "failed", "release_workload_failed", func(f *helmFixture) {
			f.workload().Object["status"] = map[string]any{"failed": int64(1), "conditions": []any{map[string]any{"type": "Failed", "status": "True"}}}
		}},
		{"helm-pending", "Deployment", "unknown", "release_outcome_unknown", func(f *helmFixture) { f.release.Info.Status = helmrelease.StatusPendingUpgrade }},
		{"helm-failed-is-ambiguous", "Deployment", "unknown", "release_outcome_unknown", func(f *helmFixture) { f.release.Info.Status = helmrelease.StatusFailed }},
		{"helm-absent", "Deployment", "unknown", "release_outcome_unknown", func(f *helmFixture) { f.release = nil }},
		{"different-execution", "Deployment", "unknown", "release_outcome_unknown", func(f *helmFixture) { f.release.Config["podry"].(map[string]any)["deploymentId"] = "another-execution" }},
		{"revision-changed", "Deployment", "unknown", "release_revision_conflict", func(f *helmFixture) { v := int32(6); f.input.Revision = &v }},
		{"resource-replaced", "Deployment", "unknown", "release_resource_identity_conflict", func(f *helmFixture) {
			o := f.workload()
			f.input.Known = []Resource{{APIVersion: o.GetAPIVersion(), Kind: o.GetKind(), Namespace: o.GetNamespace(), Name: o.GetName(), UID: "old-uid"}}
		}},
		{"foreign-resource", "Deployment", "unknown", "release_resource_identity_conflict", func(f *helmFixture) { f.workload().SetLabels(map[string]string{"podry.io/deployment-id": "foreign"}) }},
		{"image-drift", "Deployment", "unknown", "release_resource_identity_conflict", func(f *helmFixture) {
			_ = unstructured.SetNestedSlice(f.workload().Object, []any{map[string]any{"name": "app", "image": "untrusted:latest"}}, "spec", "template", "spec", "containers")
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			f := newHelmFixture(t, test.kind)
			test.change(f)
			o, err := NewHelm().Observe(context.Background(), f.input)
			if err != nil || o.State != test.state || o.Code != test.code {
				t.Fatalf("state=%s code=%s err=%v", o.State, o.Code, err)
			}
			if f.writes.Load() != 0 {
				t.Fatal("recovery wrote to Kubernetes")
			}
			if test.name == "helm-pending" && len(o.Resources) != 2 {
				t.Fatal("in-flight resource identities lost")
			}
			if test.name == "revision-changed" && (o.Revision == nil || *o.Revision != *f.input.Revision) {
				t.Fatal("conflicting revision replaced the recovery baseline")
			}
		})
	}
}
func TestHelmRefusesForeignReleaseWithoutWrites(t *testing.T) {
	f := newHelmFixture(t, "Deployment")
	f.release.Info.Description = "foreign"
	f.release.Config = map[string]any{}
	o, err := NewHelm().Submit(context.Background(), f.input)
	if err != nil || o.State != "failed" || o.Code != "release_target_conflict" || f.writes.Load() != 0 {
		t.Fatalf("unsafe foreign adoption: %+v err=%v", o, err)
	}
}

func TestHelmObservesTypedPodListWithoutPerItemTypeMeta(t *testing.T) {
	for _, typed := range []bool{true, false} {
		t.Run(map[bool]string{true: "inferred-pod", false: "explicit-foreign-kind"}[typed], func(t *testing.T) {
			f := newHelmFixture(t, "Job")
			want := "succeeded"
			if typed {
				f.pods[0].SetAPIVersion("")
				f.pods[0].SetKind("")
			} else {
				f.pods[0].SetKind("Job")
				want = "observing"
			}
			o, err := NewHelm().Observe(context.Background(), f.input)
			if err != nil || o.State != want || f.writes.Load() != 0 {
				t.Fatalf("typed PodList observation=%+v err=%v", o, err)
			}
		})
	}
}

type countingTransport struct{ count *atomic.Int32 }

func (t countingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	t.count.Add(1)
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}}, nil
}
func TestHelmTransportStopsWritesAfterContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var calls atomic.Int32
	transport := boundTransport{ctx, countingTransport{&calls}}
	r, _ := http.NewRequest(http.MethodPost, "https://unused.example.test", nil)
	if _, err := transport.RoundTrip(r); err == nil || calls.Load() != 0 {
		t.Fatal("cancelled action started a late request")
	}
}

// Model an unavailable schema endpoint while exercising SDK render and storage.
type schemaUnavailableKubeClient struct {
	*fake.PrintingKubeClient
	builds int
}

func (c *schemaUnavailableKubeClient) Build(r io.Reader, validate bool) (kube.ResourceList, error) {
	c.builds++
	if validate {
		return nil, errors.New("cluster OpenAPI download unavailable")
	}
	return c.PrintingKubeClient.Build(r, false)
}

func TestHelmSDKInstallAndUpgradeUseArchivedChartAndResolvedValues(t *testing.T) {
	// Exercise the actual SDK action/render/storage paths with an in-memory Helm
	// driver and a fake Kubernetes writer. Live resources still come from TLS HTTP.
	for _, kind := range []string{"Deployment", "Job"} {
		t.Run(kind, func(t *testing.T) {
			writer := &schemaUnavailableKubeClient{PrintingKubeClient: &fake.PrintingKubeClient{Out: io.Discard}}
			cfg := &action.Configuration{Releases: storage.Init(driver.NewMemory()), KubeClient: writer, Capabilities: chartutil.DefaultCapabilities, Log: func(string, ...interface{}) {}}
			h := &Helm{configure: func(context.Context, Input) (*action.Configuration, error) { return cfg, nil }}
			for i, id := range []string{"11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"} {
				f := newHelmFixtureID(t, kind, id)
				raw, _ := json.Marshal(f.input.Plan.Chart.Values)
				if err := json.Unmarshal(raw, &f.input.Values); err != nil {
					t.Fatal(err)
				}
				reserved := f.input.Values["podry"].(map[string]any)
				reserved["secretData"] = map[string]string{"PASSWORD": base64.StdEncoding.EncodeToString([]byte("runtime-only-secret"))}
				o, err := h.Submit(context.Background(), f.input)
				if err != nil || o.State != "succeeded" || o.Revision == nil || *o.Revision != int32(i+1) {
					t.Fatalf("SDK submit state=%s code=%s revision=%v err=%v", o.State, o.Code, o.Revision, err)
				}
				r, err := cfg.Releases.Last("demo")
				if err != nil || !ownedRelease(r, f.input) || !strings.Contains(r.Manifest, base64.StdEncoding.EncodeToString([]byte("runtime-only-secret"))) || strings.Contains(r.Manifest, base64.StdEncoding.EncodeToString([]byte("<redacted>"))) {
					t.Fatal("SDK submitted redacted values or lost immutable identity", err)
				}
				if r.Chart.Metadata.Version != f.input.Plan.Chart.Version {
					t.Fatal("SDK ignored archived chart")
				}
			}
			if writer.builds < 2 {
				t.Fatal("SDK did not build submitted resources")
			}
		})
	}
}

type failingUpgradeKubeClient struct {
	*fake.PrintingKubeClient
	updates int
}

func (c *failingUpgradeKubeClient) Update(_, _ kube.ResourceList, _ bool) (*kube.Result, error) {
	c.updates++
	return &kube.Result{}, errors.New("rendered Secret contains sensitive-upgrade-fixture")
}

func TestHelmFailedUpgradeDiagnosticsAndReplayRemainReadOnly(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	writer := &failingUpgradeKubeClient{PrintingKubeClient: &fake.PrintingKubeClient{Out: io.Discard}}
	cfg := &action.Configuration{Releases: storage.Init(driver.NewMemory()), KubeClient: writer,
		Capabilities: chartutil.DefaultCapabilities, Log: func(string, ...interface{}) {}}
	h := &Helm{configure: func(context.Context, Input) (*action.Configuration, error) { return cfg, nil }}
	var upgrade Input
	for i, id := range []string{"11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"} {
		f := newHelmFixtureID(t, "Deployment", id)
		raw, _ := json.Marshal(f.input.Plan.Chart.Values)
		if err := json.Unmarshal(raw, &f.input.Values); err != nil {
			t.Fatal(err)
		}
		o, err := h.Submit(context.Background(), f.input)
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 && o.State != "succeeded" {
			t.Fatal("baseline install failed")
		}
		if i == 1 && (o.State != "unknown" || o.Code != "release_outcome_unknown") {
			t.Fatal("failed upgrade was incorrectly settled")
		}
		upgrade = f.input
	}
	if strings.Contains(output.String(), "sensitive-upgrade-fixture") {
		t.Fatal("submission diagnostics exposed raw Helm error contents")
	}
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	var record map[string]any
	if err := json.Unmarshal([]byte(lines[len(lines)-1]), &record); err != nil {
		t.Fatal(err)
	}
	if record["operation"] != "upgrade" || record["phase"] != "observe" || record["action_error"] != "error" || record["state"] != "unknown" {
		t.Fatalf("missing upgrade diagnostic classification: %v", record)
	}
	// A retry of this execution observes its existing failed/pending revision.
	// It must not invoke Update again, even though the public state is unknown.
	if _, err := h.Submit(context.Background(), upgrade); err != nil {
		t.Fatal(err)
	}
	history, err := cfg.Releases.History(upgrade.Plan.Target.ReleaseName)
	if err != nil || len(history) != 2 || writer.updates != 1 {
		t.Fatal("unknown upgrade was submitted again", err)
	}
}
