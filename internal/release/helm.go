package release

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/kubernetes"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	helmrelease "helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage/driver"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	clientapi "k8s.io/client-go/tools/clientcmd/api"
)

// Helm uses only restricted inline credentials and the archived chart. It never
// loads local kubeconfig, executes auth plugins, creates namespaces or rolls back.
type Helm struct {
	configure func(context.Context, Input) (*action.Configuration, error)
}

func NewHelm() *Helm { return &Helm{} }

func (h *Helm) config(ctx context.Context, in Input) (*action.Configuration, error) {
	if h.configure != nil {
		return h.configure(ctx, in)
	}
	return configuration(ctx, in)
}

type getter struct {
	config    *rest.Config
	namespace string
	discovery discovery.CachedDiscoveryInterface
	mapper    meta.RESTMapper
}

func newGetter(config *rest.Config, namespace string) (getter, error) {
	client, err := discovery.NewDiscoveryClientForConfig(config)
	if err != nil {
		return getter{}, err
	}
	cache := memory.NewMemCacheClient(client)
	return getter{config: config, namespace: namespace, discovery: cache, mapper: restmapper.NewDeferredDiscoveryRESTMapper(cache)}, nil
}

func (g getter) ToRESTConfig() (*rest.Config, error) { return rest.CopyConfig(g.config), nil }
func (g getter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	return g.discovery, nil
}
func (g getter) ToRESTMapper() (meta.RESTMapper, error) {
	return g.mapper, nil
}
func (g getter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	// Namespace is the only value Helm reads through this accessor. REST clients
	// are built through ToRESTConfig, so no ambient kubeconfig can be consulted.
	raw := clientapi.Config{CurrentContext: "podry", Contexts: map[string]*clientapi.Context{"podry": {Namespace: g.namespace}}}
	return clientcmd.NewNonInteractiveClientConfig(raw, "podry", &clientcmd.ConfigOverrides{Context: clientapi.Context{Namespace: g.namespace}}, nil)
}

