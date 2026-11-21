package resource

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/url"
	"reflect"
	"slices"
	"sort"
	"strings"

	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/kubernetes"
	kubeyaml "k8s.io/apimachinery/pkg/util/yaml"
	"sigs.k8s.io/yaml"
)

const operationAnnotation = "podry.io/resource-operation"
const planAnnotation = "podry.io/resource-plan"

func copyMap(m map[string]any) map[string]any {
	raw, _ := json.Marshal(m)
	var out map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	_ = decoder.Decode(&out)
	return out
}
func boundedValue(v any, depth int, budget *int) bool {
	*budget--
	if depth > 48 || *budget < 0 {
		return false
	}
	switch x := v.(type) {
	case map[string]any:
		for _, child := range x {
			if !boundedValue(child, depth+1, budget) {
				return false
			}
		}
	case []any:
		for _, child := range x {
			if !boundedValue(child, depth+1, budget) {
				return false
			}
		}
	}
	return true
}
func parseManifest(in ManifestDocument) (map[string]any, string, string, error) {
	invalid := httpx.Invalid("manifest 必须是单个严格 YAML/JSON 对象，含有效 apiVersion、kind、metadata.name 和明确作用域")
	if len(in.Manifest) == 0 || len(in.Manifest) > 256<<10 {
		return nil, "", "", invalid
	}
	// YAMLReader treats an empty trailing document as EOF. Reject a separator
	// after content as well, so one array entry always means one document.
	content, ended := false, false
	for _, line := range strings.Split(in.Manifest, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if ended {
			return nil, "", "", invalid
		}
		if strings.HasPrefix(line, "---") && (len(line) == 3 || strings.ContainsAny(line[3:4], " \t\r")) {
			if content {
				return nil, "", "", invalid
			}
		} else if strings.HasPrefix(line, "...") && (len(line) == 3 || strings.ContainsAny(line[3:4], " \t\r")) {
			ended = true
		} else {
			content = true
		}
	}
	reader := kubeyaml.NewYAMLReader(bufio.NewReader(strings.NewReader(in.Manifest)))
	first, err := reader.Read()
	if err != nil {
		return nil, "", "", invalid
	}
	if _, err = reader.Read(); err != io.EOF {
		return nil, "", "", invalid
	}
	raw, err := yaml.YAMLToJSONStrict(first)
	var m map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err != nil || decoder.Decode(&m) != nil || m == nil {
		return nil, "", "", invalid
	}
	budget := 50000
	if !boundedValue(m, 0, &budget) {
		return nil, "", "", invalid
	}
	parts := strings.Split(str(m, "apiVersion"), "/")
	group, version := "", ""
	if len(parts) == 1 {
		version = parts[0]
	} else if len(parts) == 2 {
		group, version = parts[0], parts[1]
		if group == "" {
			return nil, "", "", invalid
		}
	}
	meta := obj(m, "metadata")
	if !validGroup(group) || !validSegment(version, 63) || str(m, "kind") == "" || !validName(str(meta, "name")) || meta["generateName"] != nil {
		return nil, "", "", invalid
	}
	for _, key := range []string{"name", "namespace", "uid", "resourceVersion"} {
		if v, ok := meta[key]; ok {
			if _, ok = v.(string); !ok {
				return nil, "", "", invalid
			}
		}
	}
	for _, v := range []string{in.ExpectedUID, in.ExpectedResourceVersion, str(meta, "uid"), str(meta, "resourceVersion")} {
		if len(v) > 256 || strings.ContainsAny(v, "\x00\r\n") {
			return nil, "", "", invalid
		}
	}
	delete(m, "status")
	delete(meta, "managedFields")
	delete(meta, "creationTimestamp")
	delete(meta, "selfLink")
	delete(meta, "generation")
	if anns := obj(meta, "annotations"); anns != nil {
		delete(anns, "kubectl.kubernetes.io/last-applied-configuration")
		delete(anns, operationAnnotation)
		delete(anns, planAnnotation)
		if len(anns) == 0 {
			delete(meta, "annotations")
		}
	}
	return m, group, version, nil
}
func normalized(m map[string]any) map[string]any {
	m = copyMap(m)
	delete(m, "status")
	meta := obj(m, "metadata")
	for _, k := range []string{"uid", "resourceVersion", "creationTimestamp", "generation", "managedFields", "selfLink"} {
		delete(meta, k)
	}
	if anns := obj(meta, "annotations"); anns != nil {
		delete(anns, operationAnnotation)
		delete(anns, planAnnotation)
		delete(anns, "kubectl.kubernetes.io/last-applied-configuration")
		if len(anns) == 0 {
			delete(meta, "annotations")
		}
	}
	return m
}
func refFor(t ResourceType, raw map[string]any) Ref {
	m := obj(raw, "metadata")
	return Ref{t.Group, t.Version, t.Resource, str(m, "namespace"), str(m, "name"), str(m, "uid"), str(m, "resourceVersion")}
}
func actionPermission(action string) string {
	if action == "delete" {
		return "resource.delete"
	}
	return "resource.write"
}
func actionAllowed(x snapshot, t ResourceType, ref Ref, action string) bool {
	return x.allows(t.key(), ref.Namespace, actionPermission(action), t.Namespaced) && x.allows(t.key(), ref.Namespace, "resource.view", t.Namespaced)
}
func writeAllowed(x snapshot, t ResourceType, ref Ref) bool {
	return x.allows(t.key(), ref.Namespace, "resource.write", t.Namespaced) && x.allows(t.key(), ref.Namespace, "resource.view", t.Namespaced)
}
func responseIdentity(t ResourceType, ref Ref, m map[string]any, requireUID bool) error {
	api := t.Version
	if t.Group != "" {
		api = t.Group + "/" + t.Version
	}
	meta := obj(m, "metadata")
	if str(m, "apiVersion") != api || str(m, "kind") != t.Kind || str(meta, "name") != ref.Name || str(meta, "namespace") != ref.Namespace || requireUID && (str(meta, "uid") == "" || str(meta, "resourceVersion") == "") {
		return httpx.Fail(503, "kubernetes_invalid_response", "Kubernetes 写入响应的资源身份不匹配")
	}
	if ref.UID != "" && str(meta, "uid") != ref.UID {
		return httpx.Fail(409, "resource_identity_changed", "同名资源已被替换，请重新预览")
	}
	return nil
}
func currentObject(ctx context.Context, c *kubernetes.Client, d writeDocument) (map[string]any, error) {
	raw, err := readWriteObject(ctx, c, d.Type.path(d.Ref.Namespace, d.Ref.Name))
	if d.Action == "create" {
		if statusCode(err, 404) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return nil, httpx.Fail(409, "resource_identity_changed", "待创建资源已存在，请重新预览")
	}
	if statusCode(err, 404) {
		return nil, httpx.Fail(409, "resource_identity_changed", "待更新资源已消失，请重新预览")
	}
	if err != nil {
		return nil, err
	}
	if err = responseIdentity(d.Type, d.Ref, raw, true); err != nil {
		return nil, err
	}
	if str(obj(raw, "metadata"), "resourceVersion") != d.Ref.ResourceVersion {
		return nil, httpx.Fail(409, "resource_version_changed", "资源版本已变化，请重新预览")
	}
	return raw, nil
}

