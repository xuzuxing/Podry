package application

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/chart"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
)

// Candidates reflect local admission inputs only, without probing Git, Registry
// or Kubernetes. Preview and confirmation still revalidate their exact inputs.
func (s *Service) deployableBindings(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, c Config) ([]string, error) {
	out := []string{}
	artifact, err := q.LatestVerifiedArtifact(ctx, app.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	bindings, err := q.ListBindings(ctx, app.ID)
	if err != nil {
		return out, err
	}
	keys := []string{}
	for _, ref := range c.SecretRefs {
		keys = append(keys, ref.TargetKey)
	}
	for _, binding := range bindings {
		target := Target{ClusterID: binding.ClusterID, Namespace: binding.Namespace, ReleaseName: binding.ReleaseName}
		if s.releases.Ready(target) != nil {
			continue
		}
		check := func() error {
			if e := artifactScope(ctx, q, a, app, artifact); e != nil {
				return e
			}
			effective, e := bindingConfig(c, binding.OverrideValues)
			if e != nil {
				return e
			}
			if _, _, e := enabledCD(ctx, q, app.ID, binding.ID); e != nil {
				return e
			}
			if e := releasePermission(ctx, q, a, app, effective, target); e != nil {
				return e
			}
			if e := s.releaseSecrets(ctx, q, a, app, c.SecretRefs); e != nil {
				return e
			}
			if _, e := s.releaseCluster(ctx, q, binding.ClusterID); e != nil {
				return e
			}
			_, e = chart.Render(chart.Input{Version: effective.ChartConfig.ChartVersion, AppID: app.ID, BindingID: binding.ID, DeploymentID: "setup", Namespace: target.Namespace, ReleaseName: target.ReleaseName, WorkloadKind: c.ChartConfig.WorkloadKind, ImageRef: artifact.ImageRepository + "@" + artifact.Digest, Values: effective.DeployValues, SecretKeys: keys})
			if e != nil {
				return httpx.Fail(422, "chart_render_failed", "基础部署配置不能渲染")
			}
			return nil
		}
		if e := check(); e != nil {
			var api *httpx.Error
			if errors.As(e, &api) || errors.Is(e, pgx.ErrNoRows) {
				continue
			}
			return out, e
		}
		out = append(out, binding.ID)
	}
	return out, nil
}

func validateReleaseValues(c Config) error {
	if c.ChartConfig == nil {
		return httpx.Fail(422, "prerequisite_missing", "请先保存基础部署配置")
	}
	if err := validateChartValues(c); err != nil {
		return err
	}
	if ingress, ok := c.DeployValues["ingress"].(map[string]any); ok && ingress["enabled"] == true {
		service, _ := c.DeployValues["service"].(map[string]any)
		if service["enabled"] != true || ingress["host"] == nil || ingress["host"] == "" {
			return httpx.Invalid("启用 ingress 需要启用 service 并设置 host")
		}
	}
	return nil
}