func configuration(ctx context.Context, in Input) (*action.Configuration, error) {
	p, err := credential.ParseKubernetes(in.Cluster)
	if err != nil {
		return nil, err
	}
	decode := func(key string) []byte {
		s, _ := in.Cluster[key].(string)
		b, _ := base64.StdEncoding.DecodeString(s)
		return b
	}
	ca := p.CAData
	// client-go rejects CAData together with Insecure, while imported kubeconfig
	// credentials may legitimately retain both. The explicit skip flag wins.
	if p.InsecureSkipTLSVerify {
		ca = nil
	}
	cfg := &rest.Config{Host: p.APIServer, BearerToken: p.Token, Timeout: 8 * time.Second, TLSClientConfig: rest.TLSClientConfig{Insecure: p.InsecureSkipTLSVerify, CAData: ca, CertData: decode("clientCertificateData"), KeyData: decode("clientKeyData")}, UserAgent: "Podry/release"}
	cfg.WrapTransport = func(base http.RoundTripper) http.RoundTripper {
		return tracedTransport{base: boundTransport{ctx, base}, deploymentID: in.Plan.DeploymentID}
	}
	// Share discovery and mappings across Helm's repeated manifest builds in this
	// fenced step. A later step gets a fresh cache and its own bound context.
	g, err := newGetter(cfg, in.Plan.Target.Namespace)
	if err != nil {
		return nil, err
	}
	a := new(action.Configuration)
	err = a.Init(g, in.Plan.Target.Namespace, "secret", func(string, ...interface{}) {})
	return a, err
}
func marker(in Input) string { return "podry:" + in.Plan.DeploymentID + ":" + in.Hash }
func ownedRelease(r *helmrelease.Release, in Input) bool {
	if r == nil || r.Info == nil || r.Name != in.Plan.Target.ReleaseName || r.Namespace != in.Plan.Target.Namespace {
		return false
	}
	reserved, _ := r.Config["podry"].(map[string]any)
	// Helm overwrites Description while pending/failed. Values retain this
	// identity from the first persisted revision, including partial submissions.
	return reserved["appId"] == in.Plan.AppID && reserved["bindingId"] == in.Plan.BindingID && reserved["deploymentId"] == in.Plan.DeploymentID && reserved["snapshotSHA256"] == in.Hash
}
func priorRelease(r *helmrelease.Release, in Input) bool {
	if r == nil || r.Info == nil || (r.Info.Status != helmrelease.StatusDeployed && r.Info.Status != helmrelease.StatusUninstalled) || r.Name != in.Plan.Target.ReleaseName || r.Namespace != in.Plan.Target.Namespace {
		return false
	}
	podry, _ := r.Config["podry"].(map[string]any)
	return podry["appId"] == in.Plan.AppID && podry["bindingId"] == in.Plan.BindingID
}
func (h *Helm) Submit(ctx context.Context, in Input) (result Observation, resultErr error) {
	if in.Plan.Removal != nil {
		return h.remove(ctx, in, true)
	}
	start, phase, operation := time.Now(), "validation", "none"
	var actionErr error
	defer func() {
		level := slog.LevelInfo
		if result.State == "unknown" || resultErr != nil {
			level = slog.LevelWarn
		}
		// Raw Helm errors can contain rendered Secret data. Persist only bounded
		// classifications; the phase identifies which part needs investigation.
		slog.Log(ctx, level, "release submission finished", "deployment_id", in.Plan.DeploymentID,
			"phase", phase, "operation", operation, "state", result.State, "code", result.Code,
			"action_error", safeErrorClass(actionErr), "returned_error", safeErrorClass(resultErr),
			"context_error", safeErrorClass(ctx.Err()), "duration_ms", time.Since(start).Milliseconds())
	}()
	unknown := Observation{State: "unknown", Code: "release_outcome_unknown"}
	if _, err := Objects(in.Plan); err != nil {
		return Observation{State: "failed", Code: "release_snapshot_invalid"}, nil
	}
	phase = "configuration"
	cfg, err := h.config(ctx, in)
	if err != nil {
		actionErr = err
		return unknown, err
	}
	phase = "history"
	prior, err := cfg.Releases.Last(in.Plan.Target.ReleaseName)
	if err != nil && !errors.Is(err, driver.ErrReleaseNotFound) {
		actionErr = err
		return unknown, err
	}
	if prior != nil && ownedRelease(prior, in) {
		phase = "observe"
		return h.Observe(ctx, in)
	}
	if prior != nil && !priorRelease(prior, in) {
		return Observation{State: "failed", Code: "release_target_conflict"}, nil
	}
	phase = "chart"
	ch, err := loader.LoadArchive(bytes.NewReader(in.Plan.Chart.Package))
	if err != nil {
		return Observation{State: "failed", Code: "release_snapshot_invalid"}, nil
	}
	reserved, ok := in.Values["podry"].(map[string]any)
	if !ok {
		return Observation{State: "failed", Code: "release_snapshot_invalid"}, nil
	}
	reserved["snapshotSHA256"] = in.Hash
	// Hooks and dependency downloads are disabled. Wait=false separates Helm
	// submission from controller readiness and Job completion observation.
	if prior == nil || prior.Info.Status == helmrelease.StatusUninstalled {
		phase, operation = "action", "install"
		install := action.NewInstall(cfg)
		install.ReleaseName = in.Plan.Target.ReleaseName
		install.Replace = prior != nil
		install.Namespace = in.Plan.Target.Namespace
		install.DisableHooks = true
		// Only approved built-in charts and validated Values reach this point.
		// Downloading cluster OpenAPI can exceed a fenced step before any write;
		// Kubernetes still validates every object on the actual create/update.
		install.DisableOpenAPIValidation = true
		install.Wait = false
		install.CreateNamespace = false
		install.Atomic = false
		install.Timeout = 15 * time.Second
		install.Description = marker(in)
		_, err = install.RunWithContext(ctx, ch, in.Values)
	} else {
		phase, operation = "action", "upgrade"
		upgrade := action.NewUpgrade(cfg)
		upgrade.Namespace = in.Plan.Target.Namespace
		upgrade.DisableHooks = true
		upgrade.DisableOpenAPIValidation = true
		upgrade.Wait = false
		upgrade.Atomic = false
		upgrade.CleanupOnFail = false
		upgrade.Timeout = 15 * time.Second
		upgrade.Description = marker(in)
		upgrade.MaxHistory = 10
		_, err = upgrade.RunWithContext(ctx, in.Plan.Target.ReleaseName, ch, in.Values)
	}
	actionErr = err
	// Even a returned error may follow a partial write. Observe identities before
	// recording anything; never persist Helm's raw error or decrypted manifest.
	phase = "observe"
	o, observeErr := h.Observe(ctx, in)
	if err != nil {
		o.State = "unknown"
		o.Code = "release_outcome_unknown"
	}
	return o, observeErr
}
func (h *Helm) Observe(ctx context.Context, in Input) (Observation, error) {
	if in.Plan.Removal != nil {
		return h.remove(ctx, in, false)
	}
	o := Observation{State: "unknown", Code: "release_outcome_unknown"}
	refs, err := Objects(in.Plan)
	if err != nil {
		return o, err
	}
	cfg, err := h.config(ctx, in)
	if err != nil {
		return o, err
	}
	r, helmErr := cfg.Releases.Last(in.Plan.Target.ReleaseName)
	helmSettled := false
	if helmErr == nil && ownedRelease(r, in) {
		revision := int32(r.Version)
		o.Revision = &revision
		if in.Revision != nil && *in.Revision != revision {
			// Keep the first observed revision as the comparison baseline. Saving
			// the conflicting revision would silently accept it on the next poll.
			o.Revision = in.Revision
			o.Code = "release_revision_conflict"
		} else {
			helmSettled = r.Info.Status == helmrelease.StatusDeployed
		}
	}
	client, err := kubernetes.New(in.Cluster)
	if err != nil {
		return o, err
	}
	defer client.Close()
	allFound := true
	identityConflict := false
	state := "observing"
	for _, ref := range refs {
		path, _ := resourcePath(ref)
		var object unstructured.Unstructured
		if err = client.Get(ctx, path, nil, &object); err != nil {
			allFound = false
			continue
		}
		if !owned(&object, in.Plan) || string(object.GetUID()) == "" || object.GetAPIVersion() != ref.APIVersion || object.GetKind() != ref.Kind || object.GetNamespace() != ref.Namespace || object.GetName() != ref.Name {
			identityConflict = true
			continue
		}
		ref.UID = string(object.GetUID())
		ref.Owners = object.GetOwnerReferences()
		ref.Generation = object.GetGeneration()
		// A replaced UID is never persisted over the captured identity.
		uidConflict := false
		for _, known := range in.Known {
			if known.APIVersion == ref.APIVersion && known.Kind == ref.Kind && known.Namespace == ref.Namespace && known.Name == ref.Name && known.UID != ref.UID {
				uidConflict = true
				identityConflict = true
			}
		}
		if uidConflict {
			continue
		}
		o.Resources = append(o.Resources, ref)
		if ref.Kind == in.Plan.WorkloadKind {
			if !imageMatches(&object, in.Plan) {
				identityConflict = true
				continue
			}
			state = workloadState(&object)
			if ref.Kind == "Job" && state == "succeeded" && !successfulPod(ctx, client, ref, in.Plan) {
				state = "observing"
			}
		}
	}
	if identityConflict {
		o.Code = "release_resource_identity_conflict"
		return o, nil
	}
	if helmSettled && allFound {
		o.State = state
		o.Code = ""
		if state == "failed" {
			o.Code = "release_workload_failed"
		}
	}
	return o, nil
}
func successfulPod(ctx context.Context, client *kubernetes.Client, job Resource, p Plan) bool {
	// Typed PodList responses may omit per-item TypeMeta. The Kubernetes list
	// decoder infers it from the enclosing list without relaxing Pod identity.
	var list unstructured.UnstructuredList
	err := client.Get(ctx, "/api/v1/namespaces/"+job.Namespace+"/pods", url.Values{"labelSelector": {"job-name=" + job.Name}, "limit": {"100"}}, &list)
	if err != nil || list.GetAPIVersion() != "v1" || list.GetKind() != "PodList" || list.GetContinue() != "" {
		return false
	}
	for _, pod := range list.Items {
		phase, _, _ := unstructured.NestedString(pod.Object, "status", "phase")
		if phase != "Succeeded" || pod.GetAPIVersion() != "v1" || pod.GetKind() != "Pod" || !owned(&pod, p) || pod.GetNamespace() != job.Namespace || pod.GetUID() == "" {
			continue
		}
		containers, _, _ := unstructured.NestedSlice(pod.Object, "spec", "containers")
		imageOK := false
		for _, item := range containers {
			container, _ := item.(map[string]any)
			if container["name"] == "app" && container["image"] == p.ImageRef {
				imageOK = true
			}
		}
		if !imageOK {
			continue
		}
		for _, owner := range pod.GetOwnerReferences() {
			if owner.Kind == "Job" && owner.APIVersion == "batch/v1" && string(owner.UID) == job.UID && owner.Controller != nil && *owner.Controller {
				return true
			}
		}
	}
	return false
}
