package application

import (
	"context"
	"encoding/json"

	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
)

// Maps merge recursively; scalar values replace. Null and unrecognized fields
// are rejected by the controlled Chart schema. An empty override inherits base.
// Always copy maps: previewing one binding must not change another environment.
func mergeValues(base, override map[string]any) map[string]any {
	out := make(map[string]any, len(base)+len(override))
	for k, v := range base {
		if m, ok := v.(map[string]any); ok {
			v = mergeValues(m, nil)
		}
		out[k] = v
	}
	for k, v := range override {
		if m, ok := v.(map[string]any); ok {
			previous, _ := out[k].(map[string]any)
			v = mergeValues(previous, m)
		}
		out[k] = v
	}
	return out
}

func effectiveConfig(c Config, overrides map[string]any) (Config, error) {
	if c.ChartConfig == nil {
		return c, httpx.Fail(422, "prerequisite_missing", "请先保存基础部署配置")
	}
	if overrides == nil {
		return c, httpx.Invalid("overrideValues 必须为对象")
	}
	if err := validateValues(c.ChartConfig.WorkloadKind, overrides); err != nil {
		return c, err
	}
	c.DeployValues = mergeValues(c.DeployValues, overrides)
	if err := validateReleaseValues(c); err != nil {
		return c, err
	}
	env, _ := c.DeployValues["env"].(map[string]any)
	for _, ref := range c.SecretRefs {
		if _, exists := env[ref.TargetKey]; exists {
			return c, httpx.Invalid("环境覆盖不能覆盖 Secret 引用的 env")
		}
	}
	return c, nil
}

func bindingConfig(c Config, raw []byte) (Config, error) {
	var overrides map[string]any
	if err := json.Unmarshal(raw, &overrides); err != nil {
		return c, err
	}
	return effectiveConfig(c, overrides)
}

func createBinding(ctx context.Context, q *sqlcdb.Queries, id string, in BindingInput) (sqlcdb.AppEnvironmentBinding, error) {
	t, err := q.CreateTarget(ctx, sqlcdb.CreateTargetParams{ClusterID: in.Target.ClusterID, Namespace: in.Target.Namespace, ReleaseName: in.Target.ReleaseName})
	if err != nil {
		return sqlcdb.AppEnvironmentBinding{}, targetConflict(err)
	}
	b, err := q.CreateBinding(ctx, sqlcdb.CreateBindingParams{AppID: id, EnvironmentID: in.EnvironmentID, TargetID: t.ID, OverrideValues: nullableJSON(in.OverrideValues), AutoDeploy: in.AutoDeploy})
	return b, targetConflict(err)
}

func bindingDTO(b sqlcdb.AppEnvironmentBinding, target Target) (Binding, error) {
	out := Binding{ID: b.ID, AppID: b.AppID, EnvironmentID: b.EnvironmentID, Target: target, Version: b.Version, AutoDeploy: b.AutoDeploy, CurrentDeploymentID: b.CurrentDeploymentID}
	err := json.Unmarshal(b.OverrideValues, &out.OverrideValues)
	return out, err
}

func (s *Service) CreateBinding(ctx context.Context, a auth.Actor, id string, in BindingInput, req string) (Binding, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Binding, error) {
		app, err := access(ctx, q, a, id, true)
		if err != nil {
			return Binding{}, err
		}
		if err = mutable(app); err != nil {
			return Binding{}, err
		}
		if err = validateBinding(ctx, q, in); err != nil {
			return Binding{}, err
		}
		c, err := readConfig(ctx, q, id, 0)
		if err != nil {
			return Binding{}, err
		}
		c, err = effectiveConfig(c, in.OverrideValues)
		if err != nil {
			return Binding{}, err
		}
		if err = s.validateConfig(ctx, q, a, app, c); err != nil {
			return Binding{}, err
		}
		if err = lockTargets(ctx, q, []Target{in.Target}); err != nil {
			return Binding{}, err
		}
		if err = targetPermission(ctx, q, a, app, c, in.Target); err != nil {
			return Binding{}, err
		}
		b, err := createBinding(ctx, q, id, in)
		if err != nil {
			return Binding{}, err
		}
		if err = q.TouchApplication(ctx, id); err != nil {
			return Binding{}, err
		}
		if err = record(ctx, q, a, app, "application.binding.create", req, map[string]any{"appId": id, "bindingId": b.ID, "version": b.Version}); err != nil {
			return Binding{}, err
		}
		// Independent bindings do not implicitly create a CD or change workflowVersion.
		return bindingDTO(b, in.Target)
	})
}

func (s *Service) UpdateBinding(ctx context.Context, a auth.Actor, id, bindingID string, in BindingUpdate, req string) (Binding, error) {
	if err := httpx.UUID(bindingID); err != nil {
		return Binding{}, err
	}
	if in.ExpectedVersion == nil || *in.ExpectedVersion < 1 || in.OverrideValues == nil {
		return Binding{}, httpx.Invalid("expectedVersion 与 overrideValues 必填")
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Binding, error) {
		app, err := access(ctx, q, a, id, true)
		if err != nil {
			return Binding{}, err
		}
		if err = mutable(app); err != nil {
			return Binding{}, err
		}
		b, err := q.GetReleaseBinding(ctx, sqlcdb.GetReleaseBindingParams{ID: bindingID, AppID: id})
		if err != nil {
			return Binding{}, err
		}
		if b.DetachedAt != nil {
			return Binding{}, httpx.Fail(409, "binding_detached", "环境绑定已解除")
		}
		if b.Version != *in.ExpectedVersion {
			return Binding{}, httpx.Fail(409, "revision_conflict", "环境绑定版本已变化")
		}
		if err = validateAutoEnvironment(ctx, q, b.EnvironmentID, in.AutoDeploy); err != nil {
			return Binding{}, err
		}
		target := Target{ClusterID: b.ClusterID, Namespace: b.Namespace, ReleaseName: b.ReleaseName}
		if err = lockTargets(ctx, q, []Target{target}); err != nil {
			return Binding{}, err
		}
		c, err := readConfig(ctx, q, id, 0)
		if err != nil {
			return Binding{}, err
		}
		previous, err := bindingConfig(c, b.OverrideValues)
		if err != nil {
			return Binding{}, err
		}
		c, err = effectiveConfig(c, in.OverrideValues)
		if err != nil {
			return Binding{}, err
		}
		if err = s.validateConfig(ctx, q, a, app, c); err != nil {
			return Binding{}, err
		}
		// Removing a resource also requires permission for its old configuration.
		for _, candidate := range []Config{previous, c} {
			if err = targetPermission(ctx, q, a, app, candidate, target); err != nil {
				return Binding{}, err
			}
		}
		busy, err := q.BindingTargetBusy(ctx, b.TargetID)
		if err != nil {
			return Binding{}, err
		}
		if busy {
			return Binding{}, httpx.Fail(409, "target_busy", "目标存在排队、执行中或结果未知的发布，请完成核对后修改")
		}
		updated, err := q.UpdateBinding(ctx, sqlcdb.UpdateBindingParams{ID: b.ID, AppID: id, OverrideValues: nullableJSON(in.OverrideValues), AutoDeploy: in.AutoDeploy, ExpectedVersion: *in.ExpectedVersion})
		if err != nil {
			return Binding{}, err
		}
		if err = q.TouchApplication(ctx, id); err != nil {
			return Binding{}, err
		}
		if err = record(ctx, q, a, app, "application.binding.update", req, map[string]any{"appId": id, "bindingId": b.ID, "version": updated.Version}); err != nil {
			return Binding{}, err
		}
		return bindingDTO(updated, target)
	})
}
