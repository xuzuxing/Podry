package application

import (
	"github.com/xuzuxing/podry/internal/release"
	"time"
)

type Application struct {
	ID          string     `json:"id"`
	ProjectID   string     `json:"projectId"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	SourceMode  string     `json:"sourceMode"`
	Health      string     `json:"health"`
	ArchivedAt  *time.Time `json:"archivedAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}
type ApplicationInput struct {
	ProjectID      string  `json:"projectId"`
	Name           string  `json:"name"`
	Description    string  `json:"description"`
	SourceMode     string  `json:"sourceMode"`
	CloneFromAppID *string `json:"cloneFromAppId"`
}
type ApplicationPatch struct {
	Description *string `json:"description"`
	Archived    *bool   `json:"archived"`
}
type GitConfig struct {
	RepositoryURL string  `json:"repositoryUrl"`
	Branch        string  `json:"branch"`
	CredentialID  *string `json:"credentialId"`
	AccountMode   string  `json:"accountMode"`
}
type BuildConfig struct {
	Dockerfile      string            `json:"dockerfile"`
	Context         string            `json:"context"`
	RegistryID      string            `json:"registryId"`
	ImageRepository string            `json:"imageRepository"`
	Platform        string            `json:"platform"`
	TimeoutSeconds  int               `json:"timeoutSeconds"`
	BuildArgs       map[string]string `json:"buildArgs"`
	CheckScript     *string           `json:"checkScript,omitempty"`
}
type ChartConfig struct {
	WorkloadKind string `json:"workloadKind"`
	ChartVersion string `json:"chartVersion"`
}
type SecretRef = release.SecretRef
type Config struct {
	AppID        string         `json:"appId"`
	Version      int32          `json:"version"`
	GitConfig    *GitConfig     `json:"gitConfig"`
	BuildConfig  *BuildConfig   `json:"buildConfig"`
	ChartConfig  *ChartConfig   `json:"chartConfig"`
	DeployValues map[string]any `json:"deployValues"`
	SecretRefs   []SecretRef    `json:"secretRefs"`
}
type ConfigInput struct {
	ExpectedVersion *int32         `json:"expectedVersion"`
	Section         string         `json:"section"`
	GitConfig       *GitConfig     `json:"gitConfig"`
	BuildConfig     *BuildConfig   `json:"buildConfig"`
	ChartConfig     *ChartConfig   `json:"chartConfig"`
	DeployValues    map[string]any `json:"deployValues"`
	SecretRefs      []SecretRef    `json:"secretRefs"`
}
type Blocker struct {
	Code          string `json:"code"`
	Message       string `json:"message"`
	TargetSection string `json:"targetSection"`
}
type Step struct {
	Key      string    `json:"key"`
	Status   string    `json:"status"`
	Blockers []Blocker `json:"blockers"`
}
type Setup struct {
	AppID                string   `json:"appId"`
	ConfigVersion        int32    `json:"configVersion"`
	WorkflowVersion      int32    `json:"workflowVersion"`
	Completed            int      `json:"completed"`
	Total                int      `json:"total"`
	Steps                []Step   `json:"steps"`
	CanBuild             bool     `json:"canBuild"`
	DeployableBindingIDs []string `json:"deployableBindingIds"`
	NextSection          *string  `json:"nextSection"`
}
type Target = release.Target
type Binding struct {
	ID                  string         `json:"id"`
	AppID               string         `json:"appId"`
	EnvironmentID       string         `json:"environmentId"`
	Target              Target         `json:"target"`
	OverrideValues      map[string]any `json:"overrideValues"`
	Version             int32          `json:"version"`
	AutoDeploy          bool           `json:"autoDeploy"`
	CurrentDeploymentID *string        `json:"currentDeploymentId"`
}
type BindingInput struct {
	EnvironmentID  string         `json:"environmentId"`
	Target         Target         `json:"target"`
	OverrideValues map[string]any `json:"overrideValues"`
	AutoDeploy     bool           `json:"autoDeploy"`
}
type BindingUpdate struct {
	ExpectedVersion *int32         `json:"expectedVersion"`
	OverrideValues  map[string]any `json:"overrideValues"`
	AutoDeploy      bool           `json:"autoDeploy"`
}
type CI struct {
	Manual              bool    `json:"manual"`
	Push                bool    `json:"push"`
	Branch              string  `json:"branch"`
	WebhookCredentialID *string `json:"webhookCredentialId"`
}
type CD struct {
	TriggerMode          string  `json:"triggerMode"`
	UpstreamPipelineID   *string `json:"upstreamPipelineId"`
	DeployTimeoutSeconds int     `json:"deployTimeoutSeconds"`
}
type Pipeline struct {
	ID         string         `json:"id"`
	AppID      string         `json:"appId"`
	Kind       string         `json:"kind"`
	BindingID  *string        `json:"bindingId"`
	Enabled    bool           `json:"enabled"`
	Version    int32          `json:"version"`
	Definition map[string]any `json:"definition"`
}
type PipelineInput struct {
	ID         *string        `json:"id"`
	Kind       string         `json:"kind"`
	BindingID  *string        `json:"bindingId"`
	Enabled    *bool          `json:"enabled"`
	Definition map[string]any `json:"definition"`
}
type Workflow struct {
	Version int32      `json:"version"`
	Items   []Pipeline `json:"items"`
}
type WorkflowInput struct {
	ExpectedVersion *int32          `json:"expectedVersion"`
	Items           []PipelineInput `json:"items"`
}
type TemplateInput struct {
	Template                string `json:"template"`
	ExpectedConfigVersion   int32  `json:"expectedConfigVersion"`
	ExpectedWorkflowVersion *int32 `json:"expectedWorkflowVersion"`
	CI                      *CI    `json:"ci"`
	Deployment              *struct {
		Binding    BindingInput `json:"binding"`
		Definition CD           `json:"definition"`
	} `json:"deployment"`
}
type TemplateResult struct {
	Workflow Workflow  `json:"workflow"`
	Bindings []Binding `json:"bindings"`
	Setup    Setup     `json:"setup"`
}