// Keep arbitrary CRD integers exact throughout preview, encrypted snapshots and
// observation. The generic resource browser has its own projection semantics.
func readWriteObject(ctx context.Context, c *kubernetes.Client, path string) (map[string]any, error) {
	var raw json.RawMessage
	if err := c.Get(ctx, path, nil, &raw); err != nil {
		return nil, err
	}
	var out map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	budget := 50000
	if decoder.Decode(&out) != nil || out == nil || !boundedValue(out, 0, &budget) {
		return nil, httpx.Fail(503, "kubernetes_invalid_response", "Kubernetes 资源响应无效或超过结构预算")
	}
	return out, nil
}
func (s *Service) prepareDocument(ctx context.Context, c *kubernetes.Client, x snapshot, in ManifestDocument) (writeDocument, Diff, error) {
	d := writeDocument{}
	raw, g, v, err := parseManifest(in)
	if err != nil {
		return d, Diff{}, err
	}
	all, err := types(ctx, c, g, v)
	if err != nil {
		return d, Diff{}, err
	}
	matches := []ResourceType{}
	for _, t := range all {
		if t.Kind == str(raw, "kind") {
			matches = append(matches, t)
		}
	}
	if len(matches) != 1 {
		return d, Diff{}, httpx.Invalid("apiVersion/kind 无法唯一映射为资源类型")
	}
	d.Type = matches[0]
	d.Ref = refFor(d.Type, raw)
	d.Manifest = raw
	if err = scope(x, d.Type, url.Values{"namespace": {d.Ref.Namespace}, "name": {d.Ref.Name}}, "resource.write", "get", true); err != nil {
		return d, Diff{}, err
	}
	if !writeAllowed(x, d.Type, d.Ref) {
		return d, Diff{}, httpx.NotFound()
	}
	uid, rv := in.ExpectedUID, in.ExpectedResourceVersion
	meta := obj(raw, "metadata")
	if uid != "" && str(meta, "uid") != "" && uid != str(meta, "uid") || rv != "" && str(meta, "resourceVersion") != "" && rv != str(meta, "resourceVersion") {
		return d, Diff{}, httpx.Invalid("文档与显式 UID/版本前置条件不一致")
	}
	if uid == "" {
		uid = str(meta, "uid")
	}
	if rv == "" {
		rv = str(meta, "resourceVersion")
	}
	before, err := readWriteObject(ctx, c, d.Type.path(d.Ref.Namespace, d.Ref.Name))
	switch {
	case statusCode(err, 404):
		d.Action = "create"
		if uid != "" || rv != "" {
			return d, Diff{}, httpx.Fail(409, "resource_identity_changed", "指定的原资源已不存在")
		}
		delete(meta, "uid")
		delete(meta, "resourceVersion")
	case err != nil:
		return d, Diff{}, err
	default:
		d.Action = "update"
		if uid == "" || rv == "" {
			return d, Diff{}, httpx.Invalid("更新资源必须提供 expectedUid 和 expectedResourceVersion，或保留文档中的两个字段")
		}
		d.Ref.UID, d.Ref.ResourceVersion = uid, rv
		if err = responseIdentity(d.Type, d.Ref, before, true); err != nil {
			return d, Diff{}, err
		}
		if str(obj(before, "metadata"), "resourceVersion") != rv {
			return d, Diff{}, httpx.Fail(409, "resource_version_changed", "资源版本已变化，请刷新后预览")
		}
		meta["uid"], meta["resourceVersion"] = uid, rv
	}
	method, path := "POST", d.Type.path(d.Ref.Namespace, "")
	verb := "create"
	if d.Action == "update" {
		method, path, verb = "PUT", d.Type.path(d.Ref.Namespace, d.Ref.Name), "update"
	}
	if !slices.Contains(d.Type.Verbs, verb) {
		return d, Diff{}, httpx.Fail(422, "resource_verb_unavailable", "资源不支持所需写入动作")
	}
	after, _, err := c.ResourceWrite(ctx, method, path, raw, true)
	if err != nil {
		return d, Diff{}, err
	}
	if err = responseIdentity(d.Type, d.Ref, after, false); err != nil {
		return d, Diff{}, err
	}
	budget := 50000
	if !boundedValue(after, 0, &budget) {
		return d, Diff{}, httpx.Fail(503, "resource_read_limit", "Kubernetes 预览响应超过结构预算")
	}
	d.Expected = normalized(after)
	return d, fieldDiff(normalized(before), d.Expected), nil
}

