package resource

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/kubernetes"
	"github.com/xuzuxing/podry/internal/platform"
)

type Ref struct {
	Group           string `json:"group"`
	Version         string `json:"version"`
	Resource        string `json:"resource"`
	Namespace       string `json:"namespace"`
	Name            string `json:"name"`
	UID             string `json:"uid"`
	ResourceVersion string `json:"resourceVersion"`
}
type Object struct {
	Ref       Ref            `json:"ref"`
	Kind      string         `json:"kind"`
	Status    string         `json:"status"`
	Manifest  string         `json:"manifest"`
	Data      map[string]any `json:"data"`
	OwnerRefs []Ref          `json:"ownerRefs"`
}
type List struct {
	Items           []Object `json:"items"`
	ContinueToken   *string  `json:"continueToken"`
	ResourceVersion string   `json:"resourceVersion"`
}
type kubeList struct {
	Metadata struct {
		Continue        string `json:"continue"`
		ResourceVersion string `json:"resourceVersion"`
	} `json:"metadata"`
	Items []map[string]any `json:"items"`
}

func str(m map[string]any, k string) string         { v, _ := m[k].(string); return v }
func obj(m map[string]any, k string) map[string]any { v, _ := m[k].(map[string]any); return v }
func checkIdentity(raw map[string]any, q url.Values) error {
	m := obj(raw, "metadata")
	if uid := q.Get("uid"); uid != "" && uid != str(m, "uid") {
		return httpx.Fail(409, "resource_identity_changed", "同名资源已被替换，请重新选择对象")
	}
	if rv := q.Get("resourceVersion"); rv != "" && rv != str(m, "resourceVersion") {
		return httpx.Fail(409, "resource_version_changed", "资源版本已变化，请刷新对象")
	}
	return nil
}

func validateObject(t ResourceType, raw map[string]any, namespace, name string) error {
	m := obj(raw, "metadata")
	expected := t.Version
	if t.Group != "" {
		expected = t.Group + "/" + t.Version
	}
	ns, n := str(m, "namespace"), str(m, "name")
	if str(raw, "apiVersion") != expected || str(raw, "kind") != t.Kind || !validName(n) || str(m, "uid") == "" || str(m, "resourceVersion") == "" || name != "" && n != name || namespace != "" && ns != namespace || t.Namespaced && ns == "" || !t.Namespaced && ns != "" {
		return httpx.Fail(503, "kubernetes_invalid_response", "Kubernetes 返回了不匹配的资源身份")
	}
	return nil
}
func scope(x snapshot, t ResourceType, q url.Values, action, verb string, named bool) error {
	ns := q.Get("namespace")
	if ns != "" && !platform.DNSName(ns, 63) {
		return httpx.Invalid("namespace 无效")
	}
	if !t.Namespaced && ns != "" {
		return httpx.Invalid("集群作用域资源不能指定 namespace")
	}
	if named && t.Namespaced && ns == "" {
		return httpx.Invalid("读取对象必须指定 namespace")
	}
	if named && !validName(q.Get("name")) {
		return httpx.Invalid("资源名称无效")
	}
	for _, k := range []string{"uid", "resourceVersion"} {
		if len(q.Get(k)) > 256 || strings.ContainsAny(q.Get(k), "\x00\r\n") {
			return httpx.Invalid("资源身份参数无效")
		}
	}
	if !x.allows(t.key(), ns, action, t.Namespaced) {
		return httpx.NotFound()
	}
	if !slices.Contains(t.Verbs, verb) {
		return httpx.Fail(422, "resource_verb_unavailable", "该资源不支持请求的读取动作")
	}
	return nil
}

func preflight(x snapshot, q url.Values) error {
	ns := q.Get("namespace")
	key := requestedKey(q)
	if ns != "" && !x.allows(key, ns, "resource.view", true) {
		return httpx.NotFound()
	}
	if ns == "" && !x.allows(key, "", "resource.view", false) && !x.allows(key, "", "resource.view", true) {
		return httpx.NotFound()
	}
	return nil
}
func projectObject(t ResourceType, raw map[string]any) Object {
	m := obj(raw, "metadata")
	delete(m, "managedFields")
	if annotations := obj(m, "annotations"); annotations != nil {
		delete(annotations, "kubectl.kubernetes.io/last-applied-configuration")
	}
	if t.Group == "" && t.Resource == "secrets" {
		keys := []string{}
		for key := range obj(raw, "data") {
			keys = append(keys, key)
		}
		for key := range obj(raw, "stringData") {
			if !slices.Contains(keys, key) {
				keys = append(keys, key)
			}
		}
		sort.Strings(keys)
		// Only metadata, Secret type and key names cross this boundary. Annotations can contain plaintext.
		delete(m, "annotations")
		raw = map[string]any{"apiVersion": raw["apiVersion"], "kind": raw["kind"], "metadata": m, "type": raw["type"], "keys": keys}
	}
	status := str(obj(raw, "status"), "phase")
	if status == "" {
		conditions, _ := obj(raw, "status")["conditions"].([]any)
		for _, desired := range []string{"Failed", "Complete", "Ready", "Available", "Progressing"} {
			for _, v := range conditions {
				c, _ := v.(map[string]any)
				if str(c, "type") == desired && str(c, "status") == "True" {
					status = desired
					break
				}
			}
			if status != "" {
				break
			}
		}
	}
	if status == "" {
		status = "unknown"
	}
	manifest, _ := json.MarshalIndent(raw, "", "  ") // JSON is a valid YAML 1.2 manifest, without lossy conversion.
	return Object{Ref{t.Group, t.Version, t.Resource, str(m, "namespace"), str(m, "name"), str(m, "uid"), str(m, "resourceVersion")}, str(raw, "kind"), status, string(manifest), raw, []Ref{}}
}

