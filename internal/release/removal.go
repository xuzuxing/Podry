package release

import (
	"context"
	"net/url"
	"sort"

	"github.com/xuzuxing/podry/internal/kubernetes"
	helmrelease "helm.sh/helm/v3/pkg/release"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// Every deletion is conditional on its captured UID and freshly read RV.
// Worker steps may resume conditional deletion; explicit Observe is read-only.
func (h *Helm) remove(ctx context.Context, in Input, submit bool) (Observation, error) {
	o := Observation{State: "unknown", Code: "release_removal_unconfirmed"}
	p := in.Plan
	removal := p.Removal
	refs, err := Objects(p)
	if err != nil || removal == nil || len(refs) != len(removal.Resources) {
		return o, err
	}
	sort.SliceStable(refs, func(i, j int) bool {
		return (refs[i].Kind == "Deployment" || refs[i].Kind == "Job") && refs[j].Kind != "Deployment" && refs[j].Kind != "Job"
	})
	source := in
	source.Plan.DeploymentID = removal.DeploymentID
	source.Hash = removal.SnapshotSHA256
	cfg, err := h.config(ctx, in)
	if err != nil {
		return o, err
	}
	r, err := cfg.Releases.Last(p.Target.ReleaseName)
	if err != nil {
		return o, err
	}
	if !ownedRelease(r, source) || int32(r.Version) != removal.HelmRevision {
		o.Code = "release_resource_identity_conflict"
		return o, nil
	}
	o.Revision = &removal.HelmRevision
	client, err := kubernetes.New(in.Cluster)
	if err != nil {
		return o, err
	}
	defer client.Close()
	allGone := true
	for _, ref := range refs {
		var known *Resource
		for i := range removal.Resources {
			k := &removal.Resources[i]
			if k.APIVersion == ref.APIVersion && k.Kind == ref.Kind && k.Name == ref.Name && k.Namespace == ref.Namespace {
				known = k
				break
			}
		}
		if known == nil || known.UID == "" {
			return o, nil
		}
		path, _ := resourcePath(ref)
		var live unstructured.Unstructured
		err = client.Get(ctx, path, nil, &live)
		if kubernetes.IsMissing(err) {
			continue
		}
		if err != nil {
			return o, err
		}
		if string(live.GetUID()) != known.UID || !owned(&live, source.Plan) || live.GetAPIVersion() != ref.APIVersion || live.GetKind() != ref.Kind || live.GetNamespace() != ref.Namespace || live.GetName() != ref.Name {
			o.Code = "release_resource_identity_conflict"
			return o, nil
		}
		if !submit {
			allGone = false
			continue
		}
		if ref.Kind == "Secret" {
			if err = client.SecretUnused(ctx, ref.Namespace, ref.Name); err != nil {
				return o, err
			}
		}
		if err = client.DeleteCollected(ctx, path, &live); err != nil {
			return o, err
		}
	}
	// Foreground cascading and a bounded complete Pod inventory ensure stopping
	// the root workload also stops application Pods, including previous revisions.
	var pods unstructured.UnstructuredList
	if err = client.Get(ctx, "/api/v1/namespaces/"+p.Target.Namespace+"/pods", url.Values{"labelSelector": {"podry.io/binding-id=" + p.BindingID}, "limit": {"200"}}, &pods); err != nil {
		return o, err
	}
	if pods.GetContinue() != "" || pods.GetKind() != "PodList" || pods.GetAPIVersion() != "v1" || pods.Items == nil || len(pods.Items) > 200 {
		return o, nil
	}
	if r.Info != nil && r.Info.Status == helmrelease.StatusUninstalled && allGone && len(pods.Items) == 0 {
		o.State, o.Code = "succeeded", ""
		return o, nil
	}
	if !submit || !allGone || len(pods.Items) != 0 {
		return o, nil
	}
	if r.Info == nil || r.Info.Status != helmrelease.StatusDeployed {
		return o, nil
	}
	// Managed objects are already confirmed gone. Do not let Helm issue a second,
	// unconditional batch delete against names which could have been reused.
	r.Info.Status = helmrelease.StatusUninstalled
	r.Info.Description = "Uninstalled by Podry after UID-conditional deletion"
	if err = cfg.Releases.Update(r); err != nil {
		return o, err
	}
	return h.remove(ctx, in, false)
}
