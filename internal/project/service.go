package project

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
)

type Team struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Project struct {
	ID     string `json:"id"`
	TeamID string `json:"teamId"`
	Name   string `json:"name"`
}
type Member struct {
	UserID string `json:"userId"`
	Role   string `json:"role"`
}
type Service struct {
	pool *pgxpool.Pool
	q    *sqlcdb.Queries
}

func New(pool *pgxpool.Pool) *Service { return &Service{pool, sqlcdb.New(pool)} }

// Team membership grants team visibility. Only team admins inherit project roles.
// Other team members need explicit project membership to access its applications.
func TeamRole(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, id string) (string, error) {
	if _, err := q.GetTeam(ctx, id); err != nil {
		return "", err
	}
	if a.IsSuperAdmin {
		return "admin", nil
	}
	role, err := q.GetTeamRole(ctx, sqlcdb.GetTeamRoleParams{TeamID: id, UserID: a.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", httpx.NotFound()
	}
	return role, err
}
func ProjectRole(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, id string) (string, error) {
	if _, err := q.GetProject(ctx, id); err != nil {
		return "", err
	}
	if a.IsSuperAdmin {
		return "admin", nil
	}
	role, err := q.GetProjectRole(ctx, sqlcdb.GetProjectRoleParams{ProjectID: id, UserID: a.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", httpx.NotFound()
	}
	return role, err
}
func RequireRole(role, action string) error {
	allowed := role == "admin"
	switch action {
	case "view":
		allowed = role != ""
	case "configure", "build":
		allowed = allowed || role == "developer"
	case "deploy":
		allowed = allowed || role == "developer" || role == "operator"
	}
	if !allowed {
		return httpx.Forbidden()
	}
	return nil
}
func Record(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, teamID, projectID *string, action, requestID string, target any) error {
	data, err := json.Marshal(target)
	if err != nil {
		return err
	}
	return q.RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &a.ID, TeamID: teamID, ProjectID: projectID, Action: action, Target: data, RequestID: requestID, Result: "succeeded"})
}
func (s *Service) ListTeams(ctx context.Context, a auth.Actor) ([]Team, error) {
	rows, err := s.q.ListTeams(ctx, sqlcdb.ListTeamsParams{IsSuperAdmin: a.IsSuperAdmin, UserID: a.ID})
	out := make([]Team, 0, len(rows))
	for _, r := range rows {
		out = append(out, Team{r.ID, r.Name})
	}
	return out, err
}
func (s *Service) ListProjects(ctx context.Context, a auth.Actor, teamID *string) ([]Project, error) {
	if teamID != nil {
		if _, err := TeamRole(ctx, s.q, a, *teamID); err != nil {
			return nil, err
		}
	}
	rows, err := s.q.ListProjects(ctx, sqlcdb.ListProjectsParams{IsSuperAdmin: a.IsSuperAdmin, UserID: a.ID, TeamID: teamID})
	out := make([]Project, 0, len(rows))
	for _, r := range rows {
		out = append(out, Project{r.ID, r.TeamID, r.Name})
	}
	return out, err
}
func (s *Service) CreateTeam(ctx context.Context, a auth.Actor, name, requestID string) (Team, error) {
	name, err := httpx.Name(name)
	if err != nil {
		return Team{}, err
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Team, error) {
		if err := auth.LockActor(ctx, q, a); err != nil {
			return Team{}, err
		}
		if !a.IsSuperAdmin {
			return Team{}, httpx.Forbidden()
		}
		t, err := q.CreateTeam(ctx, name)
		if err != nil {
			return Team{}, err
		}
		if err = q.UpsertTeamMember(ctx, sqlcdb.UpsertTeamMemberParams{TeamID: t.ID, UserID: a.ID, Role: "admin"}); err != nil {
			return Team{}, err
		}
		if err = Record(ctx, q, a, &t.ID, nil, "teams.create", requestID, map[string]string{"teamId": t.ID}); err != nil {
			return Team{}, err
		}
		return Team{t.ID, t.Name}, nil
	})
}
func (s *Service) CreateProject(ctx context.Context, a auth.Actor, teamID, name, requestID string) (Project, error) {
	if err := httpx.UUID(teamID); err != nil {
		return Project{}, err
	}
	name, err := httpx.Name(name)
	if err != nil {
		return Project{}, err
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Project, error) {
		if err := auth.LockActor(ctx, q, a); err != nil {
			return Project{}, err
		}
		if _, err := q.LockTeam(ctx, teamID); err != nil {
			return Project{}, err
		}
		role, err := TeamRole(ctx, q, a, teamID)
		if err != nil {
			return Project{}, err
		}
		if err = RequireRole(role, "admin"); err != nil {
			return Project{}, err
		}
		p, err := q.CreateProject(ctx, sqlcdb.CreateProjectParams{TeamID: teamID, Name: name})
		if err != nil {
			return Project{}, err
		}
		if _, err = q.GetTeamRole(ctx, sqlcdb.GetTeamRoleParams{TeamID: teamID, UserID: a.ID}); err == nil {
			err = q.UpsertProjectMember(ctx, sqlcdb.UpsertProjectMemberParams{ProjectID: p.ID, TeamID: teamID, UserID: a.ID, Role: "admin"})
		} else if errors.Is(err, pgx.ErrNoRows) {
			err = nil
		}
		if err != nil {
			return Project{}, err
		}
		if err = Record(ctx, q, a, &teamID, &p.ID, "projects.create", requestID, map[string]string{"projectId": p.ID}); err != nil {
			return Project{}, err
		}
		return Project{p.ID, p.TeamID, p.Name}, nil
	})
}
func (s *Service) Members(ctx context.Context, a auth.Actor, scope, id string) ([]Member, error) {
	out := []Member{}
	if scope == "teams" {
		role, err := TeamRole(ctx, s.q, a, id)
		if err != nil {
			return nil, err
		}
		if err = RequireRole(role, "admin"); err != nil {
			return nil, err
		}
		rows, err := s.q.ListTeamMembers(ctx, id)
		for _, r := range rows {
			out = append(out, Member{r.UserID, r.Role})
		}
		return out, err
	}
	role, err := ProjectRole(ctx, s.q, a, id)
	if err != nil {
		return nil, err
	}
	if err = RequireRole(role, "admin"); err != nil {
		return nil, err
	}
	rows, err := s.q.ListProjectMembers(ctx, id)
	for _, r := range rows {
		out = append(out, Member{r.UserID, r.Role})
	}
	return out, err
}
func (s *Service) ChangeMember(ctx context.Context, a auth.Actor, scope, id string, m Member, remove bool, requestID string) error {
	if err := httpx.UUID(m.UserID); err != nil {
		return err
	}
	if !remove {
		switch m.Role {
		case "admin", "developer", "operator", "viewer":
		default:
			return httpx.Invalid("成员角色无效")
		}
	}
	_, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		if err := auth.LockActor(ctx, q, a); err != nil {
			return false, err
		}
		var teamID string
		var projectID *string
		if scope == "teams" {
			teamID = id
		} else {
			p, err := q.GetProject(ctx, id)
			if err != nil {
				return false, err
			}
			teamID = p.TeamID
			projectID = &p.ID
		}
		if _, err := q.LockTeam(ctx, teamID); err != nil {
			return false, err
		}
		var role string
		var err error
		if scope == "teams" {
			role, err = TeamRole(ctx, q, a, id)
		} else {
			if _, err = q.LockProject(ctx, id); err != nil {
				return false, err
			}
			role, err = ProjectRole(ctx, q, a, id)
		}
		if err != nil {
			return false, err
		}
		if err = RequireRole(role, "admin"); err != nil {
			return false, err
		}
		u, err := q.GetUser(ctx, m.UserID)
		if err != nil {
			return false, err
		}
		if !remove && u.DisabledAt != nil {
			return false, httpx.Invalid("不能关联已停用的账户")
		}
		if scope == "teams" {
			current, e := q.GetTeamRole(ctx, sqlcdb.GetTeamRoleParams{TeamID: id, UserID: m.UserID})
			if e != nil && !errors.Is(e, pgx.ErrNoRows) {
				return false, e
			}
			if remove && errors.Is(e, pgx.ErrNoRows) {
				return false, httpx.NotFound()
			}
			if current == "admin" && (remove || m.Role != "admin") && u.DisabledAt == nil {
				n, e := q.CountTeamAdmins(ctx, id)
				if e != nil {
					return false, e
				}
				if n <= 1 {
					return false, httpx.Fail(409, "last_admin", "不能移除或降级最后一个团队管理员")
				}
			}
			if remove {
				_, err = q.RemoveTeamMember(ctx, sqlcdb.RemoveTeamMemberParams{TeamID: id, UserID: m.UserID})
			} else {
				err = q.UpsertTeamMember(ctx, sqlcdb.UpsertTeamMemberParams{TeamID: id, UserID: m.UserID, Role: m.Role})
			}
		} else {
			if remove {
				n, e := q.RemoveProjectMember(ctx, sqlcdb.RemoveProjectMemberParams{ProjectID: id, UserID: m.UserID})
				err = e
				if err == nil && n == 0 {
					err = httpx.NotFound()
				}
			} else {
				if _, e := q.GetTeamRole(ctx, sqlcdb.GetTeamRoleParams{TeamID: teamID, UserID: m.UserID}); e != nil {
					return false, httpx.Invalid("请先将该账户关联到项目所属团队")
				}
				err = q.UpsertProjectMember(ctx, sqlcdb.UpsertProjectMemberParams{ProjectID: id, TeamID: teamID, UserID: m.UserID, Role: m.Role})
			}
		}
		if err != nil {
			return false, err
		}
		action := scope + ".members.upsert"
		if remove {
			action = scope + ".members.remove"
		}
		err = Record(ctx, q, a, &teamID, projectID, action, requestID, map[string]string{"scopeId": id, "userId": m.UserID, "role": m.Role})
		return true, err
	})
	return err
}
