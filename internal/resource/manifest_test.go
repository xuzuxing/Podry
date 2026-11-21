package resource

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/xuzuxing/podry/internal/credential"
)

func TestManifestStrictDocumentAndIdentity(t *testing.T) {
	base := "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: example\n  namespace: demo\ndata:\n  message: original\n"
	if _, _, _, err := parseManifest(ManifestDocument{Manifest: base}); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := parseManifest(ManifestDocument{Manifest: base + "...\n" + base}); err == nil {
		t.Fatal("accepted content after document end")
	}
	for _, raw := range []string{base + "---\n" + base, base + "kind: Secret\n", `{"apiVersion":"v1","kind":"ConfigMap","kind":"Secret","metadata":{"name":"x"}}`, "[]", base + "---\n", strings.Replace(base, "name: example", "name: ../example", 1), strings.Replace(base, "name: example", "generateName: example-", 1), strings.Replace(base, "apiVersion: v1", "apiVersion: /v1", 1)} {
		if _, _, _, err := parseManifest(ManifestDocument{Manifest: raw}); err == nil {
			t.Fatalf("accepted ambiguous document %q", raw)
		}
	}
}
func TestResourceDiffDoesNotRevealValues(t *testing.T) {
	a := map[string]any{"data": map[string]any{"PASSWORD": "private-old"}, "removed": "private-remove"}
	b := map[string]any{"data": map[string]any{"PASSWORD": "private-new"}, "added": "private-add"}
	diff := fieldDiff(a, b)
	if strings.Contains(diff.Before+diff.After, "private-") || !strings.Contains(diff.Before, "/data/PASSWORD") || !strings.Contains(diff.After, "/data/PASSWORD") || !strings.Contains(diff.Before, "/removed") || !strings.Contains(diff.After, "/added") {
		t.Fatal(diff)
	}
}

func TestManifestSnapshotPreservesLargeIntegers(t *testing.T) {
	m, _, _, err := parseManifest(ManifestDocument{Manifest: "apiVersion: example.test/v1\nkind: Widget\nmetadata:\n  name: large\n  namespace: demo\nspec:\n  sequence: 9007199254740993\n"})
	if err != nil || obj(m, "spec")["sequence"] != json.Number("9007199254740993") {
		t.Fatal(m, err)
	}
	vault, err := credential.New("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
	if err != nil {
		t.Fatal(err)
	}
	s := New(nil, vault, "test-signing-key")
	p := writePlan{Stamp: writeStamp{CredentialID: "fixture"}, Documents: []writeDocument{{Manifest: m, Expected: copyMap(m)}}}
	encrypted, key, err := s.sealPlan("resource-preview", "large-int", p)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.openPlan("resource-preview", "large-int", key, encrypted)
	if err != nil || !reflect.DeepEqual(p, got) {
		t.Fatal("numeric snapshot changed", got, err)
	}
}
