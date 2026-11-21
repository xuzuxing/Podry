package application

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/gitremote"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/project"
	"github.com/xuzuxing/podry/internal/registry"
)

type Service struct {
	pool           *pgxpool.Pool
	q              *sqlcdb.Queries
	vault          *credential.Vault
	git            GitReader
	cursorKey      []byte
	builds         *build.Service
	releases       ReleaseQueue
	urlPolicy      credential.URLPolicy
	buildLogMu     sync.Mutex
	buildLogUsers  map[string]int
	buildLogActive int
	images         ImageReader
	// HealthPollingEnabled opts into read-only background cluster observations.
	HealthPollingEnabled bool
}

func (s *Service) UseBuilds(b *build.Service) *Service { s.builds = b; return s }

func (s *Service) WithURLPolicy(p credential.URLPolicy) *Service { s.urlPolicy = p; return s }

func New(pool *pgxpool.Pool, vault *credential.Vault, reader GitReader, cursorKey string) *Service {
	if reader == nil {
		reader = gitremote.New(nil)
	}
	return &Service{pool: pool, q: sqlcdb.New(pool), vault: vault, git: reader, cursorKey: []byte(cursorKey), images: &registry.Client{}}
}
func appDTO(a sqlcdb.Application) Application {
	health := "unknown"
	if a.ArchivedAt != nil {
		health = "stopped"
	}
	return Application{a.ID, a.ProjectID, a.Name, a.Description, a.SourceMode, health, a.ArchivedAt, a.UpdatedAt}
}
func lockProject(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, id, action string) (sqlcdb.Project, error) {
	p, err := q.GetProject(ctx, id)
	if err != nil {
		return p, err
	}
	if _, err = q.LockTeam(ctx, p.TeamID); err != nil {
		return p, err
	}
	p, err = q.LockProject(ctx, id)
	if err != nil {
		return p, err
	}
	role, err := project.ProjectRole(ctx, q, a, id)
	if err != nil {
		return p, err
	}
	return p, project.RequireRole(role, action)
}
func access(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, id string, write bool) (sqlcdb.Application, error) {
	row, err := q.GetApplication(ctx, id)
	if err != nil {
		return row, err
	}
	if write {
		if err = auth.LockActor(ctx, q, a); err != nil {
			return row, err
		}
		if _, err = lockProject(ctx, q, a, row.ProjectID, "configure"); err != nil {
			return row, err
		}
		return q.LockApplication(ctx, id)
	}
	_, err = project.ProjectRole(ctx, q, a, row.ProjectID)
	return row, err
}
func mutable(a sqlcdb.Application) error {
	if a.ArchivedAt != nil {
		return httpx.Fail(409, "application_archived", "应用已归档")
	}
	return nil
}
func (s *Service) Create(ctx context.Context, a auth.Actor, in ApplicationInput, req string) (Application, error) {
	if err := httpx.UUID(in.ProjectID); err != nil {
		return Application{}, err
	}
	if !regexp.MustCompile(`^[a-z][a-z0-9-]{1,61}[a-z0-9]$`).MatchString(in.Name) || len(in.Description) > 4000 {
		return Application{}, httpx.Invalid("应用名称或描述无效")
	}
	if in.CloneFromAppID != nil {
		if err := httpx.UUID(*in.CloneFromAppID); err != nil {
			return Application{}, err
		}
	}
	if in.SourceMode != "git" && in.SourceMode != "image" {
		return Application{}, httpx.Invalid("sourceMode 必须为 git 或 image")
	}
	if in.CloneFromAppID != nil {
		return s.clone(ctx, a, in, req)
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Application, error) {
		if err := auth.LockActor(ctx, q, a); err != nil {
			return Application{}, err
		}
		p, err := lockProject(ctx, q, a, in.ProjectID, "configure")
		if err != nil {
			return Application{}, err
		}
		row, err := q.CreateApplication(ctx, sqlcdb.CreateApplicationParams{ProjectID: in.ProjectID, Name: in.Name, Description: in.Description, SourceMode: in.SourceMode})
		if err != nil {
			return Application{}, err
		}
		err = project.Record(ctx, q, a, &p.TeamID, &p.ID, "application.create", req, map[string]string{"appId": row.ID})
		return appDTO(row), err
	})
}
func (s *Service) Get(ctx context.Context, a auth.Actor, id string) (Application, error) {
	row, err := access(ctx, s.q, a, id, false)
	if err != nil {
		return Application{}, err
	}
	out := appDTO(row)
	out.Health, err = s.q.GetApplicationHealth(ctx, id)
	return out, err
}
func (s *Service) List(ctx context.Context, a auth.Actor, projectID, environmentID *string, health, keyword string, page httpx.Pagination) (httpx.PageResult[Application], error) {
	out := httpx.PageResult[Application]{Items: []Application{}, Page: page.Page, PageSize: page.PageSize}
	if projectID != nil {
		if _, err := project.ProjectRole(ctx, s.q, a, *projectID); err != nil {
			return out, err
		}
	}
	if health != "" && !slices.Contains([]string{"unknown", "progressing", "healthy", "completed", "degraded", "stopped"}, health) {
		return out, httpx.Invalid("health 无效")
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (httpx.PageResult[Application], error) {
		// Both queries use the same transaction time for observation expiry.
		total, err := q.CountApplications(ctx, sqlcdb.CountApplicationsParams{ProjectID: projectID, EnvironmentID: environmentID, Health: health, Keyword: keyword, IsSuperAdmin: a.IsSuperAdmin, UserID: a.ID})
		if err != nil {
			return out, err
		}
		rows, err := q.ListApplications(ctx, sqlcdb.ListApplicationsParams{ProjectID: projectID, EnvironmentID: environmentID, Health: health, Keyword: keyword, IsSuperAdmin: a.IsSuperAdmin, UserID: a.ID, PageLimit: int32(page.PageSize), PageOffset: page.Offset()})
		out.Total = total
		for _, r := range rows {
			out.Items = append(out.Items, Application{r.ID, r.ProjectID, r.Name, r.Description, r.SourceMode, r.EffectiveHealth, r.ArchivedAt, r.UpdatedAt})
		}
		return out, err
	})
}
func record(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, action, req string, target any) error {
	p, err := q.GetProject(ctx, app.ProjectID)
	if err != nil {
		return err
	}
	return project.Record(ctx, q, a, &p.TeamID, &p.ID, action, req, target)
}
func (s *Service) Update(ctx context.Context, a auth.Actor, id string, in ApplicationPatch, req string) (Application, error) {
	if in.Description == nil && in.Archived == nil {
		return Application{}, httpx.Invalid("至少修改一个字段")
	}
	if in.Description != nil && len(*in.Description) > 4000 {
		return Application{}, httpx.Invalid("描述过长")
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Application, error) {
		row, err := access(ctx, q, a, id, true)
		if err != nil {
			return Application{}, err
		}
		if in.Description != nil {
			row.Description = *in.Description
		}
		if in.Archived != nil {
			if *in.Archived && row.ArchivedAt == nil {
				active, e := q.HasActiveBuilds(ctx, id)
				if e != nil {
					return Application{}, e
				}
				if active {
					return Application{}, httpx.Fail(409, "active_builds", "应用仍有活动或结果未知的构建")
				}
				active, e = q.HasActiveDeployments(ctx, id)
				if e != nil {
					return Application{}, e
				}
				if active {
					return Application{}, httpx.Fail(409, "active_deployments", "应用仍有活动或结果未知的发布")
				}
				now := time.Now().UTC()
				row.ArchivedAt = &now
			} else if !*in.Archived {
				row.ArchivedAt = nil
			}
		}
		row, err = q.UpdateApplication(ctx, sqlcdb.UpdateApplicationParams{ID: id, Description: row.Description, ArchivedAt: row.ArchivedAt})
		if err != nil {
			return Application{}, err
		}
		err = record(ctx, q, a, row, "application.update", req, map[string]any{"appId": id, "archived": row.ArchivedAt != nil})
		if err != nil {
			return Application{}, err
		}
		out := appDTO(row)
		out.Health, err = q.GetApplicationHealth(ctx, id)
		return out, err
	})
}
func readConfig(ctx context.Context, q *sqlcdb.Queries, id string, version int32) (Config, error) {
	c := Config{AppID: id, DeployValues: map[string]any{}, SecretRefs: []SecretRef{}}
	row, err := q.GetAppConfig(ctx, sqlcdb.GetAppConfigParams{AppID: id, Version: version})
	if errors.Is(err, pgx.ErrNoRows) && version == 0 {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	c.Version = row.Version
	for _, v := range []struct {
		data   []byte
		target any
	}{{row.GitConfig, &c.GitConfig}, {row.BuildConfig, &c.BuildConfig}, {row.ChartConfig, &c.ChartConfig}, {row.DeployValues, &c.DeployValues}, {row.SecretRefs, &c.SecretRefs}} {
		if len(v.data) > 0 {
			if err = json.Unmarshal(v.data, v.target); err != nil {
				return c, err
			}
		}
	}
	return c, nil
}
func (s *Service) GetConfig(ctx context.Context, a auth.Actor, id string, version int32) (Config, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Config, error) {
		if _, err := view(ctx, q, a, id); err != nil {
			return Config{}, err
		}
		return readConfig(ctx, q, id, version)
	})
}
func nullableJSON(v any) []byte {
	data, _ := json.Marshal(v)
	if string(data) == "null" {
		return nil
	}
	return data
}
func (s *Service) SaveConfig(ctx context.Context, a auth.Actor, id string, in ConfigInput, req string) (Config, error) {
	if in.ExpectedVersion == nil || *in.ExpectedVersion < 0 {
		return Config{}, httpx.Invalid("expectedVersion 必填且不能为负")
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Config, error) {
		app, err := access(ctx, q, a, id, true)
		if err != nil {
			return Config{}, err
		}
		if err = mutable(app); err != nil {
			return Config{}, err
		}
		c, err := readConfig(ctx, q, id, 0)
		if err != nil {
			return c, err
		}
		if c.Version != *in.ExpectedVersion {
			return c, httpx.Fail(409, "revision_conflict", "应用配置版本已变化")
		}
		switch in.Section {
		case "git":
			if in.GitConfig == nil || in.BuildConfig != nil || in.ChartConfig != nil || in.DeployValues != nil || in.SecretRefs != nil {
				return c, httpx.Invalid("git 节只能包含 gitConfig")
			}
			c.GitConfig = in.GitConfig
		case "build":
			if in.BuildConfig == nil || in.GitConfig != nil || in.ChartConfig != nil || in.DeployValues != nil || in.SecretRefs != nil {
				return c, httpx.Invalid("build 节只能包含 buildConfig")
			}
			c.BuildConfig = in.BuildConfig
		case "base":
			if in.ChartConfig == nil || in.DeployValues == nil || in.SecretRefs == nil || in.GitConfig != nil || in.BuildConfig != nil {
				return c, httpx.Invalid("base 节需要 chartConfig/deployValues/secretRefs")
			}
			if c.ChartConfig != nil && c.ChartConfig.WorkloadKind != in.ChartConfig.WorkloadKind {
				return c, httpx.Fail(409, "chart_type_locked", "首次保存后不能修改 workloadKind")
			}
			c.ChartConfig = in.ChartConfig
			c.DeployValues = in.DeployValues
			c.SecretRefs = in.SecretRefs
		default:
			return c, httpx.Invalid("section 必须为 git/build/base")
		}
		if err = s.validateConfig(ctx, q, a, app, c); err != nil {
			return c, err
		}
		if in.Section == "base" {
			bindings, err := q.ListBindings(ctx, id)
			if err != nil {
				return c, err
			}
			for _, b := range bindings {
				if _, err = bindingConfig(c, b.OverrideValues); err != nil {
					return c, err
				}
			}
		}
		c.Version++
		err = q.InsertAppConfig(ctx, sqlcdb.InsertAppConfigParams{AppID: id, Version: c.Version, GitConfig: nullableJSON(c.GitConfig), BuildConfig: nullableJSON(c.BuildConfig), ChartConfig: nullableJSON(c.ChartConfig), DeployValues: nullableJSON(c.DeployValues), SecretRefs: nullableJSON(c.SecretRefs), CreatedBy: a.ID})
		if err != nil {
			return c, err
		}
		if err = q.TouchApplication(ctx, id); err != nil {
			return c, err
		}
		err = record(ctx, q, a, app, "application.config.save", req, map[string]any{"appId": id, "version": c.Version, "section": in.Section})
		return c, err
	})
}
func (s *Service) GetSetup(ctx context.Context, a auth.Actor, id string) (Setup, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Setup, error) {
		app, err := view(ctx, q, a, id)
		if err != nil {
			return Setup{}, err
		}
		c, err := readConfig(ctx, q, id, 0)
		if err != nil {
			return Setup{}, err
		}
		return s.deriveSetup(ctx, q, a, app, c)
	})
}

