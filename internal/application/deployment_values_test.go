package application

import (
	"encoding/json"
	"testing"
)

func TestDeploymentCapabilitiesAdmission(t *testing.T) {
	for _, tc := range []struct {
		name, values string
		invalid      bool
	}{
		{"parameters", `{"command":["/app"],"args":["serve",""]}`, false},
		{"probes", `{"readinessProbe":{"httpGet":{"path":"/ping","port":8080},"successThreshold":2},"startupProbe":{"tcpSocket":{"port":8080},"failureThreshold":30}}`, false},
		{"configuration", `{"configFiles":{"app.yaml":"mode: demo"},"volumes":[{"name":"data","mountPath":"/data","readOnly":false,"persistentVolumeClaim":{"claimName":"data"}}]}`, false},
		{"secret readonly", `{"volumes":[{"name":"tls","mountPath":"/tls","readOnly":true,"secret":{"secretName":"tls"}}]}`, false},
		{"hostPath", `{"volumes":[{"name":"root","mountPath":"/root","readOnly":true,"hostPath":{"path":"/"}}]}`, true},
		{"writable secret", `{"volumes":[{"name":"tls","mountPath":"/tls","readOnly":false,"secret":{"secretName":"tls"}}]}`, true},
		{"token mount", `{"configMountPath":"/var/run/secrets/kubernetes.io"}`, true},
		{"overlap", `{"configFiles":{"app.yaml":"demo"},"volumes":[{"name":"data","mountPath":"/etc/podry","readOnly":true,"configMap":{"name":"data"}}]}`, true},
		{"two sources", `{"volumes":[{"name":"data","mountPath":"/data","readOnly":true,"configMap":{"name":"data"},"secret":{"secretName":"tls"}}]}`, true},
		{"two handlers", `{"readinessProbe":{"httpGet":{"path":"/ping","port":8080},"tcpSocket":{"port":8080}}}`, true},
		{"named port", `{"readinessProbe":{"tcpSocket":{"port":"http"}}}`, true},
		{"exec probe", `{"readinessProbe":{"exec":{"command":["true"]}}}`, true},
		{"liveness threshold", `{"livenessProbe":{"tcpSocket":{"port":8080},"successThreshold":2}}`, true},
		{"secret config filename", `{"configFiles":{"private-key.pem":"hidden"}}`, true},
		{"traversal filename", `{"configFiles":{"../config":"hidden"}}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var values map[string]any
			if err := json.Unmarshal([]byte(tc.values), &values); err != nil {
				t.Fatal(err)
			}
			c := Config{ChartConfig: &ChartConfig{WorkloadKind: "Deployment", ChartVersion: "1.2.0"}, DeployValues: values}
			if err := validateReleaseValues(c); (err != nil) != tc.invalid {
				t.Fatalf("invalid=%v err=%v", tc.invalid, err)
			}
			if !tc.invalid {
				for _, version := range []string{"1.0.0", "1.1.0"} {
					c.ChartConfig.ChartVersion = version
					if _, err := effectiveConfig(c, values); err == nil {
						t.Fatalf("old chart %s accepted new values", version)
					}
				}
			}
		})
	}
	c := Config{ChartConfig: &ChartConfig{WorkloadKind: "Job", ChartVersion: "1.2.0"}, DeployValues: map[string]any{"startupProbe": map[string]any{}}}
	if err := validateReleaseValues(c); err == nil {
		t.Fatal("Job accepted a probe")
	}
}