// Diff carries field paths only. Secret, ConfigMap, CRD values and admission
// responses must never leak through previews, audit records or operation errors.
func fieldDiff(before, after map[string]any) Diff {
	added, removed, changed := []string{}, []string{}, []string{}
	var walk func(any, any, string)
	walk = func(a, b any, p string) {
		if len(added)+len(removed)+len(changed) >= 4096 || reflect.DeepEqual(a, b) {
			return
		}
		am, ao := a.(map[string]any)
		bm, bo := b.(map[string]any)
		if ao && bo {
			keys := map[string]bool{}
			for k := range am {
				keys[k] = true
			}
			for k := range bm {
				keys[k] = true
			}
			ordered := []string{}
			for k := range keys {
				ordered = append(ordered, k)
			}
			sort.Strings(ordered)
			for _, k := range ordered {
				walk(am[k], bm[k], p+"/"+strings.ReplaceAll(strings.ReplaceAll(k, "~", "~0"), "/", "~1"))
			}
			return
		}
		if a == nil {
			added = append(added, p)
		} else if b == nil {
			removed = append(removed, p)
		} else {
			changed = append(changed, p)
		}
	}
	if before == nil {
		before = map[string]any{}
	}
	walk(before, after, "")
	left, _ := json.Marshal(map[string]any{"removed": removed, "changed": changed})
	right, _ := json.Marshal(map[string]any{"added": added, "changed": changed})
	return Diff{string(left), string(right)}
}
