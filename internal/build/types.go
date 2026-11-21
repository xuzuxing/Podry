// Package build executes durable, versioned Kubernetes build attempts.
package build

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/httpx"
)

type Settings struct {
	Enabled                                                               bool
	ClusterID, Namespace, BuilderEndpoint, RunnerImage, Platform, DataDir string
	Concurrency                                                           int
}

func (s Settings) Validate() error {
	if !s.Enabled {
		return nil
	}
	u, e := url.Parse(s.BuilderEndpoint)
	if httpx.UUID(s.ClusterID) != nil || !regexp.MustCompile(`^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$`).MatchString(s.Namespace) ||
		e != nil || u.Scheme != "tcp" || u.Hostname() == "" || u.Port() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" ||
		!regexp.MustCompile(`^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$`).MatchString(s.RunnerImage) ||
		(s.Platform != "linux/amd64" && s.Platform != "linux/arm64") || s.Concurrency < 1 || s.Concurrency > 4 || s.DataDir == "" {
		return httpx.Fail(503, "build_environment_unavailable", "构建集群、Namespace、BuildKit、固定 runner 镜像、平台或持久目录配置无效")
	}
	return nil
}

type CredentialRef struct {
	ID      string `json:"id"`
	Version int32  `json:"version"`
}
type ExecutionSpec struct {
	Version             int               `json:"version"`
	BuildID             string            `json:"buildId"`
	AttemptID           string            `json:"attemptId"`
	AppID               string            `json:"appId"`
	RequestedBy         string            `json:"requestedBy"`
	ClusterID           string            `json:"clusterId"`
	APIServer           string            `json:"apiServer"`
	ClusterCredential   CredentialRef     `json:"clusterCredential"`
	GitCredential       *CredentialRef    `json:"gitCredential"`
	RegistryCredential  *CredentialRef    `json:"registryCredential"`
	Namespace           string            `json:"namespace"`
	JobName             string            `json:"jobName"`
	RunnerImage         string            `json:"runnerImage"`
	BuilderEndpoint     string            `json:"builderEndpoint"`
	RepositoryURL       string            `json:"repositoryUrl"`
	CommitSHA           string            `json:"commitSha"`
	Dockerfile          string            `json:"dockerfile"`
	Context             string            `json:"context"`
	Platform            string            `json:"platform"`
	TimeoutSeconds      int               `json:"timeoutSeconds"`
	BuildArgs           map[string]string `json:"buildArgs"`
	RegistryEndpoint    string            `json:"registryEndpoint"`
	GitHTTPAllowed      bool              `json:"gitHttpAllowed,omitempty"`
	RegistryHTTPAllowed bool              `json:"registryHttpAllowed,omitempty"`
	ImageRepository     string            `json:"imageRepository"`
	CPU                 string            `json:"cpu"`
	Memory              string            `json:"memory"`
}

func (s ExecutionSpec) ImageTag() string {
	u, _ := url.Parse(s.RegistryEndpoint)
	return u.Host + "/" + s.ImageRepository + ":podry-" + strings.ReplaceAll(s.AttemptID, "-", "")
}

func (s ExecutionSpec) ImageOutput() (string, error) {
	if e := credential.WebURL(s.RegistryEndpoint, true, s.RegistryHTTPAllowed); e != nil {
		return "", e
	}
	output := "type=image,name=" + s.ImageTag() + ",push=true"
	if strings.HasPrefix(s.RegistryEndpoint, "http://") {
		output += ",registry.insecure=true"
	}
	return output, nil
}
func Hash(v any) string {
	b, _ := json.Marshal(v)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

type Build struct {
	ID              string           `json:"id"`
	AppID           string           `json:"appId"`
	Status          string           `json:"status"`
	CommitSHA       string           `json:"commitSha"`
	ConfigVersion   int32            `json:"configVersion"`
	AttemptNo       int32            `json:"attemptNo"`
	ArtifactID      *string          `json:"artifactId"`
	CreatedAt       time.Time        `json:"createdAt"`
	AutoDeployments []AutoDeployment `json:"autoDeployments,omitempty"`
}

// Detail-only durable automatic admission state. Dispatch means queued release,
// never a successful Helm operation or a healthy workload.
type AutoDeployment struct {
	ID         string    `json:"id"`
	PipelineID string    `json:"pipelineId"`
	BindingID  string    `json:"bindingId"`
	Status     string    `json:"status"`
	ErrorCode  *string   `json:"errorCode"`
	RequestID  *string   `json:"requestId"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}
type Attempt struct {
	ID              string     `json:"id"`
	BuildID         string     `json:"buildId"`
	AttemptNo       int32      `json:"attemptNo"`
	Status          string     `json:"status"`
	JobName         string     `json:"jobName"`
	JobUID          *string    `json:"jobUid"`
	StartedAt       *time.Time `json:"startedAt"`
	FinishedAt      *time.Time `json:"finishedAt"`
	ErrorCode       *string    `json:"errorCode"`
	LogAvailability string     `json:"logAvailability"`
}
type Artifact struct {
	ID              string    `json:"id"`
	AppID           string    `json:"appId"`
	BuildID         *string   `json:"buildId"`
	Source          string    `json:"source"`
	ImageRepository string    `json:"imageRepository"`
	Digest          string    `json:"digest"`
	ImageRef        string    `json:"imageRef"`
	CreatedAt       time.Time `json:"createdAt"`
}
type RunnerResult struct {
	Version         int    `json:"version"`
	AttemptID       string `json:"attemptId"`
	ImageRepository string `json:"imageRepository"`
	Digest          string `json:"digest"`
}
