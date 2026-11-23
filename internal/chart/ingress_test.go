package chart

import (
	"bytes"
	"strings"
	"testing"

	networkingv1 "k8s.io/api/networking/v1"
	"sigs.k8s.io/yaml"
)

func TestTLSIngressChartAndHistoricalVersions(t *testing.T) {
	in := Input{Version: "1.1.0", AppID: "app", BindingID: "binding", DeploymentID: "old", Namespace: "demo", ReleaseName: "demo", WorkloadKind: "Deployment", ImageRef: "registry/demo@sha256:digest", Values: map[string]any{"service": map[string]any{"enabled": true, "port": float64(80)}, "ingress": map[string]any{"enabled": true, "host": "app.podry.dev", "className": "traefik", "tlsSecretName": "app-tls", "clusterIssuer": "podry-test-ca"}}}
	out, err := Render(in)
	if err != nil {
		t.Fatal(err)
	}
	if out.Version != "1.1.0" || out.SHA256 != TLSPackageSHA256 {
		t.Fatal("wrong version/package")
	}
	var ingress networkingv1.Ingress
	for _, document := range strings.Split(out.Manifest, "---\n") {
		var value networkingv1.Ingress
		if strings.Contains(document, "kind: Ingress\n") {
			if err = yaml.UnmarshalStrict([]byte(document), &value); err != nil {
				t.Fatal(err)
			}
			ingress = value
		}
	}
	if ingress.Name != "demo" || ingress.Namespace != "demo" || ingress.Spec.IngressClassName == nil || *ingress.Spec.IngressClassName != "traefik" || ingress.Annotations["cert-manager.io/cluster-issuer"] != "podry-test-ca" || len(ingress.Spec.TLS) != 1 || ingress.Spec.TLS[0].SecretName != "app-tls" || len(ingress.Spec.TLS[0].Hosts) != 1 || ingress.Spec.TLS[0].Hosts[0] != "app.podry.dev" {
		t.Fatal("TLS/class/issuer not rendered")
	}
	if len(ingress.Spec.Rules) != 1 || ingress.Spec.Rules[0].Host != "app.podry.dev" || ingress.Spec.Rules[0].HTTP.Paths[0].Backend.Service.Name != "demo" || ingress.Spec.Rules[0].HTTP.Paths[0].Backend.Service.Port.Number != 80 {
		t.Fatal("ingress does not route to the release Service")
	}
	in.DeploymentID = "new"
	archived, err := RenderArchived(in, out)
	if err != nil || !bytes.Equal(out.Package, archived.Package) || !strings.Contains(archived.Manifest, "new") {
		t.Fatalf("TLS archive could not be reused: %v", err)
	}
	in.Version = "1.0.0"
	if _, err = RenderArchived(in, out); err == nil {
		t.Fatal("archived version mismatch accepted")
	}
	legacy, err := Render(Input{Version: "1.0.0", WorkloadKind: "Deployment", ReleaseName: "demo", Namespace: "demo", Values: map[string]any{}})
	if err != nil || legacy.SHA256 != PackageSHA256 || legacy.Version != "1.0.0" {
		t.Fatalf("legacy package changed: %v", err)
	}
	in.Version = "9.0.0"
	if _, err = Render(in); err == nil {
		t.Fatal("unknown version fell back to a built-in chart")
	}
}