type ownerResolver struct {
	ctx   context.Context
	c     *kubernetes.Client
	cache map[string][]ResourceType
}

func (r *ownerResolver) refs(raw map[string]any) ([]Ref, error) {
	owners, _ := obj(raw, "metadata")["ownerReferences"].([]any)
	out := []Ref{}
	if len(owners) > 8 {
		return nil, httpx.Fail(503, "resource_read_limit", "对象归属引用超过读取预算")
	}
	for _, owner := range owners {
		o, _ := owner.(map[string]any)
		api := strings.Split(str(o, "apiVersion"), "/")
		g, v := "", ""
		if len(api) == 1 {
			v = api[0]
		} else if len(api) == 2 {
			g, v = api[0], api[1]
		} else {
			continue
		}
		if !validGroup(g) || !validSegment(v, 63) || !validName(str(o, "name")) {
			continue
		}
		key := g + "/" + v
		ts, ok := r.cache[key]
		if !ok {
			if len(r.cache) >= 16 {
				return nil, httpx.Fail(503, "resource_read_limit", "对象归属 API 组超过读取预算")
			}
			var err error
			ts, err = types(r.ctx, r.c, g, v)
			if err != nil {
				var api *httpx.Error
				if !errors.As(err, &api) || api.Status != 404 {
					return nil, err
				}
				ts = nil
			}
			r.cache[key] = ts
		}
		for _, ot := range ts {
			if ot.Kind == str(o, "kind") {
				ns := ""
				if ot.Namespaced {
					ns = str(obj(raw, "metadata"), "namespace")
				}
				out = append(out, Ref{g, v, ot.Resource, ns, str(o, "name"), str(o, "uid"), ""})
				break
			}
		}
	}
	return out, nil
}
func (s *Service) Get(ctx context.Context, a auth.Actor, id string, q url.Values) (Object, error) {
	x, c, err := s.client(ctx, a, id, requestedKey(q), "resource.view")
	if err != nil {
		return Object{}, err
	}
	defer c.Close()
	if err = preflight(x, q); err != nil {
		return Object{}, err
	}
	t, err := resolve(ctx, c, q)
	if err != nil {
		return Object{}, err
	}
	if err = scope(x, t, q, "resource.view", "get", true); err != nil {
		return Object{}, err
	}
	var raw map[string]any
	if err = c.Get(ctx, t.path(q.Get("namespace"), q.Get("name")), nil, &raw); err != nil {
		return Object{}, err
	}
	if err = validateObject(t, raw, q.Get("namespace"), q.Get("name")); err != nil {
		return Object{}, err
	}
	if err = checkIdentity(raw, q); err != nil {
		return Object{}, err
	}
	out := projectObject(t, raw)
	resolver := ownerResolver{ctx, c, map[string][]ResourceType{}}
	out.OwnerRefs, err = resolver.refs(raw)
	if err != nil {
		return Object{}, err
	}
	return out, s.recheck(ctx, a, x)
}

type cursor struct {
	Scope    string `json:"s"`
	Upstream string `json:"c"`
	Expires  int64  `json:"e"`
}

func (s *Service) cursorScope(a auth.Actor, x snapshot, t ResourceType, q url.Values, limit int) string {
	b, _ := json.Marshal([]any{a.ID, a.TokenVersion, x.cluster.ID, x.cluster.CredentialID, x.credential.Version, x.fingerprint, t.Group, t.Version, t.Resource, q.Get("namespace"), q.Get("labelSelector"), q.Get("fieldSelector"), limit})
	m := hmac.New(sha256.New, s.signingKey)
	m.Write(b)
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}
func (s *Service) sealCursor(c cursor) string {
	b, _ := json.Marshal(c)
	m := hmac.New(sha256.New, s.signingKey)
	m.Write(b)
	return base64.RawURLEncoding.EncodeToString(b) + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}
