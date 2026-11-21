package resource

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"slices"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/kubernetes"
	"github.com/xuzuxing/podry/internal/platform"
)

type ResourceType struct {
	Group      string   `json:"group"`
	Version    string   `json:"version"`
	Resource   string   `json:"resource"`
	Kind       string   `json:"kind"`
	Namespaced bool     `json:"namespaced"`
	Verbs      []string `json:"verbs"`
	Category   string   `json:"category"`
}

func (t ResourceType) key() string {
	g := t.Group
	if g == "" {
		g = "core"
	}
	return g + "/" + t.Resource
}
func (t ResourceType) base() string {
	if t.Group == "" {
		return "/api/" + t.Version
	}
	return "/apis/" + t.Group + "/" + t.Version
}
func (t ResourceType) path(ns, name string) string {
	p := t.base()
	if ns != "" {
		p += "/namespaces/" + ns
	}
	p += "/" + t.Resource
	if name != "" {
		p += "/" + name
	}
	return p
}
func validGroup(s string) bool { return s == "" || validName(s) }
func validSegment(s string, max int) bool {
	return s != "" && !strings.ContainsAny(s, "./\\%?#") && platform.DNSName(s, max)
}
func validName(s string) bool {
	if len(s) == 0 || len(s) > 253 {
		return false
	}
	for _, p := range strings.Split(s, ".") {
		if !platform.DNSName(p, 63) {
			return false
		}
	}
	return true
}
func types(ctx context.Context, c *kubernetes.Client, group, version string) ([]ResourceType, error) {
	t := ResourceType{Group: group, Version: version}
	var list struct {
		GroupVersion string `json:"groupVersion"`
		Resources    []struct {
			Name, Kind string
			Namespaced bool
			Verbs      []string
		}
	}
	if err := c.Get(ctx, t.base(), nil, &list); err != nil {
		return nil, err
	}
	expected := version
	if group != "" {
		expected = group + "/" + version
	}
	if list.GroupVersion != expected || len(list.Resources) > 2048 {
		return nil, httpx.Fail(503, "kubernetes_invalid_response", "Kubernetes 类型发现响应无效")
	}
	out := []ResourceType{}
	for _, r := range list.Resources {
		if !validSegment(r.Name, 253) || r.Kind == "" {
			continue
		}
		out = append(out, ResourceType{group, version, r.Name, r.Kind, r.Namespaced, r.Verbs, "generic"})
	}
	return out, nil
}
func resolve(ctx context.Context, c *kubernetes.Client, q url.Values) (ResourceType, error) {
	g, v, r := q.Get("group"), q.Get("version"), q.Get("resource")
	if _, ok := q["group"]; !ok || !validGroup(g) || !validSegment(v, 63) || !validSegment(r, 253) {
		return ResourceType{}, httpx.Invalid("必须提供有效 group、version、resource；核心组 group 为空字符串")
	}
	all, err := types(ctx, c, g, v)
	if err != nil {
		return ResourceType{}, err
	}
	for _, t := range all {
		if t.Resource == r {
			return t, nil
		}
	}
	return ResourceType{}, httpx.NotFound()
}
func requestedKey(q url.Values) string {
	g := q.Get("group")
	if g == "" {
		g = "core"
	}
	return g + "/" + q.Get("resource")
}
func authorizedType(x snapshot, t ResourceType) bool {
	if x.admin {
		return true
	}
	for _, g := range x.grants {
		if x.allows(t.key(), g.Namespace, "resource.view", t.Namespaced) {
			return true
		}
	}
	return false
}
func (s *Service) Discover(ctx context.Context, a auth.Actor, id string) ([]ResourceType, error) {
	x, c, err := s.client(ctx, a, id, "", "resource.view")
	if err != nil {
		return nil, err
	}
	defer c.Close()
	var core struct{ Versions []string }
	var groups struct {
		Groups []struct {
			Name             string
			PreferredVersion struct{ Version string }
		}
	}
	if err = c.Get(ctx, "/api", nil, &core); err != nil {
		return nil, err
	}
	if err = c.Get(ctx, "/apis", nil, &groups); err != nil {
		return nil, err
	}
	if len(core.Versions)+len(groups.Groups) > 256 {
		return nil, httpx.Fail(503, "discovery_incomplete", "API 组数量超过发现预算")
	}
	targets := [][2]string{}
	for _, v := range core.Versions {
		if !validSegment(v, 63) {
			return nil, httpx.Invalid("API 版本无效")
		}
		targets = append(targets, [2]string{"", v})
	}
	for _, g := range groups.Groups {
		if !validGroup(g.Name) || g.Name == "" || !validSegment(g.PreferredVersion.Version, 63) {
			return nil, httpx.Fail(503, "kubernetes_invalid_response", "API 组发现响应无效")
		}
		targets = append(targets, [2]string{g.Name, g.PreferredVersion.Version})
	}
	// Small bounded worker pool avoids serial discovery on clusters with many CRDs.
	type result struct {
		items  []ResourceType
		err    error
		target [2]string
	}
	jobs := make(chan [2]string, len(targets))
	results := make(chan result, len(targets))
	for _, t := range targets {
		jobs <- t
	}
	close(jobs)
	workers := min(6, len(targets))
	for i := 0; i < workers; i++ {
		go func() {
			for t := range jobs {
				r, e := types(ctx, c, t[0], t[1])
				results <- result{r, e, t}
			}
		}()
	}
	out := []ResourceType{}
	failed := false
	for range targets {
		r := <-results
		if r.err != nil {
			code := "cluster_unavailable"
			var api *httpx.Error
			if errors.As(r.err, &api) {
				code = api.Code
			}
			slog.WarnContext(ctx, "Kubernetes discovery failed", "request_id", middleware.GetReqID(ctx), "group", r.target[0], "version", r.target[1], "code", code)
			failed = true
			continue
		}
		for _, t := range r.items {
			if (slices.Contains(t.Verbs, "get") || slices.Contains(t.Verbs, "list")) && authorizedType(x, t) {
				readVerbs := []string{}
				for _, v := range []string{"get", "list"} {
					if slices.Contains(t.Verbs, v) {
						readVerbs = append(readVerbs, v)
					}
				}
				t.Verbs = readVerbs
				out = append(out, t)
			}
		}
	}
	if failed {
		return nil, httpx.Fail(503, "discovery_incomplete", "部分 Kubernetes API 组不可用，请稍后重试")
	}
	sort.Slice(out, func(i, j int) bool {
		return fmt.Sprint(out[i].Group, "/", out[i].Version, "/", out[i].Resource) < fmt.Sprint(out[j].Group, "/", out[j].Version, "/", out[j].Resource)
	})
	return out, s.recheck(ctx, a, x)
}
