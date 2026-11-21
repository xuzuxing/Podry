package resource

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/kubernetes"
)

// Root is a previously recorded Kubernetes identity, never a label selector.
type Root struct {
	APIVersion, Kind, Namespace, Name, UID string
}

type Owned struct {
	Items             []Object
	Missing           []Root
	Filtered          bool
	ObservedAt        time.Time
	CredentialID      string
	CredentialVersion int32
	stamp             snapshot
}

func rootType(r Root) (ResourceType, error) {
	var g, v, plural string
	parts := strings.Split(r.APIVersion, "/")
	if len(parts) == 1 {
		v = parts[0]
	} else if len(parts) == 2 {
		g, v = parts[0], parts[1]
	}
	switch r.APIVersion + "/" + r.Kind {
	case "apps/v1/Deployment":
		plural = "deployments"
	case "apps/v1/ReplicaSet":
		plural = "replicasets"
	case "batch/v1/Job":
		plural = "jobs"
	case "v1/Pod":
		plural = "pods"
	case "v1/Secret":
		plural = "secrets"
	case "v1/Service":
		plural = "services"
	case "networking.k8s.io/v1/Ingress":
		plural = "ingresses"
	default:
		return ResourceType{}, httpx.Fail(503, "release_resource_invalid", "发布资源类型无效")
	}
	if !validName(r.Name) || !validSegment(r.Namespace, 63) || r.UID == "" {
		return ResourceType{}, httpx.Fail(409, "resource_identity_unconfirmed", "资源尚未捕获可核对的 UID")
	}
	return ResourceType{Group: g, Version: v, Resource: plural, Kind: r.Kind, Namespaced: true, Verbs: []string{"get", "list"}}, nil
}

func statusCode(err error, status int) bool {
	var api *httpx.Error
	return errors.As(err, &api) && api.Status == status
}

