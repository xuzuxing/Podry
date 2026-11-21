package application

import (
	"context"
	"path"
	"regexp"
	"strings"

	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/platform"
)

var envKey = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
var sensitiveKey = regexp.MustCompile(`(?i)(password|passwd|secret|token|private.?key|api.?key|credential)`)
var repository = regexp.MustCompile(`^[a-z0-9]+([._-][a-z0-9]+)*(/[a-z0-9]+([._-][a-z0-9]+)*)*$`)
var quantity = regexp.MustCompile(`^[0-9]+(\.[0-9]+)?(m|Ki|Mi|Gi|Ti|K|M|G|T)?$`)

func repoPath(s string, dir bool) bool {
	if len(s) == 0 || len(s) > 1024 || strings.ContainsAny(s, "\\:\x00\r\n") || path.IsAbs(s) {
		return false
	}
	for _, seg := range strings.Split(s, "/") {
		if seg == ".." {
			return false
		}
	}
	return dir || path.Clean(s) != "."
}
func (s *Service) validateConfig(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, c Config) error {
	if app.SourceMode == "image" && (c.GitConfig != nil || c.BuildConfig != nil) {
		return httpx.Invalid("镜像应用不接受 Git 或构建配置")
	}
	p, err := q.GetProject(ctx, app.ProjectID)
	if err != nil {
		return err
	}
	reference := func(id, kind string, version int32) error {
		if err := httpx.UUID(id); err != nil {
			return err
		}
		cr, err := q.GetCredential(ctx, id)
		if err != nil {
			return err
		}
		if cr.Kind != kind {
			return httpx.Invalid("凭据类型与配置不符")
		}
		if err = platform.CredentialAccess(ctx, q, a, cr, &p.TeamID, false); err != nil {
			return err
		}
		if version > 0 {
			_, err = q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: id, Version: version})
		}
		return err
	}
	if g := c.GitConfig; g != nil {
		if err := s.urlPolicy.Validate(g.RepositoryURL, false); err != nil {
			return err
		}
		if !validBranch(g.Branch) {
			return httpx.Invalid("Git branch 无效")
		}
		switch g.AccountMode {
		case "public":
			if g.CredentialID != nil {
				return httpx.Invalid("公开仓库不能携带 credentialId")
			}
		case "credential":
			if g.CredentialID == nil {
				return httpx.Invalid("私有仓库需要 credentialId")
			}
			if err := reference(*g.CredentialID, "git", 0); err != nil {
				return err
			}
		default:
			return httpx.Invalid("accountMode 无效")
		}
	}
	if b := c.BuildConfig; b != nil {
		if b.CheckScript != nil {
			return httpx.Fail(422, "feature_not_available", "当前阶段不支持 checkScript")
		}
		if !repoPath(b.Dockerfile, false) || !repoPath(b.Context, true) {
			return httpx.Invalid("Dockerfile/context 必须是仓库内的相对路径")
		}
		if err := httpx.UUID(b.RegistryID); err != nil {
			return err
		}
		if _, err := q.GetRegistry(ctx, b.RegistryID); err != nil {
			return err
		}
		if !repository.MatchString(b.ImageRepository) || len(b.ImageRepository) > 255 {
			return httpx.Invalid("imageRepository 必须为不含 tag/digest/主机的仓库路径")
		}
		if b.Platform != "linux/amd64" && b.Platform != "linux/arm64" || b.TimeoutSeconds < 60 || b.TimeoutSeconds > 14400 || b.BuildArgs == nil || len(b.BuildArgs) > 100 {
			return httpx.Invalid("构建平台、超时或 buildArgs 无效")
		}
		for k, v := range b.BuildArgs {
			if !envKey.MatchString(k) || sensitiveKey.MatchString(k) || len(v) > 4096 || strings.ContainsRune(v, '\x00') {
				return httpx.Invalid("buildArgs 只允许非敏感字符串参数")
			}
		}
	}
	if ch := c.ChartConfig; ch != nil {
		if ch.WorkloadKind != "Deployment" && ch.WorkloadKind != "Job" {
			return httpx.Invalid("workloadKind 仅支持 Deployment/Job")
		}
		if ch.ChartVersion != "1.0.0" {
			return httpx.Fail(422, "unsupported_chart_version", "当前内置 Chart 配置版本为 1.0.0")
		}
		if err := validateValues(ch.WorkloadKind, c.DeployValues); err != nil {
			return err
		}
		seen := map[string]bool{}
		if len(c.SecretRefs) > 100 {
			return httpx.Invalid("secretRefs 过多")
		}
		for _, ref := range c.SecretRefs {
			if ref.Version < 1 || !envKey.MatchString(ref.TargetKey) || seen[ref.TargetKey] {
				return httpx.Invalid("Secret 引用版本或 targetKey 无效/重复")
			}
			seen[ref.TargetKey] = true
			if env, ok := c.DeployValues["env"].(map[string]any); ok {
				if _, exists := env[ref.TargetKey]; exists {
					return httpx.Invalid("Secret 引用不能覆盖明文 env")
				}
			}
			if err := reference(ref.CredentialID, "secret", ref.Version); err != nil {
				return err
			}
		}
	}
	return nil
}
func integer(v any, min, max int) bool {
	n, ok := v.(float64)
	return ok && n == float64(int64(n)) && n >= float64(min) && n <= float64(max)
}
func fields(m map[string]any, keys ...string) bool {
	for k := range m {
		found := false
		for _, allowed := range keys {
			if k == allowed {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
func validateValues(kind string, v map[string]any) error {
	invalid := httpx.Invalid("deployValues 不符合内置 Chart 的受控配置；镜像、所有权和 Secret 明文不可写")
	if !fields(v, "replicaCount", "containerPort", "resources", "env", "service", "ingress", "job") {
		return invalid
	}
	for k, val := range v {
		switch k {
		case "replicaCount":
			if kind == "Job" || !integer(val, 0, 100) {
				return invalid
			}
		case "containerPort":
			if kind == "Job" || !integer(val, 1, 65535) {
				return invalid
			}
		case "resources":
			m, ok := val.(map[string]any)
			if !ok || !fields(m, "requests", "limits") {
				return invalid
			}
			for _, x := range m {
				r, ok := x.(map[string]any)
				if !ok || !fields(r, "cpu", "memory") {
					return invalid
				}
				for _, n := range r {
					s, ok := n.(string)
					if !ok || !quantity.MatchString(s) || len(s) > 30 {
						return invalid
					}
				}
			}
		case "env":
			m, ok := val.(map[string]any)
			if !ok || len(m) > 100 {
				return invalid
			}
			for name, x := range m {
				s, ok := x.(string)
				if !ok || !envKey.MatchString(name) || sensitiveKey.MatchString(name) || len(s) > 4096 || strings.ContainsRune(s, '\x00') || strings.Contains(s, "PRIVATE KEY") {
					return invalid
				}
			}
		case "service":
			m, ok := val.(map[string]any)
			if kind == "Job" || !ok || !fields(m, "enabled", "port", "type") {
				return invalid
			}
			for name, x := range m {
				switch name {
				case "enabled":
					if _, ok := x.(bool); !ok {
						return invalid
					}
				case "port":
					if !integer(x, 1, 65535) {
						return invalid
					}
				case "type":
					if x != "ClusterIP" {
						return invalid
					}
				}
			}
		case "ingress":
			m, ok := val.(map[string]any)
			if kind == "Job" || !ok || !fields(m, "enabled", "host") {
				return invalid
			}
			for name, x := range m {
				if name == "enabled" {
					if _, ok := x.(bool); !ok {
						return invalid
					}
				} else {
					s, ok := x.(string)
					if !ok || len(s) > 253 || strings.ContainsAny(s, "/:* \r\n") || s == "" {
						return invalid
					}
					for _, seg := range strings.Split(s, ".") {
						if !platform.DNSName(seg, 63) {
							return invalid
						}
					}
				}
			}
		case "job":
			m, ok := val.(map[string]any)
			if kind != "Job" || !ok || !fields(m, "completions", "parallelism", "restartPolicy", "backoffLimit", "activeDeadlineSeconds") {
				return invalid
			}
			for name, x := range m {
				switch name {
				case "completions", "parallelism":
					if !integer(x, 1, 1) {
						return invalid
					}
				case "restartPolicy":
					if x != "Never" {
						return invalid
					}
				case "backoffLimit":
					if !integer(x, 0, 10) {
						return invalid
					}
				case "activeDeadlineSeconds":
					if !integer(x, 30, 86400) {
						return invalid
					}
				}
			}
		}
	}
	return nil
}
