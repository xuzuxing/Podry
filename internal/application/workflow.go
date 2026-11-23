package application

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/idempotency"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/release"
)

func pipelineDTO(p sqlcdb.Pipeline) (Pipeline, error) {
	out := Pipeline{ID: p.ID, AppID: p.AppID, Kind: p.Kind, BindingID: p.BindingID, Enabled: p.Enabled, Version: p.Version}
	err := json.Unmarshal(p.Definition, &out.Definition)
	return out, err
}
func readWorkflow(ctx context.Context, q *sqlcdb.Queries, app sqlcdb.Application) (Workflow, error) {
	rows, err := q.ListPipelines(ctx, app.ID)
	out := Workflow{Version: app.WorkflowVersion, Items: []Pipeline{}}
	if err != nil {
		return out, err
	}
	for _, r := range rows {
		p, err := pipelineDTO(r)
		if err != nil {
			return out, err
		}
		out.Items = append(out.Items, p)
	}
	return out, nil
}
func readBindings(ctx context.Context, q *sqlcdb.Queries, id string) ([]Binding, error) {
	rows, err := q.ListBindings(ctx, id)
	out := make([]Binding, 0, len(rows))
	for _, r := range rows {
		b := Binding{ID: r.ID, AppID: r.AppID, EnvironmentID: r.EnvironmentID, Target: Target{ClusterID: r.ClusterID, Namespace: r.Namespace, ReleaseName: r.ReleaseName}, Version: r.Version, AutoDeploy: r.AutoDeploy, CurrentDeploymentID: r.CurrentDeploymentID}
		if err := json.Unmarshal(r.OverrideValues, &b.OverrideValues); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, err
}
func (s *Service) GetWorkflow(ctx context.Context, a auth.Actor, id string) (Workflow, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Workflow, error) {
		app, err := view(ctx, q, a, id)
		if err != nil {
			return Workflow{}, err
		}
		return readWorkflow(ctx, q, app)
	})
}
func (s *Service) GetBindings(ctx context.Context, a auth.Actor, id string) ([]Binding, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) ([]Binding, error) {
		if _, err := view(ctx, q, a, id); err != nil {
			return nil, err
		}
		return readBindings(ctx, q, id)
	})
}
func validateCI(ci CI, c Config) error {
	if !ci.Manual && !ci.Push || ci.Push != (ci.WebhookCredentialID != nil) {
		return httpx.Invalid("CI 至少启用 manual/push 之一；push 必须且只能携带 webhookCredentialId")
	}
	if !validBranch(ci.Branch) || c.GitConfig == nil || ci.Branch != c.GitConfig.Branch {
		return httpx.Invalid("CI branch 必须与应用 Git 配置一致")
	}
	return nil
}
func validateCD(cd CD, ciID *string) error {
	if cd.TriggerMode != "manual" && cd.TriggerMode != "on_ci_success" {
		return httpx.Invalid("CD triggerMode 必须为 manual/on_ci_success")
	}
	if cd.TriggerMode == "on_ci_success" && cd.UpstreamPipelineID == nil {
		return httpx.Invalid("自动部署必须明确指定上游 CI")
	}
	if cd.DeployTimeoutSeconds < 60 || cd.DeployTimeoutSeconds > 7200 {
		return httpx.Invalid("部署超时必须为 60–7200 秒")
	}
	if cd.UpstreamPipelineID != nil && (ciID == nil || *cd.UpstreamPipelineID != *ciID) {
		return httpx.Invalid("CD upstreamPipelineId 必须指向本应用的 CI")
	}
	return nil
}
func targetResources(c Config) []string {
	out := []string{"core/configmaps"}
	if c.ChartConfig != nil && c.ChartConfig.WorkloadKind == "Job" {
		out = append(out, "batch/jobs")
	} else {
		out = append(out, "apps/deployments")
	}
	if len(c.SecretRefs) > 0 {
		out = append(out, "core/secrets")
	}
	for _, p := range []struct{ key, resource string }{{"service", "core/services"}, {"ingress", "networking.k8s.io/ingresses"}} {
		if m, ok := c.DeployValues[p.key].(map[string]any); ok && m["enabled"] == true {
			out = append(out, p.resource)
		}
	}
	return out
}
func targetPermission(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, c Config, t Target) error {
	for _, grant := range release.MountPermissions(c.DeployValues) {
		if err := platform.RequireTarget(ctx, q, a, app.ProjectID, t.ClusterID, t.Namespace, grant.Resource, grant.Action); err != nil {
			return err
		}
	}
	for _, resource := range targetResources(c) {
		if err := platform.RequireTarget(ctx, q, a, app.ProjectID, t.ClusterID, t.Namespace, resource, "resource.write"); err != nil {
			return err
		}
	}
	return nil
}
func lockTargets(ctx context.Context, q *sqlcdb.Queries, targets []Target) error {
	ids := []string{}
	for _, t := range targets {
		if !slices.Contains(ids, t.ClusterID) {
			ids = append(ids, t.ClusterID)
		}
	}
	slices.Sort(ids)
	for _, id := range ids {
		if err := httpx.UUID(id); err != nil {
			return err
		}
		if _, err := q.LockCluster(ctx, id); err != nil {
			return err
		}
	}
	for _, t := range targets {
		busy, err := q.ResourceActionBusy(ctx, sqlcdb.ResourceActionBusyParams{ClusterID: t.ClusterID, Namespace: t.Namespace})
		if err != nil {
			return err
		}
		if busy {
			return httpx.Fail(409, "resource_action_busy", "目标命名空间存在未完成的资源动作")
		}
	}
	return nil
}
func validateBinding(ctx context.Context, q *sqlcdb.Queries, in BindingInput) error {
	if err := httpx.UUID(in.EnvironmentID); err != nil {
		return err
	}
	if err := validateAutoEnvironment(ctx, q, in.EnvironmentID, in.AutoDeploy); err != nil {
		return err
	}
	if !platform.DNSName(in.Target.Namespace, 63) || !platform.DNSName(in.Target.ReleaseName, 53) || len(in.Target.ReleaseName) < 3 || in.Target.ReleaseName[0] < 'a' || in.Target.ReleaseName[0] > 'z' {
		return httpx.Invalid("目标 namespace/releaseName 无效")
	}
	if in.OverrideValues == nil {
		return httpx.Invalid("overrideValues 必须为对象")
	}
	return nil
}
func (s *Service) CreateTemplate(ctx context.Context, a auth.Actor, id string, in TemplateInput, key, req string) (idempotency.Result, error) {
	if in.Template != "build_deploy" && in.Template != "build_only" && in.Template != "add_deploy" && in.Template != "external_image" {
		return idempotency.Result{}, httpx.Fail(422, "feature_not_available", "当前阶段支持 build_deploy/build_only/add_deploy/external_image 模板")
	}
	if (in.CI == nil) != (in.Template == "add_deploy" || in.Template == "external_image") || in.ExpectedWorkflowVersion == nil || *in.ExpectedWorkflowVersion < 0 || in.ExpectedConfigVersion < 1 || (in.Template != "build_only") != (in.Deployment != nil) {
		return idempotency.Result{}, httpx.Invalid("模板参数不完整或不匹配")
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
		app, err := access(ctx, q, a, id, true)
		if err != nil {
			return idempotency.Result{}, err
		}
		if err = mutable(app); err != nil {
			return idempotency.Result{}, err
		}
		c, err := readConfig(ctx, q, id, 0)
		if err != nil {
			return idempotency.Result{}, err
		}
		if in.Deployment != nil {
			if err = validateBinding(ctx, q, in.Deployment.Binding); err != nil {
				return idempotency.Result{}, err
			}
			if err = lockTargets(ctx, q, []Target{in.Deployment.Binding.Target}); err != nil {
				return idempotency.Result{}, err
			}
			effective, err := effectiveConfig(c, in.Deployment.Binding.OverrideValues)
			if err != nil {
				return idempotency.Result{}, err
			}
			if err = targetPermission(ctx, q, a, app, effective, in.Deployment.Binding.Target); err != nil {
				return idempotency.Result{}, err
			}
		}
		return idempotency.Execute(ctx, q, a.ID, "createWorkflowFromTemplate", key, "POST", "/api/apps/"+id+"/workflow-templates", in, func() (idempotency.Result, error) {
			if c.Version != in.ExpectedConfigVersion || app.WorkflowVersion != *in.ExpectedWorkflowVersion {
				return idempotency.Result{}, httpx.Fail(409, "revision_conflict", "配置或工作流版本已变化")
			}
			old, err := readWorkflow(ctx, q, app)
			if err != nil {
				return idempotency.Result{}, err
			}
			if in.Template != "add_deploy" && len(old.Items) > 0 {
				return idempotency.Result{}, httpx.Fail(409, "workflow_exists", "应用已有工作流")
			}
			if (app.SourceMode == "git" && (c.GitConfig == nil || c.BuildConfig == nil)) || (in.Deployment != nil && c.ChartConfig == nil) {
				return idempotency.Result{}, httpx.Fail(422, "prerequisite_missing", "请先保存 Git、构建和所需的基础配置")
			}
			if err = s.validateConfig(ctx, q, a, app, c); err != nil {
				return idempotency.Result{}, err
			}
			if (in.Template == "external_image" && app.SourceMode != "image") || (app.SourceMode == "image" && in.Template != "external_image" && in.Template != "add_deploy") {
				return idempotency.Result{}, httpx.Invalid("工作流模板与应用 sourceMode 不匹配")
			}
			var ciID *string
			if in.Template == "add_deploy" {
				for _, p := range old.Items {
					if p.Kind == "ci" {
						v := p.ID
						ciID = &v
					}
				}
				if app.SourceMode == "git" && ciID == nil {
					return idempotency.Result{}, httpx.Fail(422, "prerequisite_missing", "add_deploy 需要已有 CI")
				}
				if app.SourceMode == "image" && len(old.Items) == 0 {
					return idempotency.Result{}, httpx.Fail(422, "prerequisite_missing", "add_deploy 需要已有镜像工作流")
				}
			} else if in.Template != "external_image" {
				if err = s.validatePushCI(ctx, q, a, app, *in.CI, c); err != nil {
					return idempotency.Result{}, err
				}
				v := uuid.NewString()
				ciID = &v
				if _, err = q.CreatePipeline(ctx, sqlcdb.CreatePipelineParams{ID: *ciID, AppID: id, Kind: "ci", Definition: nullableJSON(in.CI), Enabled: true}); err != nil {
					return idempotency.Result{}, err
				}
				if err = savePushAuthorization(ctx, q, a, *ciID, 1, *in.CI, c); err != nil {
					return idempotency.Result{}, err
				}
			}
			if d := in.Deployment; d != nil {
				if d.Definition.UpstreamPipelineID == nil {
					d.Definition.UpstreamPipelineID = ciID
				}
				if err = validateCD(d.Definition, ciID); err != nil {
					return idempotency.Result{}, err
				}
				binding, err := createBinding(ctx, q, id, d.Binding)
				if err != nil {
					return idempotency.Result{}, targetConflict(err)
				}
				cd, err := q.CreatePipeline(ctx, sqlcdb.CreatePipelineParams{ID: uuid.NewString(), AppID: id, BindingID: &binding.ID, Kind: "cd", Definition: nullableJSON(d.Definition), Enabled: true})
				if err != nil {
					return idempotency.Result{}, err
				}
				if err = saveDeployAuthorization(ctx, q, a, app, c, cd, d.Definition); err != nil {
					return idempotency.Result{}, err
				}
			}
			app.WorkflowVersion, err = q.NextWorkflowVersion(ctx, id)
			if err != nil {
				return idempotency.Result{}, err
			}
			out := TemplateResult{}
			if out.Workflow, err = readWorkflow(ctx, q, app); err != nil {
				return idempotency.Result{}, err
			}
			if out.Bindings, err = readBindings(ctx, q, id); err != nil {
				return idempotency.Result{}, err
			}
			if out.Setup, err = s.deriveSetup(ctx, q, a, app, c); err != nil {
				return idempotency.Result{}, err
			}
			if err = record(ctx, q, a, app, "workflow.template.create", req, map[string]any{"appId": id, "template": in.Template, "workflowVersion": app.WorkflowVersion}); err != nil {
				return idempotency.Result{}, err
			}
			data, err := json.Marshal(out)
			return idempotency.Result{Status: 201, Body: data}, err
		})
	})
}
func parseDefinition[T any](m map[string]any, allowed []string) (T, error) {
	var out T
	if m == nil || len(m) != len(allowed) || !fields(m, allowed...) {
		return out, httpx.Invalid("管线 definition 字段不完整或存在未知字段")
	}
	raw, err := json.Marshal(m)
	if err != nil {
		return out, err
	}
	if err = json.Unmarshal(raw, &out); err != nil {
		return out, httpx.Invalid("管线 definition 类型无效")
	}
	for k, v := range m {
		if v == nil && k != "upstreamPipelineId" && k != "webhookCredentialId" {
			return out, httpx.Invalid("管线 definition 必填字段不能为 null")
		}
	}
	return out, nil
}
func (s *Service) SaveWorkflow(ctx context.Context, a auth.Actor, id string, in WorkflowInput, req string) (Workflow, error) {
	if in.ExpectedVersion == nil || *in.ExpectedVersion < 0 || in.Items == nil || len(in.Items) > 20 {
		return Workflow{}, httpx.Invalid("expectedVersion/items 无效")
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Workflow, error) {
		app, err := access(ctx, q, a, id, true)
		if err != nil {
			return Workflow{}, err
		}
		if err = mutable(app); err != nil {
			return Workflow{}, err
		}
		if app.WorkflowVersion != *in.ExpectedVersion {
			return Workflow{}, httpx.Fail(409, "revision_conflict", "工作流版本已变化")
		}
		c, err := readConfig(ctx, q, id, 0)
		if err != nil {
			return Workflow{}, err
		}
		if err = s.validateConfig(ctx, q, a, app, c); err != nil {
			return Workflow{}, err
		}
		old, err := readWorkflow(ctx, q, app)
		if err != nil {
			return Workflow{}, err
		}
		bindings, err := readBindings(ctx, q, id)
		if err != nil {
			return Workflow{}, err
		}
		targets := []Target{}
		for _, b := range bindings {
			targets = append(targets, b.Target)
		}
		if err = lockTargets(ctx, q, targets); err != nil {
			return Workflow{}, err
		}
		// Revalidate targets for additions, edits and removals alike.
		for _, b := range bindings {
			effective, err := effectiveConfig(c, b.OverrideValues)
			if err != nil {
				return Workflow{}, err
			}
			if err = targetPermission(ctx, q, a, app, effective, b.Target); err != nil {
				return Workflow{}, err
			}
		}
		current := map[string]Pipeline{}
		for _, p := range old.Items {
			current[p.ID] = p
		}
		ids := map[string]bool{}
		bindingSeen := map[string]bool{}
		var ciID *string
		ciCount := 0
		for i := range in.Items {
			p := &in.Items[i]
			if p.Enabled == nil {
				return Workflow{}, httpx.Invalid("管线 enabled 必填")
			}
			if p.ID == nil {
				v := uuid.NewString()
				p.ID = &v
			} else {
				if err := httpx.UUID(*p.ID); err != nil {
					return Workflow{}, err
				}
				prev, ok := current[*p.ID]
				if !ok {
					return Workflow{}, httpx.NotFound()
				}
				if prev.Kind != p.Kind || !equalID(prev.BindingID, p.BindingID) {
					return Workflow{}, httpx.Invalid("已有管线不能变更 kind/bindingId")
				}
			}
			if ids[*p.ID] {
				return Workflow{}, httpx.Invalid("管线 ID 重复")
			}
			ids[*p.ID] = true
			switch p.Kind {
			case "ci":
				ciCount++
				ciID = p.ID
				if p.BindingID != nil || c.GitConfig == nil || c.BuildConfig == nil {
					return Workflow{}, httpx.Invalid("CI 需要 Git/构建配置且不能绑定环境")
				}
				def, err := parseDefinition[CI](p.Definition, []string{"manual", "push", "branch", "webhookCredentialId"})
				if err != nil {
					return Workflow{}, err
				}
				if err = s.validatePushCI(ctx, q, a, app, def, c); err != nil {
					return Workflow{}, err
				}
			case "cd":
				if c.ChartConfig == nil || p.BindingID == nil || bindingSeen[*p.BindingID] {
					return Workflow{}, httpx.Invalid("CD 需要基础配置和唯一环境绑定")
				}
				if err := httpx.UUID(*p.BindingID); err != nil {
					return Workflow{}, err
				}
				found := false
				for _, b := range bindings {
					if b.ID == *p.BindingID {
						found = true
					}
				}
				if !found {
					return Workflow{}, httpx.NotFound()
				}
				bindingSeen[*p.BindingID] = true
			default:
				return Workflow{}, httpx.Invalid("管线 kind 无效")
			}
		}
		if ciCount > 1 {
			return Workflow{}, httpx.Fail(409, "multiple_ci_pipelines", "每个应用只允许一条 CI")
		}
		for _, p := range in.Items {
			if p.Kind == "cd" {
				def, err := parseDefinition[CD](p.Definition, []string{"triggerMode", "upstreamPipelineId", "deployTimeoutSeconds"})
				if err != nil {
					return Workflow{}, err
				}
				if err = validateCD(def, ciID); err != nil {
					return Workflow{}, err
				}
			}
		}
		for _, p := range old.Items {
			if !ids[p.ID] {
				if err = q.DeletePipeline(ctx, sqlcdb.DeletePipelineParams{ID: p.ID, AppID: id}); err != nil {
					return Workflow{}, err
				}
			}
		}
		for _, p := range in.Items {
			if _, ok := current[*p.ID]; ok {
				_, err = q.UpdatePipeline(ctx, sqlcdb.UpdatePipelineParams{ID: *p.ID, AppID: id, Definition: nullableJSON(p.Definition), Enabled: *p.Enabled})
			} else {
				_, err = q.CreatePipeline(ctx, sqlcdb.CreatePipelineParams{ID: *p.ID, AppID: id, Kind: p.Kind, BindingID: p.BindingID, Definition: nullableJSON(p.Definition), Enabled: *p.Enabled})
			}
			if err != nil {
				return Workflow{}, err
			}
			if p.Kind == "ci" {
				var ci CI
				_ = json.Unmarshal(nullableJSON(p.Definition), &ci)
				row, err := q.GetPipeline(ctx, *p.ID)
				if err != nil {
					return Workflow{}, err
				}
				if err = savePushAuthorization(ctx, q, a, row.ID, row.Version, ci, c); err != nil {
					return Workflow{}, err
				}
			} else {
				var cd CD
				_ = json.Unmarshal(nullableJSON(p.Definition), &cd)
				row, err := q.GetPipeline(ctx, *p.ID)
				if err != nil {
					return Workflow{}, err
				}
				if err = saveDeployAuthorization(ctx, q, a, app, c, row, cd); err != nil {
					return Workflow{}, err
				}
			}
		}
		app.WorkflowVersion, err = q.NextWorkflowVersion(ctx, id)
		if err != nil {
			return Workflow{}, err
		}
		if err = record(ctx, q, a, app, "workflow.save", req, map[string]any{"appId": id, "workflowVersion": app.WorkflowVersion}); err != nil {
			return Workflow{}, err
		}
		return readWorkflow(ctx, q, app)
	})
}
func equalID(a, b *string) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }
func targetConflict(err error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		return httpx.Fail(409, "target_conflict", "物理目标或应用环境已被绑定")
	}
	return err
}
