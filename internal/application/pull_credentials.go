package application

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"

	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/release"
)

// Pulls reuse the Artifact's exact credential version after current scope checks.
func (s *Service) artifactPull(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, artifact sqlcdb.Artifact, version string) (*release.PullCredential, error) {
	if version != "1.2.0" {
		return nil, nil
	}
	id, revision := artifact.RegistryCredentialID, artifact.RegistryCredentialVersion
	if artifact.Source == "build" && artifact.AttemptID != nil && artifact.BuildID != nil {
		attempt, err := q.BuildArtifactExecution(ctx, sqlcdb.BuildArtifactExecutionParams{ID: *artifact.AttemptID, BuildID: *artifact.BuildID})
		if err != nil {
			return nil, err
		}
		var spec build.ExecutionSpec
		if err = json.Unmarshal(attempt.ExecutionSpec, &spec); err != nil {
			return nil, err
		}
		if spec.RegistryCredential != nil {
			u, e := url.Parse(spec.RegistryEndpoint)
			if e != nil || spec.Version != 1 || spec.AppID != app.ID || spec.AttemptID != *artifact.AttemptID || spec.BuildID != *artifact.BuildID || build.Hash(spec) != attempt.ExecutionHash || u.Host+"/"+spec.ImageRepository != artifact.ImageRepository {
				return nil, httpx.Fail(409, "artifact_unavailable", "构建产物的冻结仓库身份不匹配")
			}
			id, revision = &spec.RegistryCredential.ID, &spec.RegistryCredential.Version
		}
	}
	if id == nil {
		return nil, nil
	}
	if revision == nil {
		return nil, httpx.Fail(409, "artifact_unavailable", "镜像拉取凭据版本缺失")
	}
	p := &release.PullCredential{CredentialRef: release.CredentialRef{ID: *id, Version: *revision}, Registry: strings.SplitN(artifact.ImageRepository, "/", 2)[0]}
	return p, s.authorizePull(ctx, q, a, app, p)
}

func (s *Service) authorizePull(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, p *release.PullCredential) error {
	if p == nil {
		return nil
	}
	if err := authorizePullScope(ctx, q, a, app, p); err != nil {
		return err
	}
	v, err := q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: p.ID, Version: p.Version})
	if err != nil {
		return err
	}
	payload, err := s.vault.Open(p.ID, p.Version, v.KeyID, v.EncryptedPayload)
	if err != nil {
		return err
	}
	username, _ := payload["username"].(string)
	password, _ := payload["password"].(string)
	if username == "" || password == "" {
		return httpx.Fail(409, "secret_version_unavailable", "镜像拉取凭据版本不可用")
	}
	return nil
}

func authorizePullScope(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, p *release.PullCredential) error {
	if p == nil {
		return nil
	}
	cr, err := q.GetCredential(ctx, p.ID)
	if err != nil {
		return err
	}
	if cr.Kind != "registry" {
		return httpx.Forbidden()
	}
	project, err := q.GetProject(ctx, app.ProjectID)
	if err != nil {
		return err
	}
	return platform.CredentialAccess(ctx, q, a, cr, &project.TeamID, false)
}

func pullRegistry(p *release.PullCredential) string {
	if p != nil {
		return p.Registry
	}
	return ""
}
