package release

// ReferencePermission names namespace-scoped data exposed to the application.
// Secret use requires the same explicit privilege as revealing its contents.
type ReferencePermission struct{ Resource, Action string }

func MountPermissions(values map[string]any) []ReferencePermission {
	var out []ReferencePermission
	volumes, _ := values["volumes"].([]any)
	for _, raw := range volumes {
		v, _ := raw.(map[string]any)
		if v["secret"] != nil {
			out = append(out, ReferencePermission{"core/secrets", "resource.view"}, ReferencePermission{"core/secrets", "secret.reveal"})
		}
		if v["configMap"] != nil {
			out = append(out, ReferencePermission{"core/configmaps", "resource.view"})
		}
		if v["persistentVolumeClaim"] != nil {
			out = append(out, ReferencePermission{"core/persistentvolumeclaims", "resource.view"})
			if v["readOnly"] != true {
				out = append(out, ReferencePermission{"core/persistentvolumeclaims", "resource.write"})
			}
		}
	}
	return out
}