// Hold a shared application lock while reading its configuration and workflow,
// so a response cannot mix a new pipeline set with an earlier workflow version.
func view(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, id string) (sqlcdb.Application, error) {
	app, err := q.ShareApplication(ctx, id)
	if err != nil {
		return app, err
	}
	_, err = project.ProjectRole(ctx, q, a, app.ProjectID)
	return app, err
}
func (s *Service) deriveSetup(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, app sqlcdb.Application, c Config) (Setup, error) {
	w, err := readWorkflow(ctx, q, app)
	if err != nil {
		return Setup{}, err
	}
	out := Setup{AppID: app.ID, ConfigVersion: c.Version, WorkflowVersion: w.Version, Total: 4, Steps: []Step{}, DeployableBindingIDs: []string{}}
	ci := false
	manualCI := false
	cd := false
	for _, p := range w.Items {
		if p.Kind == "ci" && p.Enabled {
			ci = true
			var definition CI
			if json.Unmarshal(nullableJSON(p.Definition), &definition) == nil {
				manualCI = definition.Manual
			}
		}
		if p.Kind == "cd" && p.Enabled {
			cd = true
		}
	}
	facts := []struct {
		key   string
		ready bool
	}{{"git", c.GitConfig != nil}, {"build", c.BuildConfig != nil}, {"base", c.ChartConfig != nil}, {"workflow", ci && cd}}
	if app.SourceMode == "image" {
		out.Total = 2
		facts = facts[2:]
		facts[1].ready = cd
	}
	for _, f := range facts {
		st := Step{Key: f.key, Status: "pending", Blockers: []Blocker{}}
		if f.ready {
			st.Status = "complete"
			out.Completed++
		} else {
			st.Blockers = append(st.Blockers, Blocker{"configuration_missing", "尚未完成配置", f.key})
			if out.NextSection == nil {
				k := f.key
				out.NextSection = &k
			}
		}
		out.Steps = append(out.Steps, st)
	}
	// The original control-plane batch had no runner or verified image artifacts.
	// B4 enables build submission from configured execution inputs; artifact and
	// deployment readiness remain independent and require actual execution evidence.
	out.CanBuild = false
	buildAvailable := false
	role, err := project.ProjectRole(ctx, q, a, app.ProjectID)
	if err != nil {
		return out, err
	}
	if s.builds != nil && s.builds.Ready() == nil && c.GitConfig != nil && c.BuildConfig != nil && ci && app.ArchivedAt == nil && c.BuildConfig.Platform == s.builds.Settings.Platform && project.RequireRole(role, "build") == nil {
		buildAvailable = true
		out.CanBuild = manualCI
	}
	if ci {
		if !buildAvailable {
			out.Steps[len(out.Steps)-1].Blockers = append(out.Steps[len(out.Steps)-1].Blockers, Blocker{"execution_unavailable", "执行环境尚未就绪；工作流可以保存", "workflow"})
		}
	}
	if cd && (s.releases == nil || s.releases.Ready(Target{}) != nil) {
		out.Steps[len(out.Steps)-1].Blockers = append(out.Steps[len(out.Steps)-1].Blockers, Blocker{"deployment_execution_unavailable", "发布执行器尚未接入；可以保存工作流并预览", "workflow"})
	}
	if app.ArchivedAt != nil {
		out.Steps[len(out.Steps)-1].Status = "blocked"
		out.Steps[len(out.Steps)-1].Blockers = append(out.Steps[len(out.Steps)-1].Blockers, Blocker{"application_archived", "应用已归档", "workflow"})
	}
	if cd && app.ArchivedAt == nil && c.ChartConfig != nil && s.releases != nil && project.RequireRole(role, "deploy") == nil {
		out.DeployableBindingIDs, err = s.deployableBindings(ctx, q, a, app, c)
		if err != nil {
			return out, err
		}
	}
	return out, nil
}
func validBranch(s string) bool {
	return gitremote.ValidBranch(s)
}
