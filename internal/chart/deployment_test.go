package chart

import (
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	"sigs.k8s.io/yaml"
)

func TestApplicationChartCapabilities(t *testing.T) {
	in := Input{Version: "1.2.0", AppID: "app", BindingID: "binding", DeploymentID: "execution", Namespace: "demo", ReleaseName: "demo", WorkloadKind: "Deployment", ImageRef: "registry.example/demo@sha256:abc", PullRegistry: "registry.example", Values: map[string]any{
		"command": []any{"/app"}, "args": []any{"serve"},
		"readinessProbe": map[string]any{"httpGet": map[string]any{"path": "/ping", "port": 8080}},
		"configFiles":    map[string]any{"app.yaml": "listen: 8080"},
		"volumes":        []any{map[string]any{"name": "data", "mountPath": "/data", "readOnly": false, "persistentVolumeClaim": map[string]any{"claimName": "data"}}},
	}}
	out, err := Render(in)
	if err != nil {
		t.Fatal(err)
	}
	var workload appsv1.Deployment
	for _, doc := range strings.Split(out.Manifest, "---\n") {
		if strings.Contains(doc, "kind: Deployment\n") {
			if err = yaml.UnmarshalStrict([]byte(doc), &workload); err != nil {
				t.Fatal(err)
			}
		}
	}
	pod := workload.Spec.Template.Spec
	if len(pod.Containers) != 1 || len(pod.Volumes) != 2 || len(pod.ImagePullSecrets) != 1 {
		t.Fatalf("missing application resources: %+v", pod)
	}
	c := pod.Containers[0]
	if c.ReadinessProbe == nil || c.ReadinessProbe.HTTPGet.Path != "/ping" || len(c.Command) != 1 || len(c.Args) != 1 || len(c.VolumeMounts) != 2 {
		t.Fatal("application capabilities not rendered")
	}
	if !strings.Contains(out.Manifest, "kind: ConfigMap") || !strings.Contains(out.Manifest, "kubernetes.io/dockerconfigjson") || !strings.Contains(out.Manifest, "PHJlZGFjdGVkPg==") {
		t.Fatal("missing configuration or redacted pull Secret")
	}
	in.DeploymentID = "rollback"
	again, err := RenderArchived(in, out)
	if err != nil || again.SHA256 != out.SHA256 || !strings.Contains(again.Manifest, "demo-p-rollback") {
		t.Fatalf("historical rendering: %v", err)
	}
}
