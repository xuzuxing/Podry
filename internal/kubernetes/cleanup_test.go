package kubernetes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestCleanupSecretReferences(t *testing.T) {
	for _, raw := range []string{
		`{"spec":{"volumes":[{"secret":{"secretName":"old"}}]}}`,
		`{"spec":{"volumes":[{"projected":{"sources":[{"secret":{"name":"old"}}]}}]}}`,
		`{"spec":{"template":{"spec":{"containers":[{"envFrom":[{"secretRef":{"name":"old"}}]}]}}}}`,
		`{"spec":{"jobTemplate":{"spec":{"template":{"spec":{"containers":[{"env":[{"valueFrom":{"secretKeyRef":{"name":"old","key":"key"}}}]}]}}}}}}`,
		`{"spec":{"imagePullSecrets":[{"name":"old"}]}}`,
		`{"spec":{"volumes":[{"csi":{"driver":"fixture","nodePublishSecretRef":{"name":"old"}}}]}}`,
		`{"secrets":[{"name":"old"}]}`,
	} {
		var o map[string]any
		if json.Unmarshal([]byte(raw), &o) != nil {
			t.Fatal("invalid fixture")
		}
		if !secretReferenced(o, "old") || secretReferenced(o, "another") {
			t.Fatal("Secret consumer missed or matched a different name", raw)
		}
	}
}

func TestCleanupIngressAndServiceAccountConsumers(t *testing.T) {
	for _, kind := range []string{"ingresses", "serviceaccounts"} {
		t.Run(kind, func(t *testing.T) {
			srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				items := []any{}
				if strings.HasSuffix(r.URL.Path, "/"+kind) {
					if kind == "ingresses" {
						items = append(items, map[string]any{"spec": map[string]any{"tls": []any{map[string]any{"secretName": "old"}}}})
					} else {
						items = append(items, map[string]any{"secrets": []any{map[string]any{"name": "old"}}})
					}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
			}))
			defer srv.Close()
			c, err := New(map[string]any{"apiServer": srv.URL, "token": "fixture", "insecureSkipTLSVerify": true})
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			if c.SecretUnused(context.Background(), "demo", "old") == nil {
				t.Fatal("Secret consumer endpoint was omitted")
			}
		})
	}
}

func TestCleanupInventoryMustBeComplete(t *testing.T) {
	for _, test := range []struct {
		name, body string
		status     int
	}{
		{"pagination", `{"items":[],"metadata":{"continue":"more"}}`, 200},
		{"missing_items", `{"metadata":{}}`, 200},
		{"forbidden", `{"error":"sensitive detail"}`, 403},
	} {
		t.Run(test.name, func(t *testing.T) {
			srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			defer srv.Close()
			c, err := New(map[string]any{"apiServer": srv.URL, "token": "fixture", "insecureSkipTLSVerify": true})
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			if c.SecretUnused(context.Background(), "demo", "old") == nil {
				t.Fatal("incomplete inventory treated as no references")
			}
		})
	}
}

func TestCleanupDeletionWaitsForDisappearance(t *testing.T) {
	deletes := 0
	obj := map[string]any{"apiVersion": "batch/v1", "kind": "Job", "metadata": map[string]any{"name": "demo", "namespace": "demo", "uid": "uid", "resourceVersion": "10"}}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "DELETE" {
			deletes++
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			pre, _ := body["preconditions"].(map[string]any)
			if pre["uid"] != "uid" || pre["resourceVersion"] != "10" {
				t.Error("missing exact delete conditions")
			}
			w.WriteHeader(202)
		}
		_ = json.NewEncoder(w).Encode(obj)
	}))
	defer srv.Close()
	c, err := New(map[string]any{"apiServer": srv.URL, "token": "fixture", "insecureSkipTLSVerify": true})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	o := &unstructured.Unstructured{Object: obj}
	if c.DeleteCollected(context.Background(), "/apis/batch/v1/namespaces/demo/jobs/demo", o) == nil {
		t.Fatal("202 considered deletion complete")
	}
	meta := obj["metadata"].(map[string]any)
	meta["deletionTimestamp"] = "2026-11-23T00:00:00Z"
	if c.DeleteCollected(context.Background(), "/apis/batch/v1/namespaces/demo/jobs/demo", o) == nil || deletes != 1 {
		t.Fatal("finalizer wait resent deletion or considered complete")
	}
}
