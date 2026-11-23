package integration_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/chart"
)

func TestIngressTLSVersionedPreviewAndConfirmation(t *testing.T) {
	f := setupRelease(t, "Deployment")
	f.apps.UseReleases(releaseReady{})
	path := "/api/apps/" + f.app
	cfg := decode[application.Config](t, f.c.f.call("GET", path+"/config", f.c.developer, nil, 200))
	cfg.DeployValues["ingress"] = map[string]any{"enabled": true, "host": "app.podry.dev", "className": "traefik", "tlsSecretName": "app-tls", "clusterIssuer": "podry-test-ca"}
	body := map[string]any{"expectedVersion": cfg.Version, "section": "base", "chartConfig": cfg.ChartConfig, "deployValues": cfg.DeployValues, "secretRefs": cfg.SecretRefs}
	f.c.f.call("PUT", path+"/config", f.c.developer, body, 422)
	cfg.ChartConfig.ChartVersion = "1.1.0"
	f.c.f.call("PUT", path+"/config", f.c.developer, body, 200)
	p := f.preview(t, 4)
	for _, expected := range []string{"kind: Ingress", "ingressClassName: \"traefik\"", "secretName: \"app-tls\"", "cert-manager.io/cluster-issuer: \"podry-test-ca\"", "app.podry.dev"} {
		if !strings.Contains(p.Diff.After, expected) {
			t.Fatalf("preview omitted %s", expected)
		}
	}
	f.confirm(t, p, "tls-release-confirm", 202)
	var raw []byte
	if err := f.c.f.pool.QueryRow(context.Background(), "SELECT snapshot FROM release_snapshots WHERE app_id=$1", f.app).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var plan struct {
		Chart chart.Result `json:"chart"`
	}
	if err := json.Unmarshal(raw, &plan); err != nil {
		t.Fatal(err)
	}
	if plan.Chart.Version != "1.1.0" || plan.Chart.SHA256 != chart.TLSPackageSHA256 || plan.Chart.Manifest != p.Diff.After || chart.Hash(plan.Chart.Package) != chart.TLSPackageSHA256 {
		t.Fatal("confirmation did not freeze the selected TLS chart and manifest")
	}
}
