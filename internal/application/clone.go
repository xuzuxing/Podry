package application

import (
	"context"
	"slices"

	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
)

// Lock all teams before projects, in stable order. Cross-project clones must not
// invert the lock order used by configuration saves and membership changes.
func lockCloneProjects(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, source, destination string) (sqlcdb.Project, error) {
	ids := []string{source}
	if destination != source {
		ids = append(ids, destination)
	}
	slices.Sort(ids)
	teams := []string{}
	for _, id := range ids {
		p, err := q.GetProject(ctx, id)
		if err != nil {
			return sqlcdb.Project{}, err
		}
		if !slices.Contains(teams, p.TeamID) {
			teams = append(teams, p.TeamID)
		}
	}
	slices.Sort(teams)
	for _, id := range teams {
		if _, err := q.LockTeam(ctx, id); err != nil {
			return sqlcdb.Project{}, err
		}
	}
	var target sqlcdb.Project
	for _, id := range ids {
		p, err := q.LockProject(ctx, id)
		if err != nil {
			return target, err
		}
		if id == destination {
			target = p
		}
	}
	if _, err := project.ProjectRole(ctx, q, a, source); err != nil {
		return target, err
	}
	role, err := project.ProjectRole(ctx, q, a, destination)
	if err != nil {
		return target, err
	}
	return target, project.RequireRole(role, "configure")
}

// validateConfig covers Git and runtime Secret references. Registry credentials
// are indirect references and must also be authorized in both application scopes.
func (s *Service) cloneReferences(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, c Config) error {
	if err := s.validateConfig(ctx, q, a, app, c); err != nil {
		return err
	}
	if c.BuildConfig == nil {
		return nil
	}
	r, err := q.GetRegistry(ctx, c.BuildConfig.RegistryID)
	if err != nil {
		return err
	}
	if err = s.urlPolicy.Validate(r.Endpoint, true); err != nil {
		return err
	}
	if r.CredentialID == nil {
		return nil
	}
	cr, err := q.GetCredential(ctx, *r.CredentialID)
	if err != nil {
		return err
	}
	if cr.Kind != "registry" {
		return httpx.Invalid("Registry 凭据类型不匹配")
	}
	p, err := q.GetProject(ctx, app.ProjectID)
	if err != nil {
		return err
	}
	return platform.CredentialAccess(ctx, q, a, cr, &p.TeamID, false)
}

func (s *Service) clone(ctx context.Context, a auth.Actor, in ApplicationInput, req string) (Application, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Application, error) {
		if err := auth.LockActor(ctx, q, a); err != nil {
			return Application{}, err
		}
		source, err := q.GetApplication(ctx, *in.CloneFromAppID)
		if err != nil {
			return Application{}, err
		}
		target, err := lockCloneProjects(ctx, q, a, source.ProjectID, in.ProjectID)
		if err != nil {
			return Application{}, err
		}
		source, err = q.ShareApplication(ctx, source.ID)
		if err != nil {
			return Application{}, err
		}
		if source.SourceMode != in.SourceMode {
			return Application{}, httpx.Invalid("sourceMode 必须与源应用一致")
		}
		c, err := readConfig(ctx, q, source.ID, 0)
		if err != nil {
			return Application{}, err
		}
		if err = s.cloneReferences(ctx, q, a, source, c); err != nil {
			return Application{}, err
		}
		row, err := q.CreateApplication(ctx, sqlcdb.CreateApplicationParams{ProjectID: in.ProjectID, Name: in.Name, Description: in.Description, SourceMode: in.SourceMode})
		if err != nil {
			return Application{}, err
		}
		sourceVersion := c.Version
		if c.BuildConfig != nil {
			// The new application never pushes to the source application's repository.
			c.BuildConfig.ImageRepository = "podry/" + row.ID
		}
		if err = s.cloneReferences(ctx, q, a, row, c); err != nil {
			return Application{}, err
		}
		if sourceVersion > 0 {
			if err = q.InsertAppConfig(ctx, sqlcdb.InsertAppConfigParams{AppID: row.ID, Version: 1, GitConfig: nullableJSON(c.GitConfig), BuildConfig: nullableJSON(c.BuildConfig), ChartConfig: nullableJSON(c.ChartConfig), DeployValues: nullableJSON(c.DeployValues), SecretRefs: nullableJSON(c.SecretRefs), CreatedBy: a.ID}); err != nil {
				return Application{}, err
			}
		}
		if err = project.Record(ctx, q, a, &target.TeamID, &target.ID, "application.create", req, map[string]any{"appId": row.ID, "cloneFromAppId": source.ID, "sourceConfigVersion": sourceVersion}); err != nil {
			return Application{}, err
		}
		return appDTO(row), nil
	})
}
