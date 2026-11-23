package release

import (
	"encoding/json"
	"errors"
	"io"
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/util/yaml"
)

func resourceName(version, kind string) (string, error) {
	switch version + "/" + kind {
	case "apps/v1/Deployment":
		return "apps/deployments", nil
	case "batch/v1/Job":
		return "batch/jobs", nil
	case "v1/Secret":
		return "core/secrets", nil
	case "v1/ConfigMap":
		return "core/configmaps", nil
	case "v1/Service":
		return "core/services", nil
	case "networking.k8s.io/v1/Ingress":
		return "networking.k8s.io/ingresses", nil
	}
	return "", errors.New("unsupported release resource")
}
func resourcePath(r Resource) (string, error) {
	name, err := resourceName(r.APIVersion, r.Kind)
	if err != nil {
		return "", err
	}
	parts := strings.Split(name, "/")
	prefix := "/api/v1"
	if parts[0] != "core" {
		prefix = "/apis/" + r.APIVersion
	}
	return prefix + "/namespaces/" + r.Namespace + "/" + parts[1] + "/" + r.Name, nil
}

// Objects reads identities only, never Secret data. Both the preflight scope and
// runtime observation are derived from the exact archived preview manifest.
func Objects(p Plan) ([]Resource, error) {
	if p.Removal != nil {
		p.DeploymentID = p.Removal.DeploymentID
	}
	decoder := yaml.NewYAMLOrJSONDecoder(strings.NewReader(p.Chart.Manifest), 4096)
	var result []Resource
	seen := map[string]bool{}
	workloads := 0
	for {
		var object unstructured.Unstructured
		err := decoder.Decode(&object)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if len(object.Object) == 0 {
			continue
		}
		ref := Resource{APIVersion: object.GetAPIVersion(), Kind: object.GetKind(), Namespace: object.GetNamespace(), Name: object.GetName()}
		if _, err = resourceName(ref.APIVersion, ref.Kind); err != nil {
			return nil, err
		}
		if ref.Name == "" || ref.Namespace != p.Target.Namespace || !owned(&object, p) {
			return nil, errors.New("release object identity mismatch")
		}
		if ref.Kind == "Deployment" || ref.Kind == "Job" {
			workloads++
			if ref.Kind != p.WorkloadKind || !imageMatches(&object, p) {
				return nil, errors.New("release workload mismatch")
			}
		}
		key := ref.APIVersion + "/" + ref.Kind + "/" + ref.Name
		if seen[key] {
			return nil, errors.New("duplicate release resource")
		}
		seen[key] = true
		result = append(result, ref)
		if len(result) > 8 {
			return nil, errors.New("release resource budget exceeded")
		}
	}
	if workloads != 1 {
		return nil, errors.New("release needs exactly one workload")
	}
	return result, nil
}
func owned(o *unstructured.Unstructured, p Plan) bool {
	l := o.GetLabels()
	return l["podry.io/app-id"] == p.AppID && l["podry.io/binding-id"] == p.BindingID && l["podry.io/deployment-id"] == p.DeploymentID && l["app.kubernetes.io/instance"] == p.Target.ReleaseName
}
func imageMatches(o *unstructured.Unstructured, p Plan) bool {
	containers, _, _ := unstructured.NestedSlice(o.Object, "spec", "template", "spec", "containers")
	if len(containers) != 1 {
		return false
	}
	container, _ := containers[0].(map[string]any)
	return container["name"] == "app" && container["image"] == p.ImageRef
}
func number(o *unstructured.Unstructured, path ...string) int64 {
	v, _, _ := unstructured.NestedInt64(o.Object, path...)
	return v
}
func condition(o *unstructured.Unstructured, kind, status string) bool {
	conditions, _, _ := unstructured.NestedSlice(o.Object, "status", "conditions")
	for _, raw := range conditions {
		c, _ := raw.(map[string]any)
		if c["type"] == kind && c["status"] == status {
			return true
		}
	}
	return false
}
func workloadState(o *unstructured.Unstructured) string {
	if o.GetDeletionTimestamp() != nil {
		return "observing"
	}
	if o.GetKind() == "Job" {
		if condition(o, "Failed", "True") {
			return "failed"
		}
		if condition(o, "Complete", "True") && number(o, "status", "succeeded") >= 1 {
			return "succeeded"
		}
		return "observing"
	}
	if o.GetGeneration() < 1 || number(o, "status", "observedGeneration") < o.GetGeneration() {
		return "observing"
	}
	cs, _, _ := unstructured.NestedSlice(o.Object, "status", "conditions")
	for _, raw := range cs {
		c, _ := raw.(map[string]any)
		if c["type"] == "Progressing" && c["status"] == "False" && c["reason"] == "ProgressDeadlineExceeded" {
			return "failed"
		}
	}
	desired, found, _ := unstructured.NestedInt64(o.Object, "spec", "replicas")
	if !found {
		desired = 1
	}
	if number(o, "status", "updatedReplicas") == desired && number(o, "status", "readyReplicas") == desired && number(o, "status", "availableReplicas") >= desired && number(o, "status", "replicas") == desired && (desired == 0 || condition(o, "Available", "True")) {
		return "succeeded"
	}
	return "observing"
}

// ResourceHealth projects a current read; it does not change execution history.
func ResourceHealth(o *unstructured.Unstructured, p Plan) string {
	if !owned(o, p) || !imageMatches(o, p) {
		return "degraded"
	}
	if o.GetKind() == "Deployment" {
		if replicas, found, _ := unstructured.NestedInt64(o.Object, "spec", "replicas"); found && replicas == 0 && workloadState(o) == "succeeded" {
			return "stopped"
		}
	}
	switch workloadState(o) {
	case "failed":
		return "degraded"
	case "succeeded":
		if o.GetKind() == "Job" {
			return "completed"
		}
		return "healthy"
	default:
		return "progressing"
	}
}

func SuccessfulApplicationPod(raw map[string]any, p Plan, jobUID string) bool {
	b, err := json.Marshal(raw)
	if err != nil {
		return false
	}
	var o unstructured.Unstructured
	if o.UnmarshalJSON(b) != nil || o.GetKind() != "Pod" || !owned(&o, p) {
		return false
	}
	phase, _, _ := unstructured.NestedString(o.Object, "status", "phase")
	if phase != "Succeeded" {
		return false
	}
	controller := false
	for _, r := range o.GetOwnerReferences() {
		if r.Controller != nil && *r.Controller && r.APIVersion == "batch/v1" && r.Kind == "Job" && string(r.UID) == jobUID {
			controller = true
		}
	}
	cs, _, _ := unstructured.NestedSlice(o.Object, "spec", "containers")
	if !controller || len(cs) != 1 {
		return false
	}
	c, _ := cs[0].(map[string]any)
	return c["name"] == "app" && c["image"] == p.ImageRef
}
