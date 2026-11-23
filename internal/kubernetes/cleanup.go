package kubernetes

import (
	"context"
	"errors"
	"net/url"

	"github.com/xuzuxing/podry/internal/httpx"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func CleanupBlocked(code string) error {
	return httpx.Fail(409, code, "资源清理前置证据不足，保留资源并稍后重试")
}

func IsMissing(err error) bool {
	var api *httpx.Error
	return errors.As(err, &api) && api.Code == "resource_not_found"
}

// DeleteCollected never deletes by name alone. A lost response is handled by a
// fresh read on the next pass; a new UID is never adopted as the old resource.
// Foreground deletion keeps the Job observable until its dependents disappear.
func (c *Client) DeleteCollected(ctx context.Context, path string, o *unstructured.Unstructured) error {
	if o.GetUID() == "" || o.GetResourceVersion() == "" {
		return CleanupBlocked("cleanup_identity_unconfirmed")
	}
	if o.GetDeletionTimestamp() == nil {
		_, _, err := c.ResourceWrite(ctx, "DELETE", path, map[string]any{
			"apiVersion": "v1", "kind": "DeleteOptions", "propagationPolicy": "Foreground",
			"preconditions": map[string]any{"uid": string(o.GetUID()), "resourceVersion": o.GetResourceVersion()},
		}, false)
		if err != nil && !IsMissing(err) {
			return err
		}
	}
	var after unstructured.Unstructured
	err := c.Get(ctx, path, nil, &after)
	if IsMissing(err) {
		return nil
	}
	if err != nil {
		return err
	}
	return CleanupBlocked("cleanup_deletion_unconfirmed")
}

// A complete bounded list is required. Truncation, a missing items field or a
// denied list is uncertainty, never an empty set of consumers.
func (c *Client) CleanupList(ctx context.Context, path string, query url.Values) ([]unstructured.Unstructured, error) {
	if query == nil {
		query = url.Values{}
	}
	query.Set("limit", "200")
	var list struct {
		Items    []map[string]any `json:"items"`
		Metadata struct {
			Continue string `json:"continue"`
		} `json:"metadata"`
	}
	if err := c.Get(ctx, path, query, &list); err != nil {
		return nil, err
	}
	if list.Items == nil || len(list.Items) > 200 || list.Metadata.Continue != "" {
		return nil, CleanupBlocked("cleanup_inventory_incomplete")
	}
	out := make([]unstructured.Unstructured, 0, len(list.Items))
	for _, o := range list.Items {
		out = append(out, unstructured.Unstructured{Object: o})
	}
	return out, nil
}

// SecretUnused includes retained ReplicaSets and scheduled templates: a stopped
// Pod or an old controller can still require its frozen Secret during rollback.
func (c *Client) SecretUnused(ctx context.Context, namespace, name string) error {
	paths := []string{
		"/api/v1/namespaces/" + namespace + "/pods",
		"/api/v1/namespaces/" + namespace + "/replicationcontrollers",
		"/api/v1/namespaces/" + namespace + "/serviceaccounts",
		"/apis/apps/v1/namespaces/" + namespace + "/deployments",
		"/apis/apps/v1/namespaces/" + namespace + "/replicasets",
		"/apis/apps/v1/namespaces/" + namespace + "/statefulsets",
		"/apis/apps/v1/namespaces/" + namespace + "/daemonsets",
		"/apis/batch/v1/namespaces/" + namespace + "/jobs",
		"/apis/batch/v1/namespaces/" + namespace + "/cronjobs",
		"/apis/networking.k8s.io/v1/namespaces/" + namespace + "/ingresses",
	}
	for _, path := range paths {
		items, err := c.CleanupList(ctx, path, nil)
		if err != nil {
			return err
		}
		for _, item := range items {
			if secretReferenced(item.Object, name) {
				return CleanupBlocked("cleanup_resource_referenced")
			}
		}
	}
	return nil
}

func secretReferenced(value any, name string) bool {
	switch v := value.(type) {
	case map[string]any:
		for key, child := range v {
			if key == "secretName" && child == name {
				return true
			}
			if key == "secretRef" || key == "secretKeyRef" || key == "secret" || key == "nodePublishSecretRef" {
				if ref, ok := child.(map[string]any); ok && ref["name"] == name {
					return true
				}
			}
			if key == "imagePullSecrets" || key == "secrets" {
				if refs, ok := child.([]any); ok {
					for _, raw := range refs {
						if ref, ok := raw.(map[string]any); ok && ref["name"] == name {
							return true
						}
					}
				}
			}
			if secretReferenced(child, name) {
				return true
			}
		}
	case []any:
		for _, item := range v {
			if secretReferenced(item, name) {
				return true
			}
		}
	}
	return false
}

// CleanupJobExited is stricter than a terminal business status: the controller
// must report no active Pods and completion/failure (or confirmed suspension).
func CleanupJobExited(o *unstructured.Unstructured, suspended bool) bool {
	active, _, err := unstructured.NestedInt64(o.Object, "status", "active")
	if err != nil || active != 0 {
		return false
	}
	conditions, _, err := unstructured.NestedSlice(o.Object, "status", "conditions")
	if err != nil {
		return false
	}
	for _, raw := range conditions {
		c, _ := raw.(map[string]any)
		if c["status"] != "True" {
			continue
		}
		if c["type"] == "Complete" || c["type"] == "Failed" {
			return true
		}
		isSuspended, _, _ := unstructured.NestedBool(o.Object, "spec", "suspend")
		if suspended && isSuspended && c["type"] == "Suspended" {
			return true
		}
	}
	return false
}

func (c *Client) CleanupJobPods(ctx context.Context, namespace, uid string) ([]unstructured.Unstructured, error) {
	pods, err := c.CleanupList(ctx, "/api/v1/namespaces/"+namespace+"/pods", url.Values{"labelSelector": {"controller-uid=" + uid}})
	if err != nil {
		return nil, err
	}
	for _, pod := range pods {
		owned := false
		for _, ref := range pod.GetOwnerReferences() {
			if ref.APIVersion == "batch/v1" && ref.Kind == "Job" && string(ref.UID) == uid && ref.Controller != nil && *ref.Controller {
				owned = true
			}
		}
		phase, _, _ := unstructured.NestedString(pod.Object, "status", "phase")
		if !owned || pod.GetUID() == "" || (phase != "Succeeded" && phase != "Failed") {
			return nil, CleanupBlocked("cleanup_pod_exit_unconfirmed")
		}
	}
	return pods, nil
}
