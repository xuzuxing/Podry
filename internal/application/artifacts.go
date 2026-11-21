package application

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/idempotency"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/registry"
)

type ArtifactInput struct {
	ImageRef   string `json:"imageRef"`
	RegistryID string `json:"registryId"`
}
type ImageReader interface {
	Resolve(context.Context, registry.Source) (registry.Resolved, error)
}

func (s *Service) UseImageReader(reader ImageReader) *Service {
	if reader != nil {
		s.images = reader
	}
	return s
}

type importPlan struct {
	source            registry.Source
	credentialID      *string
	credentialVersion *int32
}

func (s *Service) planImport(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, in ArtifactInput) (importPlan, error) {
	var out importPlan
	if err := mutable(app); err != nil {
		return out, err
	}
	r, err := q.GetRegistry(ctx, in.RegistryID)
	if err != nil {
		return out, err
	}
	if err = s.urlPolicy.Validate(r.Endpoint, true); err != nil {
		return out, err
	}
	if _, _, err = registry.Reference(r.Endpoint, in.ImageRef); err != nil {
		return out, err
	}
	out.source = registry.Source{Endpoint: r.Endpoint, ImageRef: in.ImageRef, AllowHTTP: s.urlPolicy.AllowsHTTP(r.Endpoint)}
	if r.CredentialID != nil {
		cr, err := q.LockCredential(ctx, *r.CredentialID)
		if err != nil {
			return out, err
		}
		if cr.Kind != "registry" {
			return out, httpx.Invalid("Registry 凭据类型不匹配")
		}
		p, err := q.GetProject(ctx, app.ProjectID)
		if err != nil {
			return out, err
		}
		if err = platform.CredentialAccess(ctx, q, a, cr, &p.TeamID, false); err != nil {
			return out, err
		}
		v, err := q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: cr.ID, Version: cr.Version})
		if err != nil {
			return out, err
		}
		payload, err := s.vault.Open(cr.ID, cr.Version, v.KeyID, v.EncryptedPayload)
		if err != nil {
			return out, err
		}
		out.source.Username, _ = payload["username"].(string)
		out.source.Password, _ = payload["password"].(string)
		out.credentialID = &cr.ID
		out.credentialVersion = &cr.Version
	}
	return out, nil
}

func artifactScope(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, artifact sqlcdb.Artifact) error {
	if artifact.AppID != app.ID {
		return httpx.NotFound()
	}
	if artifact.RegistryCredentialID != nil {
		cr, err := q.GetCredential(ctx, *artifact.RegistryCredentialID)
		if err != nil {
			return err
		}
		p, err := q.GetProject(ctx, app.ProjectID)
		if err != nil {
			return err
		}
		if cr.Kind != "registry" {
			return httpx.Fail(409, "artifact_unavailable", "产物凭据类型不匹配")
		}
		return platform.CredentialAccess(ctx, q, a, cr, &p.TeamID, false)
	}
	return nil
}

func usableArtifact(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, id string) (sqlcdb.Artifact, error) {
	artifact, err := q.GetArtifact(ctx, id)
	if err != nil {
		return artifact, err
	}
	if err = artifactScope(ctx, q, a, app, artifact); err != nil {
		return artifact, err
	}
	artifact, err = q.VerifiedArtifact(ctx, sqlcdb.VerifiedArtifactParams{ID: id, AppID: app.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		err = httpx.Fail(422, "artifact_unavailable", "产物尚未通过构建或 Registry 验证")
	}
	return artifact, err
}

func (s *Service) ImportArtifact(ctx context.Context, a auth.Actor, id string, in ArtifactInput, key, req string) (idempotency.Result, error) {
	if err := httpx.UUID(in.RegistryID); err != nil {
		return idempotency.Result{}, err
	}
	var candidate importPlan
	path := "/api/apps/" + id + "/artifacts"
	var resolved registry.Resolved
	phase := func(final bool) (idempotency.Result, bool, error) {
		type outcome struct {
			result idempotency.Result
			done   bool
		}
		out, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (outcome, error) {
			app, err := access(ctx, q, a, id, true)
			if err != nil {
				return outcome{}, err
			}
			replay, found, err := idempotency.Lookup(ctx, q, a.ID, "importArtifact", key, "POST", path, in)
			if err != nil {
				return outcome{}, err
			}
			if found {
				var stored struct {
					ID string `json:"id"`
				}
				if err = json.Unmarshal(replay.Body, &stored); err != nil {
					return outcome{}, err
				}
				artifact, err := q.GetArtifact(ctx, stored.ID)
				if err != nil {
					return outcome{}, err
				}
				if err = artifactScope(ctx, q, a, app, artifact); err != nil {
					return outcome{}, err
				}
				return outcome{replay, true}, nil
			}
			if final {
				current, err := q.GetRegistry(ctx, in.RegistryID)
				if err != nil {
					return outcome{}, err
				}
				if current.Endpoint != candidate.source.Endpoint || !equalID(current.CredentialID, candidate.credentialID) {
					return outcome{}, httpx.Fail(409, "revision_conflict", "Registry 已变化，请重新导入")
				}
			}
			plan, err := s.planImport(ctx, q, a, app, in)
			if err != nil {
				return outcome{}, err
			}
			if !final {
				candidate = plan
				return outcome{}, nil
			}
			if plan.source != candidate.source || !equalID(plan.credentialID, candidate.credentialID) || (plan.credentialVersion == nil) != (candidate.credentialVersion == nil) || (plan.credentialVersion != nil && *plan.credentialVersion != *candidate.credentialVersion) {
				return outcome{}, httpx.Fail(409, "revision_conflict", "Registry 或凭据已变化，请重新导入")
			}
			result, err := idempotency.Execute(ctx, q, a.ID, "importArtifact", key, "POST", path, in, func() (idempotency.Result, error) {
				artifact, err := q.CreateExternalArtifact(ctx, sqlcdb.CreateExternalArtifactParams{ID: uuid.NewString(), AppID: id, ImageRepository: resolved.ImageRepository, Digest: resolved.Digest, RegistryID: &in.RegistryID, RegistryCredentialID: plan.credentialID, RegistryCredentialVersion: plan.credentialVersion, ImportedBy: &a.ID})
				if err != nil {
					return idempotency.Result{}, err
				}
				if err = record(ctx, q, a, app, "artifact.import", req, map[string]any{"appId": id, "artifactId": artifact.ID, "registryId": in.RegistryID, "imageRef": resolved.ImageRepository + "@" + resolved.Digest}); err != nil {
					return idempotency.Result{}, err
				}
				body, _ := json.Marshal(artifactDTO(artifact))
				return idempotency.Result{Status: 201, Body: body}, nil
			})
			return outcome{result, true}, err
		})
		return out.result, out.done, err
	}
	result, done, err := phase(false)
	if err != nil || done {
		return result, err
	}
	resolved, err = s.images.Resolve(ctx, candidate.source)
	if err != nil {
		return idempotency.Result{}, err
	}
	// Validate adapter output as well as the HTTP client's content checks.
	expectedRepo, expectedRef, _ := registry.Reference(candidate.source.Endpoint, candidate.source.ImageRef)
	actualRepo, _, validationErr := registry.Reference(candidate.source.Endpoint, resolved.ImageRepository+"@"+resolved.Digest)
	if validationErr != nil || actualRepo != expectedRepo || (strings.HasPrefix(expectedRef, "sha256:") && resolved.Digest != expectedRef) {
		return idempotency.Result{}, httpx.Fail(503, "registry_manifest_invalid", "Registry 解析结果无效")
	}
	result, _, err = phase(true)
	return result, err
}
