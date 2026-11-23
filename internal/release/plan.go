// Package release executes immutable deployment plans and reconciles their outcomes.
package release

import (
	"encoding/json"
	"errors"

	"github.com/xuzuxing/podry/internal/chart"
)

type Target struct {
	ClusterID   string `json:"clusterId"`
	Namespace   string `json:"namespace"`
	ReleaseName string `json:"releaseName"`
}
type SecretRef struct {
	CredentialID string `json:"credentialId"`
	Version      int32  `json:"version"`
	TargetKey    string `json:"targetKey"`
}
type CredentialRef struct {
	ID      string `json:"id"`
	Version int32  `json:"version"`
}

type PullCredential struct {
	CredentialRef
	Registry string `json:"registry"`
}

type RemovalPlan struct {
	DeploymentID   string     `json:"deploymentId"`
	SnapshotSHA256 string     `json:"snapshotSha256"`
	HelmRevision   int32      `json:"helmRevision"`
	Resources      []Resource `json:"resources"`
}

// Field order and JSON names are part of the v1 canonical snapshot hash.
// Runtime credentials must never be added to this persisted representation.
type Plan struct {
	SchemaVersion     int           `json:"schemaVersion"`
	DeploymentID      string        `json:"deploymentId"`
	RequestID         string        `json:"requestId"`
	AppID             string        `json:"appId"`
	BindingID         string        `json:"bindingId"`
	BindingVersion    int32         `json:"bindingVersion"`
	TargetID          string        `json:"targetId"`
	Target            Target        `json:"target"`
	ArtifactID        string        `json:"artifactId"`
	ImageRef          string        `json:"imageRef"`
	ConfigVersion     int32         `json:"configVersion"`
	WorkflowVersion   int32         `json:"workflowVersion"`
	PipelineID        string        `json:"pipelineId"`
	PipelineVersion   int32         `json:"pipelineVersion"`
	TimeoutSeconds    int           `json:"timeoutSeconds"`
	ClusterCredential CredentialRef `json:"clusterCredential"`
	WorkloadKind      string        `json:"workloadKind"`
	SecretRefs        []SecretRef   `json:"secretRefs"`
	Chart             chart.Result  `json:"chart"`
	// Omitted for historical v1 snapshots to preserve their canonical hashes.
	PullCredential *PullCredential `json:"pullCredential,omitempty"`
	Removal        *RemovalPlan    `json:"removal,omitempty"`
}

func Decode(raw []byte, hash string) (Plan, error) {
	var p Plan
	if err := json.Unmarshal(raw, &p); err != nil {
		return p, err
	}
	canonical, err := json.Marshal(p)
	if err != nil {
		return p, err
	}
	if p.SchemaVersion != 1 || chart.Hash(canonical) != hash || chart.Hash(p.Chart.Package) != p.Chart.SHA256 || chart.Hash([]byte(p.Chart.Manifest)) != p.Chart.ManifestSHA256 {
		return p, errors.New("release snapshot integrity failed")
	}
	return p, nil
}
