package build

import (
	"encoding/json"
	"testing"
)

func TestCheckStageOrderAndCredentialIsolation(t *testing.T) {
	spec := ExecutionSpec{RunnerImage: "runner:test", Platform: "linux/amd64"}
	legacy := Hash(spec)
	raw, _ := json.Marshal(spec)
	var old map[string]any
	_ = json.Unmarshal(raw, &old)
	if _, ok := old["checkScript"]; ok {
		t.Fatal("legacy execution acquired a new field")
	}
	script := "test -f go.mod"
	spec.CheckScript = &script
	if Hash(spec) == legacy {
		t.Fatal("script excluded from execution identity")
	}
	pod := obj(obj(obj(job(spec)["spec"])["template"])["spec"])
	init := pod["initContainers"].([]any)
	if len(init) != 2 || obj(init[0])["name"] != "source" || obj(init[1])["name"] != "check" {
		t.Fatal("checks must finish after source and before build")
	}
	check := obj(init[1])
	for _, raw := range check["volumeMounts"].([]any) {
		m := obj(raw)
		if m["name"] == "auth" || m["name"] == "tmp" {
			t.Fatal("checks share authentication or source temporary files")
		}
	}
	if pod["automountServiceAccountToken"] != false || obj(job(spec)["spec"])["backoffLimit"] != 0 {
		t.Fatal("check failure must stop the Job without retrying user code")
	}
	if obj(pod["containers"].([]any)[0])["name"] != "build" {
		t.Fatal("image phase missing")
	}
	spec.CheckScript = nil
	if Hash(spec) != legacy {
		t.Fatal("legacy execution identity changed")
	}
}