func (s *Service) openCursor(token, scope string) (string, error) {
	fail := httpx.Fail(409, "continue_scope_changed", "分页查询范围或授权已变化，请重新查询")
	if len(token) > 32768 {
		return "", httpx.Invalid("分页令牌过长")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return "", fail
	}
	b, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil {
		return "", fail
	}
	sig, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil {
		return "", fail
	}
	m := hmac.New(sha256.New, s.signingKey)
	m.Write(b)
	if !hmac.Equal(sig, m.Sum(nil)) {
		return "", fail
	}
	var c cursor
	if json.Unmarshal(b, &c) != nil || c.Scope != scope {
		return "", fail
	}
	if c.Expires < time.Now().Unix() {
		return "", httpx.Fail(410, "continue_expired", "分页令牌已过期")
	}
	return c.Upstream, nil
}
func (s *Service) List(ctx context.Context, a auth.Actor, id string, q url.Values) (List, error) {
	out := List{Items: []Object{}}
	limit := 100
	var err error
	if v := q.Get("limit"); v != "" {
		limit, err = strconv.Atoi(v)
		if err != nil || limit < 1 || limit > 500 {
			return out, httpx.Invalid("limit 必须为 1–500")
		}
	}
	for _, k := range []string{"labelSelector", "fieldSelector"} {
		if len(q.Get(k)) > 2048 || strings.ContainsAny(q.Get(k), "\x00\r\n") {
			return out, httpx.Invalid("selector 无效或过长")
		}
	}
	x, c, err := s.client(ctx, a, id, requestedKey(q), "resource.view")
	if err != nil {
		return out, err
	}
	defer c.Close()
	if err = preflight(x, q); err != nil {
		return out, err
	}
	t, err := resolve(ctx, c, q)
	if err != nil {
		return out, err
	}
	if err = scope(x, t, q, "resource.view", "list", false); err != nil {
		return out, err
	}
	upstream := url.Values{"limit": {strconv.Itoa(limit)}}
	for _, k := range []string{"labelSelector", "fieldSelector"} {
		if q.Get(k) != "" {
			upstream.Set(k, q.Get(k))
		}
	}
	binding := s.cursorScope(a, x, t, q, limit)
	if token := q.Get("continueToken"); token != "" {
		v, e := s.openCursor(token, binding)
		if e != nil {
			return out, e
		}
		upstream.Set("continue", v)
	}
	var list kubeList
	if err = c.Get(ctx, t.path(q.Get("namespace"), ""), upstream, &list); err != nil {
		return out, err
	}
	if len(list.Items) > limit {
		return out, httpx.Fail(503, "resource_read_limit", "Kubernetes 未遵守分页预算")
	}
	resolver := ownerResolver{ctx, c, map[string][]ResourceType{}}
	for _, raw := range list.Items {
		// Kubernetes typed lists may omit each item's TypeMeta; the requested GVR
		// and discovery Kind supply that context. Explicit conflicting types still fail.
		if str(raw, "apiVersion") == "" {
			api := t.Version
			if t.Group != "" {
				api = t.Group + "/" + t.Version
			}
			raw["apiVersion"] = api
		}
		if str(raw, "kind") == "" {
			raw["kind"] = t.Kind
		}
		if err = validateObject(t, raw, q.Get("namespace"), ""); err != nil {
			return out, err
		}
		item := projectObject(t, raw)
		item.OwnerRefs, err = resolver.refs(raw)
		if err != nil {
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	out.ResourceVersion = list.Metadata.ResourceVersion
	if list.Metadata.Continue != "" {
		if len(list.Metadata.Continue) > 8192 {
			return out, httpx.Fail(503, "resource_read_limit", "Kubernetes 分页令牌过长")
		}
		token := s.sealCursor(cursor{binding, list.Metadata.Continue, time.Now().Add(10 * time.Minute).Unix()})
		out.ContinueToken = &token
	}
	return out, s.recheck(ctx, a, x)
}

type Namespace struct {
	Name  string `json:"name"`
	UID   string `json:"uid"`
	Phase string `json:"phase"`
}

func (s *Service) Namespaces(ctx context.Context, a auth.Actor, id string) ([]Namespace, error) {
	x, c, err := s.client(ctx, a, id, "", "resource.view")
	if err != nil {
		return nil, err
	}
	defer c.Close()
	out := []Namespace{}
	exact := []string{}
	all := x.admin
	for _, g := range x.grants {
		if !slices.Contains(g.Actions, "resource.view") {
			continue
		}
		if g.Namespace == "*" || g.Namespace == "" && (slices.Contains(g.Resources, "*") || slices.Contains(g.Resources, "core/namespaces")) {
			all = true
		}
		if g.Namespace != "" && g.Namespace != "*" && !slices.Contains(exact, g.Namespace) {
			exact = append(exact, g.Namespace)
		}
	}
	add := func(raw map[string]any) {
		m := obj(raw, "metadata")
		out = append(out, Namespace{str(m, "name"), str(m, "uid"), str(obj(raw, "status"), "phase")})
	}
	if all {
		query := url.Values{"limit": {"500"}}
		for i := 0; i < 20; i++ {
			var list kubeList
			if err = c.Get(ctx, "/api/v1/namespaces", query, &list); err != nil {
				return nil, err
			}
			for _, r := range list.Items {
				add(r)
			}
			if list.Metadata.Continue == "" {
				break
			}
			if i == 19 {
				return nil, httpx.Fail(503, "resource_read_limit", "Namespace 数量超过读取预算")
			}
			query.Set("continue", list.Metadata.Continue)
		}
	} else {
		sort.Strings(exact)
		if len(exact) > 500 {
			return nil, httpx.Fail(503, "resource_read_limit", "Namespace 授权超过读取预算")
		}
		for _, ns := range exact {
			var raw map[string]any
			if err = c.Get(ctx, "/api/v1/namespaces/"+ns, nil, &raw); err != nil {
				return nil, err
			}
			add(raw)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, s.recheck(ctx, a, x)
}

type Event struct {
	Type       string     `json:"type"`
	Reason     string     `json:"reason"`
	Message    string     `json:"message"`
	Count      int64      `json:"count"`
	LastSeenAt *time.Time `json:"lastSeenAt"`
}

func (s *Service) Events(ctx context.Context, a auth.Actor, id string, q url.Values) ([]Event, error) {
	x, c, err := s.client(ctx, a, id, requestedKey(q), "resource.view")
	if err != nil {
		return nil, err
	}
	defer c.Close()
	if err = preflight(x, q); err != nil {
		return nil, err
	}
	t, err := resolve(ctx, c, q)
	if err != nil {
		return nil, err
	}
	if err = scope(x, t, q, "resource.view", "get", true); err != nil {
		return nil, err
	}
	ns := q.Get("namespace")
	if !x.allows("core/events", ns, "resource.view", true) {
		return nil, httpx.NotFound()
	}
	var target map[string]any
	if err = c.Get(ctx, t.path(ns, q.Get("name")), nil, &target); err != nil {
		return nil, err
	}
	if err = validateObject(t, target, ns, q.Get("name")); err != nil {
		return nil, err
	}
	if err = checkIdentity(target, q); err != nil {
		return nil, err
	}
	uid := str(obj(target, "metadata"), "uid")
	if uid == "" || strings.ContainsAny(uid, ",=\r\n") {
		return nil, httpx.Fail(503, "kubernetes_invalid_response", "资源缺少有效 UID")
	}
	query := url.Values{"fieldSelector": {"involvedObject.uid=" + uid}, "limit": {"500"}}
	out := []Event{}
	et := ResourceType{Version: "v1", Resource: "events", Namespaced: true}
	for i := 0; i < 10; i++ {
		var list kubeList
		if err = c.Get(ctx, et.path(ns, ""), query, &list); err != nil {
			return nil, err
		}
		if len(list.Items) > 500 {
			return nil, httpx.Fail(503, "resource_read_limit", "事件响应超过读取预算")
		}
		for _, r := range list.Items {
			count, _ := r["count"].(float64)
			last := str(r, "lastTimestamp")
			if last == "" {
				last = str(r, "eventTime")
			}
			if last == "" {
				last = str(obj(r, "series"), "lastObservedTime")
			}
			var seen *time.Time
			if ts, e := time.Parse(time.RFC3339Nano, last); e == nil {
				seen = &ts
			}
			out = append(out, Event{str(r, "type"), str(r, "reason"), str(r, "message"), int64(count), seen})
		}
		if list.Metadata.Continue == "" {
			break
		}
		if i == 9 {
			return nil, httpx.Fail(503, "resource_read_limit", "对象事件数量超过读取预算")
		}
		query.Set("continue", list.Metadata.Continue)
	}
	// Detect a same-name replacement while events were read.
	var current map[string]any
	if err = c.Get(ctx, t.path(ns, q.Get("name")), nil, &current); err != nil {
		return nil, err
	}
	if str(obj(current, "metadata"), "uid") != uid {
		return nil, httpx.Fail(409, "resource_identity_changed", "事件查询期间对象已被替换")
	}
	return out, s.recheck(ctx, a, x)
}
