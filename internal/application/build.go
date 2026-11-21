package application

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"

	"github.com/google/uuid"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/idempotency"
	"github.com/xuzuxing/podry/internal/platform"
)

type BuildInput struct {
	CommitSHA             string `json:"commitSha"`
	ExpectedConfigVersion int32  `json:"expectedConfigVersion"`
}

func buildDTO(b sqlcdb.Build) build.Build {
	return build.Build{ID: b.ID, AppID: b.AppID, Status: b.Status, CommitSHA: b.CommitSha, ConfigVersion: b.ConfigVersion, AttemptNo: b.AttemptNo, ArtifactID: b.ArtifactID, CreatedAt: b.CreatedAt}
}
func artifactDTO(b sqlcdb.Artifact) build.Artifact {
	return build.Artifact{ID: b.ID, AppID: b.AppID, BuildID: &b.BuildID, Source: b.Source, ImageRepository: b.ImageRepository, Digest: b.Digest, ImageRef: b.ImageRepository + "@" + b.Digest, CreatedAt: b.CreatedAt}
}
func buildAccess(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, id string) (sqlcdb.Application, error) {
	app, e := q.GetApplication(ctx, id)
	if e != nil {
		return app, e
	}
	if e = auth.LockActor(ctx, q, a); e != nil {
		return app, e
	}
	if _, e = lockProject(ctx, q, a, app.ProjectID, "build"); e != nil {
		return app, e
	}
	return q.LockApplication(ctx, id)
}
func enabledCI(ctx context.Context, q *sqlcdb.Queries, id string) (sqlcdb.Pipeline, CI, error) {
	rows, e := q.ListPipelines(ctx, id)
	if e != nil {
		return sqlcdb.Pipeline{}, CI{}, e
	}
	for _, p := range rows {
		if p.Kind == "ci" && p.Enabled {
			var ci CI
			if json.Unmarshal(p.Definition, &ci) == nil && ci.Manual {
				return p, ci, nil
			}
		}
	}
	return sqlcdb.Pipeline{}, CI{}, httpx.Fail(422, "prerequisite_missing", "请先保存并启用手动 CI 流水线")
}
func (s *Service) TriggerBuild(ctx context.Context, a auth.Actor, id string, in BuildInput, key, req string) (idempotency.Result, error) {
	if !regexp.MustCompile(`^[0-9a-f]{40}$`).MatchString(in.CommitSHA) || in.ExpectedConfigVersion < 1 {
		return idempotency.Result{}, httpx.Invalid("构建需要完整 SHA-1 commitSha 和正数 expectedConfigVersion")
	}
	path := "/api/apps/" + id + "/builds"
	newRequest := errors.New("new build request")
	// Returning a stored 202 must not depend on the repository still being online.
	replay, e := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
		if _, e := buildAccess(ctx, q, a, id); e != nil {
			return idempotency.Result{}, e
		}
		return idempotency.Execute(ctx, q, a.ID, "triggerBuild", key, "POST", path, in, func() (idempotency.Result, error) { return idempotency.Result{}, newRequest })
	})
	if !errors.Is(e, newRequest) {
		return replay, e
	}
	if e = s.builds.Ready(); e != nil {
		return replay, e
	}
	before, e := s.gitSnapshot(ctx, a, id, true)
	if e != nil {
		return replay, e
	}
	if before.Config.Version != in.ExpectedConfigVersion {
		return replay, httpx.Fail(409, "revision_conflict", "应用配置版本已变化")
	}
	if before.Config.BuildConfig == nil {
		return replay, httpx.Fail(422, "prerequisite_missing", "请先保存构建配置")
	}
	pipeline, ci, e := enabledCI(ctx, s.q, id)
	if e != nil {
		return replay, e
	}
	commits, _, e := s.git.Commits(ctx, before.Source, ci.Branch)
	if e != nil {
		return replay, e
	}
	found := false
	for _, c := range commits {
		if c.SHA == in.CommitSHA {
			found = true
			break
		}
	}
	if !found {
		return replay, httpx.Fail(422, "git_commit_not_found", "提交不在当前 CI 分支的可读取历史中")
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (idempotency.Result, error) {
		app, e := buildAccess(ctx, q, a, id)
		if e != nil {
			return replay, e
		}
		return idempotency.Execute(ctx, q, a.ID, "triggerBuild", key, "POST", path, in, func() (idempotency.Result, error) {
			if e := mutable(app); e != nil {
				return replay, e
			}
			current, e := readConfig(ctx, q, id, 0)
			if e != nil {
				return replay, e
			}
			if current.Version != before.Config.Version {
				return replay, httpx.Fail(409, "revision_conflict", "应用配置版本已变化")
			}
			nowCI, _, e := enabledCI(ctx, q, id)
			if e != nil {
				return replay, e
			}
			if pipeline.ID != nowCI.ID || pipeline.Version != nowCI.Version {
				return replay, httpx.Fail(409, "revision_conflict", "CI 流水线已变化")
			}
			spec, e := s.planBuild(ctx, q, a, app, current, before.CredentialVersion, in.CommitSHA)
			if e != nil {
				return replay, e
			}
			b, e := q.CreateBuild(ctx, sqlcdb.CreateBuildParams{ID: spec.BuildID, AppID: id, PipelineID: pipeline.ID, ConfigVersion: current.Version, CommitSha: in.CommitSHA, RequestedBy: a.ID})
			if e != nil {
				return replay, e
			}
			raw, e := json.Marshal(spec)
			if e != nil {
				return replay, e
			}
			_, e = q.CreateBuildAttempt(ctx, sqlcdb.CreateBuildAttemptParams{ID: spec.AttemptID, BuildID: b.ID, BuildClusterID: spec.ClusterID, Namespace: spec.Namespace, JobName: spec.JobName, ExecutionSpec: raw, ExecutionHash: build.Hash(spec)})
			if e != nil {
				return replay, e
			}
			if e = record(ctx, q, a, app, "build.trigger", req, map[string]any{"buildId": b.ID, "attemptId": spec.AttemptID, "configVersion": current.Version, "commitSha": in.CommitSHA}); e != nil {
				return replay, e
			}
			body, _ := json.Marshal(buildDTO(b))
			return idempotency.Result{Status: 202, Body: body}, nil
		})
	})
}
func (s *Service) planBuild(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, c Config, gitVersion int32, sha string) (build.ExecutionSpec, error) {
	settings := s.builds.Settings
	out := build.ExecutionSpec{Version: 1, BuildID: uuid.NewString(), AttemptID: uuid.NewString(), AppID: app.ID, RequestedBy: a.ID, ClusterID: settings.ClusterID, Namespace: settings.Namespace, RunnerImage: settings.RunnerImage, BuilderEndpoint: settings.BuilderEndpoint, Platform: settings.Platform, CPU: "1", Memory: "1Gi"}
	b := c.BuildConfig
	g := c.GitConfig
	if b.Platform != settings.Platform {
		return out, httpx.Fail(422, "build_platform_unavailable", "当前执行环境不支持该构建平台")
	}
	cluster, e := q.ShareCluster(ctx, settings.ClusterID)
	if e != nil {
		return out, e
	}
	cr, e := q.LockCredential(ctx, cluster.CredentialID)
	if e != nil {
		return out, e
	}
	if cr.Kind != "kubeconfig" || cr.TeamID != nil {
		return out, httpx.Invalid("构建集群需要平台级 Kubernetes 凭据")
	}
	out.APIServer = cluster.ApiServer
	out.ClusterCredential = build.CredentialRef{ID: cr.ID, Version: cr.Version}
	registry, e := q.GetRegistry(ctx, b.RegistryID)
	if e != nil {
		return out, e
	}
	if e = s.urlPolicy.Validate(registry.Endpoint, true); e != nil {
		return out, e
	}
	if e = s.urlPolicy.Validate(g.RepositoryURL, false); e != nil {
		return out, e
	}
	out.GitHTTPAllowed = s.urlPolicy.AllowsHTTP(g.RepositoryURL)
	out.RegistryHTTPAllowed = s.urlPolicy.AllowsHTTP(registry.Endpoint)
	out.RegistryEndpoint = registry.Endpoint
	out.ImageRepository = b.ImageRepository
	p, e := q.GetProject(ctx, app.ProjectID)
	if e != nil {
		return out, e
	}
	ref := func(id, kind string) (*build.CredentialRef, error) {
		v, e := q.LockCredential(ctx, id)
		if e != nil {
			return nil, e
		}
		if v.Kind != kind {
			return nil, httpx.Invalid("构建凭据类型不匹配")
		}
		if e = platform.CredentialAccess(ctx, q, a, v, &p.TeamID, false); e != nil {
			return nil, e
		}
		return &build.CredentialRef{ID: v.ID, Version: v.Version}, nil
	}
	if g.CredentialID != nil {
		out.GitCredential, e = ref(*g.CredentialID, "git")
		if e != nil {
			return out, e
		}
		if out.GitCredential.Version != gitVersion {
			return out, httpx.Fail(409, "revision_conflict", "Git 凭据已轮换，请重新触发")
		}
	}
	if registry.CredentialID != nil {
		out.RegistryCredential, e = ref(*registry.CredentialID, "registry")
		if e != nil {
			return out, e
		}
	}
	out.RepositoryURL = g.RepositoryURL
	out.CommitSHA = sha
	out.Dockerfile = b.Dockerfile
	out.Context = b.Context
	out.TimeoutSeconds = b.TimeoutSeconds
	out.BuildArgs = b.BuildArgs
	out.JobName = "podry-build-" + out.AttemptID
	return out, nil
}
func (s *Service) ListBuilds(ctx context.Context, a auth.Actor, id string, page httpx.Pagination) (httpx.PageResult[build.Build], error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (httpx.PageResult[build.Build], error) {
		out := httpx.PageResult[build.Build]{Items: []build.Build{}, Page: page.Page, PageSize: page.PageSize}
		if _, e := view(ctx, q, a, id); e != nil {
			return out, e
		}
		n, e := q.CountBuilds(ctx, id)
		if e != nil {
			return out, e
		}
		out.Total = n
		rows, e := q.ListBuilds(ctx, sqlcdb.ListBuildsParams{AppID: id, PageLimit: int32(page.PageSize), PageOffset: page.Offset()})
		for _, b := range rows {
			out.Items = append(out.Items, buildDTO(b))
		}
		return out, e
	})
}
func (s *Service) GetBuild(ctx context.Context, a auth.Actor, id string) (build.Build, error) {
	b, e := s.q.GetBuild(ctx, id)
	if e != nil {
		return build.Build{}, e
	}
	if _, e = access(ctx, s.q, a, b.AppID, false); e != nil {
		return build.Build{}, e
	}
	return buildDTO(b), nil
}
func (s *Service) BuildAttempts(ctx context.Context, a auth.Actor, id string) ([]build.Attempt, error) {
	b, e := s.GetBuild(ctx, a, id)
	if e != nil {
		return nil, e
	}
	rows, e := s.q.ListBuildAttempts(ctx, b.ID)
	out := []build.Attempt{}
	for _, r := range rows {
		out = append(out, build.Attempt{ID: r.ID, BuildID: r.BuildID, AttemptNo: r.AttemptNo, Status: r.Status, JobName: r.JobName, JobUID: r.JobUid, StartedAt: r.StartedAt, FinishedAt: r.FinishedAt, ErrorCode: r.ErrorCode, LogAvailability: r.LogAvailability})
	}
	return out, e
}
func (s *Service) ListArtifacts(ctx context.Context, a auth.Actor, id string, page httpx.Pagination) (httpx.PageResult[build.Artifact], error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (httpx.PageResult[build.Artifact], error) {
		out := httpx.PageResult[build.Artifact]{Items: []build.Artifact{}, Page: page.Page, PageSize: page.PageSize}
		if _, e := view(ctx, q, a, id); e != nil {
			return out, e
		}
		n, e := q.CountArtifacts(ctx, id)
		if e != nil {
			return out, e
		}
		out.Total = n
		rows, e := q.ListArtifacts(ctx, sqlcdb.ListArtifactsParams{AppID: id, PageLimit: int32(page.PageSize), PageOffset: page.Offset()})
		for _, r := range rows {
			out.Items = append(out.Items, artifactDTO(r))
		}
		return out, e
	})
}