// ReadOwned shares the browsing authorization snapshot and Secret projection.
// Missing recorded objects are distinct from filtered objects and read failures.
// A replacement UID aborts the read; mutable application labels confer no ownership.
func (s *Service) ReadOwned(ctx context.Context, a auth.Actor, cluster string, roots []Root, strict, descendants bool) (Owned, error) {
	out := Owned{Items: []Object{}, Missing: []Root{}}
	if len(roots) > 64 {
		return out, httpx.Fail(503, "resource_read_limit", "应用根资源超过读取预算")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	x, err := s.snapshot(ctx, a, cluster, false)
	if err != nil {
		return out, err
	}
	visible := []Root{}
	for _, r := range roots {
		t, e := rootType(r)
		if e != nil {
			return out, e
		}
		if !x.allows(t.key(), r.Namespace, "resource.view", true) {
			if strict {
				return out, httpx.NotFound()
			}
			out.Filtered = true
			continue
		}
		visible = append(visible, r)
	}
	if !x.any("", "resource.view") {
		return out, httpx.NotFound()
	}
	// Do not decrypt cluster credentials or issue requests for filtered roots.
	if len(visible) == 0 {
		out.stamp = x
		return out, s.recheck(ctx, a, x)
	}
	y, err := s.snapshot(ctx, a, cluster, true)
	if err != nil {
		return out, err
	}
	if x.fingerprint != y.fingerprint {
		return out, httpx.Fail(409, "revision_conflict", "资源授权已变化")
	}
	c, err := kubernetes.New(y.payload)
	if err != nil {
		return out, err
	}
	defer c.Close()
	out.stamp, out.CredentialID, out.CredentialVersion = y, y.credential.ID, y.credential.Version
	// Start time is the conservative cache timestamp, not the end of a long read.
	out.ObservedAt = time.Now().UTC()
	resolver := ownerResolver{ctx, c, map[string][]ResourceType{}}
	live := []Root{}
	for _, r := range visible {
		t, _ := rootType(r)
		var raw map[string]any
		if err = c.Get(ctx, t.path(r.Namespace, r.Name), nil, &raw); err != nil {
			if statusCode(err, 404) {
				out.Missing = append(out.Missing, r)
				continue
			}
			return out, err
		}
		if err = validateObject(t, raw, r.Namespace, r.Name); err != nil {
			return out, err
		}
		if err = checkIdentity(raw, url.Values{"uid": {r.UID}}); err != nil {
			return out, err
		}
		item := projectObject(t, raw)
		item.OwnerRefs, err = resolver.refs(raw)
		if err != nil {
			return out, err
		}
		out.Items = append(out.Items, item)
		live = append(live, r)
	}
	if descendants {
		parents := map[string]Root{}
		namespaces := map[string]bool{}
		for _, r := range live {
			if r.Kind == "Deployment" || r.Kind == "Job" {
				parents[r.UID] = r
				namespaces[r.Namespace] = true
			}
		}
		// Fixed controller edges keep discovery and object traversal bounded.
		for _, child := range []Root{{APIVersion: "apps/v1", Kind: "ReplicaSet"}, {APIVersion: "v1", Kind: "Pod"}} {
			for ns := range namespaces {
				child.Namespace, child.Name, child.UID = ns, "placeholder", "placeholder"
				t, _ := rootType(child)
				if !y.allows(t.key(), ns, "resource.view", true) {
					out.Filtered = true
					continue
				}
				query := url.Values{"limit": {"200"}}
				for page := 0; ; page++ {
					if page >= 10 {
						return out, httpx.Fail(503, "resource_read_limit", "后代资源超过分页预算")
					}
					var list kubeList
					if err = c.Get(ctx, t.path(ns, ""), query, &list); err != nil {
						return out, err
					}
					if len(list.Items) > 200 {
						return out, httpx.Fail(503, "resource_read_limit", "后代资源超过读取预算")
					}
					for _, raw := range list.Items {
						if str(raw, "apiVersion") == "" {
							raw["apiVersion"] = child.APIVersion
						}
						if str(raw, "kind") == "" {
							raw["kind"] = child.Kind
						}
						if err = validateObject(t, raw, ns, ""); err != nil {
							return out, err
						}
						if !controllerChild(raw, parents, child.Kind) {
							continue
						}
						item := projectObject(t, raw)
						item.OwnerRefs, err = resolver.refs(raw)
						if err != nil {
							return out, err
						}
						out.Items = append(out.Items, item)
						parents[item.Ref.UID] = Root{child.APIVersion, child.Kind, ns, item.Ref.Name, item.Ref.UID}
						if len(out.Items) > 1000 {
							return out, httpx.Fail(503, "resource_read_limit", "应用资源超过读取预算")
						}
					}
					if list.Metadata.Continue == "" {
						break
					}
					query.Set("continue", list.Metadata.Continue)
				}
			}
		}
	}
	// Recheck roots after traversal: no response can associate children with a
	// same-name replacement that appeared while the descendant lists were read.
	for _, r := range live {
		t, _ := rootType(r)
		var raw map[string]any
		if err = c.Get(ctx, t.path(r.Namespace, r.Name), nil, &raw); err != nil {
			return out, err
		}
		if err = validateObject(t, raw, r.Namespace, r.Name); err != nil {
			return out, err
		}
		if err = checkIdentity(raw, url.Values{"uid": {r.UID}}); err != nil {
			return out, err
		}
	}
	sort.Slice(out.Items, func(i, j int) bool { return objectKey(out.Items[i]) < objectKey(out.Items[j]) })
	return out, s.recheck(ctx, a, y)
}

func controllerChild(raw map[string]any, parents map[string]Root, kind string) bool {
	owners, _ := obj(raw, "metadata")["ownerReferences"].([]any)
	for _, v := range owners {
		o, _ := v.(map[string]any)
		p, ok := parents[str(o, "uid")]
		if !ok || o["controller"] != true || str(o, "apiVersion") != p.APIVersion || str(o, "kind") != p.Kind || str(o, "name") != p.Name || str(obj(raw, "metadata"), "namespace") != p.Namespace {
			continue
		}
		if kind == "ReplicaSet" && p.Kind == "Deployment" || kind == "Pod" && (p.Kind == "ReplicaSet" || p.Kind == "Job") {
			return true
		}
	}
	return false
}

// AuthorizeOwned checks cached comparison visibility without decrypting a credential
// or issuing network requests. The returned stamp must be rechecked before use.
func (s *Service) AuthorizeOwned(ctx context.Context, a auth.Actor, cluster string, roots []Root) (Owned, error) {
	out := Owned{}
	x, err := s.snapshot(ctx, a, cluster, false)
	if err != nil {
		return out, err
	}
	if !x.any("", "resource.view") {
		return out, httpx.NotFound()
	}
	for _, r := range roots {
		t, e := rootType(r)
		if e != nil {
			return out, e
		}
		if !x.allows(t.key(), r.Namespace, "resource.view", true) {
			return out, httpx.NotFound()
		}
	}
	out.stamp = x
	return out, s.recheck(ctx, a, x)
}

func (s *Service) RecheckOwned(ctx context.Context, a auth.Actor, out Owned) error {
	return s.recheck(ctx, a, out.stamp)
}

// RecheckOwnedQuery closes the final authorization window inside the caller's
// transaction. Cluster/grant mutation stays blocked until its observation commits.
func (s *Service) RecheckOwnedQuery(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, out Owned) error {
	now, err := s.snapshotQuery(ctx, q, a, out.stamp.cluster.ID, false)
	if err != nil {
		return err
	}
	return recheckSnapshot(out.stamp, now)
}

func objectKey(o Object) string {
	return o.Ref.Group + "/" + o.Ref.Version + "/" + o.Kind + "/" + o.Ref.Namespace + "/" + o.Ref.Name
}

// DiffManifest normalizes both sides with the same projection. Secret values,
// last-applied data, and server bookkeeping never enter a returned diff.
func DiffManifest(objects []map[string]any) (string, error) {
	items := []Object{}
	for _, raw := range objects {
		data, err := json.Marshal(raw)
		if err != nil {
			return "", err
		}
		var copy map[string]any
		if err = json.Unmarshal(data, &copy); err != nil {
			return "", err
		}
		m := obj(copy, "metadata")
		for _, key := range []string{"uid", "resourceVersion", "generation", "creationTimestamp", "managedFields", "selfLink"} {
			delete(m, key)
		}
		delete(copy, "status")
		t, err := rootType(Root{str(copy, "apiVersion"), str(copy, "kind"), str(m, "namespace"), str(m, "name"), "diff"})
		if err != nil {
			return "", err
		}
		// Live Secret objects may already have crossed the redaction boundary.
		keys, _ := copy["keys"].([]any)
		o := projectObject(t, copy)
		if t.Resource == "secrets" && keys != nil {
			names := []string{}
			for _, key := range keys {
				if name, ok := key.(string); ok {
					names = append(names, name)
				}
			}
			slices.Sort(names)
			o.Data["keys"] = names
		}
		items = append(items, o)
	}
	sort.Slice(items, func(i, j int) bool { return objectKey(items[i]) < objectKey(items[j]) })
	parts := []string{}
	for _, o := range items {
		b, err := json.MarshalIndent(o.Data, "", "  ")
		if err != nil {
			return "", err
		}
		parts = append(parts, string(b))
	}
	return strings.Join(parts, "\n---\n"), nil
}
