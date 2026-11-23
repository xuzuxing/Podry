package application

import (
	"path"
	"strings"

	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/platform"
)

var deploymentFields = []string{"command", "args", "readinessProbe", "livenessProbe", "startupProbe", "configFiles", "configMountPath", "volumes"}

func validMountPath(v any) bool {
	s, ok := v.(string)
	if !ok || len(s) > 1024 || !path.IsAbs(s) || path.Clean(s) != s || strings.ContainsAny(s, "\\\x00\r\n") {
		return false
	}
	for _, reserved := range []string{"/", "/proc", "/sys", "/dev", "/var/run/secrets"} {
		if s == reserved || strings.HasPrefix(s, reserved+"/") || strings.HasPrefix(reserved, s+"/") {
			return false
		}
	}
	return true
}

func validateDeploymentValue(kind, key string, value any) error {
	invalid := httpx.Invalid("部署配置字段、探针或挂载无效")
	switch key {
	case "command", "args":
		values, ok := value.([]any)
		if !ok || len(values) > 64 {
			return invalid
		}
		for _, v := range values {
			s, ok := v.(string)
			if !ok || len(s) > 4096 || strings.ContainsRune(s, '\x00') {
				return invalid
			}
		}
	case "readinessProbe", "livenessProbe", "startupProbe":
		m, ok := value.(map[string]any)
		if kind == "Job" || !ok || !fields(m, "httpGet", "tcpSocket", "initialDelaySeconds", "periodSeconds", "timeoutSeconds", "successThreshold", "failureThreshold") {
			return invalid
		}
		if len(m) == 0 {
			return nil
		}
		handlers := 0
		for k, v := range m {
			if k == "httpGet" || k == "tcpSocket" {
				handlers++
				h, ok := v.(map[string]any)
				if !ok || !integer(h["port"], 1, 65535) {
					return invalid
				}
				if k == "tcpSocket" {
					if !fields(h, "port") {
						return invalid
					}
				} else {
					p, ok := h["path"].(string)
					if !ok || !strings.HasPrefix(p, "/") || len(p) > 1024 || strings.ContainsAny(p, "\x00\r\n") || !fields(h, "port", "path", "scheme") {
						return invalid
					}
					if scheme, exists := h["scheme"]; exists && scheme != "HTTP" && scheme != "HTTPS" {
						return invalid
					}
				}
			} else {
				min, max := 1, 3600
				if k == "initialDelaySeconds" {
					min = 0
				}
				if k == "successThreshold" && key != "readinessProbe" {
					max = 1
				}
				if !integer(v, min, max) {
					return invalid
				}
			}
		}
		if handlers != 1 {
			return invalid
		}
	case "configFiles":
		m, ok := value.(map[string]any)
		if !ok || len(m) > 50 {
			return invalid
		}
		total := 0
		for k, v := range m {
			s, ok := v.(string)
			if !ok || k == "." || k == ".." || len(k) > 253 || !configKey.MatchString(k) || sensitiveKey.MatchString(k) || strings.Contains(s, "PRIVATE KEY") || strings.ContainsRune(s, '\x00') {
				return invalid
			}
			total += len(k) + len(s)
		}
		if total > 128<<10 {
			return invalid
		}
	case "configMountPath":
		if !validMountPath(value) {
			return invalid
		}
	case "volumes":
		volumes, ok := value.([]any)
		if !ok || len(volumes) > 16 {
			return invalid
		}
		names, paths := map[string]bool{}, map[string]bool{}
		for _, v := range volumes {
			m, ok := v.(map[string]any)
			if !ok || !fields(m, "name", "mountPath", "readOnly", "configMap", "secret", "persistentVolumeClaim") {
				return invalid
			}
			name, _ := m["name"].(string)
			p, _ := m["mountPath"].(string)
			readOnly, ok := m["readOnly"].(bool)
			if !ok || !platform.DNSName(name, 63) || name == "podry-config" || names[name] || paths[p] || !validMountPath(p) {
				return invalid
			}
			names[name], paths[p] = true, true
			sources := 0
			for _, source := range []string{"configMap", "secret", "persistentVolumeClaim"} {
				if raw, exists := m[source]; exists {
					sources++
					src, ok := raw.(map[string]any)
					field := "name"
					if source == "secret" {
						field = "secretName"
					}
					if source == "persistentVolumeClaim" {
						field = "claimName"
					}
					n, _ := src[field].(string)
					if !ok || !fields(src, field) || !dnsSubdomain(n) || (source != "persistentVolumeClaim" && !readOnly) {
						return invalid
					}
				}
			}
			if sources != 1 {
				return invalid
			}
		}
	}
	return nil
}
