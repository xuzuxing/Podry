package application

import "testing"

func TestVersionedIngressValues(t *testing.T) {
	for _, tc := range []struct {
		name, version, kind string
		ingress             map[string]any
		invalid             bool
	}{
		{"legacy HTTP", "1.0.0", "Deployment", map[string]any{"enabled": true, "host": "app.podry.dev"}, false},
		{"TLS", "1.1.0", "Deployment", map[string]any{"enabled": true, "host": "app.podry.dev", "className": "traefik", "tlsSecretName": "app-tls", "clusterIssuer": "podry-test-ca"}, false},
		{"existing certificate", "1.1.0", "Deployment", map[string]any{"enabled": true, "host": "app.podry.dev", "tlsSecretName": "app-tls"}, false},
		{"legacy rejects TLS", "1.0.0", "Deployment", map[string]any{"enabled": true, "host": "app.podry.dev", "tlsSecretName": "app-tls"}, true},
		{"unknown version", "1.2.0", "Deployment", map[string]any{"enabled": true, "host": "app.podry.dev"}, true},
		{"issuer needs secret", "1.1.0", "Deployment", map[string]any{"enabled": true, "host": "app.podry.dev", "clusterIssuer": "podry-test-ca"}, true},
		{"secret path", "1.1.0", "Deployment", map[string]any{"tlsSecretName": "../other"}, true},
		{"wrong class type", "1.1.0", "Deployment", map[string]any{"className": true}, true},
		{"unknown annotations", "1.1.0", "Deployment", map[string]any{"annotations": map[string]any{"example": "x"}}, true},
		{"wildcard host", "1.1.0", "Deployment", map[string]any{"enabled": true, "host": "*.podry.dev"}, true},
		{"Job rejects ingress", "1.1.0", "Job", map[string]any{"enabled": true, "host": "app.podry.dev"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config := Config{ChartConfig: &ChartConfig{WorkloadKind: tc.kind, ChartVersion: tc.version}, DeployValues: map[string]any{"service": map[string]any{"enabled": true}, "ingress": tc.ingress}}
			if tc.kind == "Job" {
				delete(config.DeployValues, "service")
			}
			if err := validateReleaseValues(config); (err != nil) != tc.invalid {
				t.Fatalf("validation error = %v, invalid = %v", err, tc.invalid)
			}
		})
	}
	legacy := Config{ChartConfig: &ChartConfig{WorkloadKind: "Deployment", ChartVersion: "1.0.0"}, DeployValues: map[string]any{"service": map[string]any{"enabled": true}, "ingress": map[string]any{"enabled": true, "host": "app.podry.dev"}}}
	if _, err := effectiveConfig(legacy, map[string]any{"ingress": map[string]any{"tlsSecretName": "app-tls"}}); err == nil {
		t.Fatal("environment override bypassed chart version validation")
	}
}
