package platform

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/project"
)

type Service struct {
	pool      *pgxpool.Pool
	q         *sqlcdb.Queries
	vault     *credential.Vault
	urlPolicy credential.URLPolicy
}

func New(pool *pgxpool.Pool, vault *credential.Vault) *Service {
	return &Service{pool: pool, q: sqlcdb.New(pool), vault: vault}
}

func (s *Service) WithURLPolicy(p credential.URLPolicy) *Service { s.urlPolicy = p; return s }

type Credential struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Kind    string  `json:"kind"`
	TeamID  *string `json:"teamId"`
	Version int32   `json:"version"`
}
type CredentialInput struct {
	Name    string         `json:"name"`
	Kind    string         `json:"kind"`
	TeamID  *string        `json:"teamId"`
	Payload map[string]any `json:"payload"`
}
type CredentialUpdate struct {
	ExpectedVersion int32          `json:"expectedVersion"`
	Payload         map[string]any `json:"payload"`
}
type Registry struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Endpoint     string  `json:"endpoint"`
	CredentialID *string `json:"credentialId"`
}
type RegistryInput struct {
	Name         string  `json:"name"`
	Endpoint     string  `json:"endpoint"`
	CredentialID *string `json:"credentialId"`
}
type Environment struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Production        bool   `json:"production"`
	AutoDeployAllowed bool   `json:"autoDeployAllowed"`
}
type EnvironmentInput struct {
	Name              string `json:"name"`
	Production        bool   `json:"production"`
	AutoDeployAllowed bool   `json:"autoDeployAllowed"`
}
type Cluster struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	APIServer        string     `json:"apiServer"`
	CredentialID     string     `json:"credentialId"`
	ConnectionStatus string     `json:"connectionStatus"`
	ServerVersion    *string    `json:"serverVersion"`
	LastCheckedAt    *time.Time `json:"lastCheckedAt"`
}
type ClusterInput struct {
	Name         string `json:"name"`
	APIServer    string `json:"apiServer"`
	CredentialID string `json:"credentialId"`
}
type ClusterPatch struct {
	Name         *string `json:"name"`
	CredentialID *string `json:"credentialId"`
}
type Grant struct {
	ID            string   `json:"id"`
	PrincipalType string   `json:"principalType"`
	PrincipalID   string   `json:"principalId"`
	ClusterID     string   `json:"clusterId"`
	Namespace     string   `json:"namespace"`
	Resources     []string `json:"resources"`
	Actions       []string `json:"actions"`
}
type GrantInput struct {
	PrincipalType string   `json:"principalType"`
	PrincipalID   string   `json:"principalId"`
	Namespace     string   `json:"namespace"`
	Resources     []string `json:"resources"`
	Actions       []string `json:"actions"`
}

func credentialDTO(c sqlcdb.Credential) Credential {
	return Credential{c.ID, c.Name, c.Kind, c.TeamID, c.Version}
}
func clusterDTO(c sqlcdb.Cluster) Cluster {
	return Cluster{c.ID, c.Name, c.ApiServer, c.CredentialID, c.ConnectionStatus, c.ServerVersion, c.LastCheckedAt}
}
func grantDTO(g sqlcdb.ResourceGrant) Grant {
	out := Grant{ID: g.ID, ClusterID: g.ClusterID, Namespace: g.Namespace, Resources: g.Resources, Actions: g.Actions}
	switch {
	case g.UserID != nil:
		out.PrincipalType = "user"
		out.PrincipalID = *g.UserID
	case g.TeamID != nil:
		out.PrincipalType = "team"
		out.PrincipalID = *g.TeamID
	case g.ProjectID != nil:
		out.PrincipalType = "project"
		out.PrincipalID = *g.ProjectID
	}
	return out
}
func admin(a auth.Actor) error {
	if !a.IsSuperAdmin {
		return httpx.Forbidden()
	}
	return nil
}
func CredentialAccess(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, c sqlcdb.Credential, teamID *string, manage bool) error {
	if teamID != nil && c.TeamID != nil && *teamID != *c.TeamID {
		return httpx.NotFound()
	}
	if a.IsSuperAdmin {
		return nil
	}
	if c.TeamID == nil {
		if manage || c.Kind == "kubeconfig" {
			return httpx.Forbidden()
		}
		return nil
	}
	role, err := project.TeamRole(ctx, q, a, *c.TeamID)
	if err != nil {
		return err
	}
	if manage {
		return project.RequireRole(role, "admin")
	}
	return nil
}
func (s *Service) ListCredentials(ctx context.Context, a auth.Actor) ([]Credential, error) {
	rows, err := s.q.ListCredentials(ctx, sqlcdb.ListCredentialsParams{IsSuperAdmin: a.IsSuperAdmin, UserID: a.ID})
	out := make([]Credential, 0, len(rows))
	for _, c := range rows {
		out = append(out, credentialDTO(c))
	}
	return out, err
}
func (s *Service) CreateCredential(ctx context.Context, a auth.Actor, in CredentialInput, req string) (Credential, error) {
	name, err := httpx.Name(in.Name)
	if err != nil {
		return Credential{}, err
	}
	if in.TeamID != nil {
		if err = httpx.UUID(*in.TeamID); err != nil {
			return Credential{}, err
		}
	}
	if err = credential.Validate(in.Kind, in.Payload); err != nil {
		return Credential{}, err
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Credential, error) {
		if err := auth.LockActor(ctx, q, a); err != nil {
			return Credential{}, err
		}
		if in.TeamID != nil {
			if _, err := q.LockTeam(ctx, *in.TeamID); err != nil {
				return Credential{}, err
			}
		}
		c := sqlcdb.Credential{ID: uuid.NewString(), Name: name, Kind: in.Kind, TeamID: in.TeamID, Version: 1}
		if err := CredentialAccess(ctx, q, a, c, nil, true); err != nil {
			return Credential{}, err
		}
		if in.Kind == "kubeconfig" && in.TeamID != nil {
			return Credential{}, httpx.Invalid("集群凭据必须属于平台作用域")
		}
		encrypted, key, err := s.vault.Seal(c.ID, 1, in.Payload)
		if err != nil {
			return Credential{}, err
		}
		c, err = q.CreateCredential(ctx, sqlcdb.CreateCredentialParams{ID: c.ID, TeamID: c.TeamID, Name: c.Name, Kind: c.Kind})
		if err != nil {
			return Credential{}, err
		}
		if err = q.InsertSecretVersion(ctx, sqlcdb.InsertSecretVersionParams{CredentialID: c.ID, Version: 1, EncryptedPayload: encrypted, KeyID: key}); err != nil {
			return Credential{}, err
		}
		err = project.Record(ctx, q, a, c.TeamID, nil, "credential.create", req, map[string]any{"credentialId": c.ID, "kind": c.Kind, "version": 1})
		return credentialDTO(c), err
	})
}
func (s *Service) RotateCredential(ctx context.Context, a auth.Actor, id string, in CredentialUpdate, req string) (Credential, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Credential, error) {
		if err := auth.LockActor(ctx, q, a); err != nil {
			return Credential{}, err
		}
		initial, err := q.GetCredential(ctx, id)
		if err != nil {
			return Credential{}, err
		}
		if initial.TeamID != nil {
			if _, err = q.LockTeam(ctx, *initial.TeamID); err != nil {
				return Credential{}, err
			}
		}
		if err = CredentialAccess(ctx, q, a, initial, nil, true); err != nil {
			return Credential{}, err
		}
		// Cluster rows precede credential rows in the lock order used by cluster changes.
		if err = q.InvalidateCredentialClusters(ctx, id); err != nil {
			return Credential{}, err
		}
		c, err := q.LockCredential(ctx, id)
		if err != nil {
			return Credential{}, err
		}
		if in.ExpectedVersion != c.Version {
			return Credential{}, httpx.Fail(409, "revision_conflict", "凭据版本已变化")
		}
		if err = credential.Validate(c.Kind, in.Payload); err != nil {
			return Credential{}, err
		}
		if c.Kind == "kubeconfig" {
			old, err := q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: id, Version: c.Version})
			if err != nil {
				return Credential{}, err
			}
			payload, err := s.vault.Open(id, c.Version, old.KeyID, old.EncryptedPayload)
			if err != nil {
				return Credential{}, err
			}
			if payload["apiServer"] != in.Payload["apiServer"] {
				return Credential{}, httpx.Invalid("轮换不能修改 apiServer；其他集群需创建独立凭据")
			}
		}
		encrypted, key, err := s.vault.Seal(id, c.Version+1, in.Payload)
		if err != nil {
			return Credential{}, err
		}
		if err = q.InsertSecretVersion(ctx, sqlcdb.InsertSecretVersionParams{CredentialID: id, Version: c.Version + 1, EncryptedPayload: encrypted, KeyID: key}); err != nil {
			return Credential{}, err
		}
		c, err = q.SetCredentialVersion(ctx, id)
		if err != nil {
			return Credential{}, err
		}
		err = project.Record(ctx, q, a, c.TeamID, nil, "credential.rotate", req, map[string]any{"credentialId": id, "version": c.Version})
		return credentialDTO(c), err
	})
}
func (s *Service) ListRegistries(ctx context.Context) ([]Registry, error) {
	rows, err := s.q.ListRegistries(ctx)
	out := make([]Registry, 0, len(rows))
	for _, r := range rows {
		out = append(out, Registry{r.ID, r.Name, r.Endpoint, r.CredentialID})
	}
	return out, err
}
func (s *Service) CreateRegistry(ctx context.Context, a auth.Actor, in RegistryInput, req string) (Registry, error) {
	name, err := httpx.Name(in.Name)
	if err != nil {
		return Registry{}, err
	}
	if err = s.urlPolicy.Validate(in.Endpoint, true); err != nil {
		return Registry{}, err
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Registry, error) {
		if err := auth.LockActor(ctx, q, a); err != nil {
			return Registry{}, err
		}
		if err := admin(a); err != nil {
			return Registry{}, err
		}
		if in.CredentialID != nil {
			if err := httpx.UUID(*in.CredentialID); err != nil {
				return Registry{}, err
			}
			c, err := q.GetCredential(ctx, *in.CredentialID)
			if err != nil {
				return Registry{}, err
			}
			if c.Kind != "registry" || c.TeamID != nil {
				return Registry{}, httpx.Invalid("Registry 必须引用平台级 registry 凭据")
			}
		}
		r, err := q.CreateRegistry(ctx, sqlcdb.CreateRegistryParams{Name: name, Endpoint: strings.TrimSuffix(in.Endpoint, "/"), CredentialID: in.CredentialID})
		if err != nil {
			return Registry{}, err
		}
		err = project.Record(ctx, q, a, nil, nil, "registry.create", req, map[string]string{"registryId": r.ID})
		return Registry{r.ID, r.Name, r.Endpoint, r.CredentialID}, err
	})
}
func (s *Service) ListEnvironments(ctx context.Context) ([]Environment, error) {
	rows, err := s.q.ListEnvironments(ctx)
	out := make([]Environment, 0, len(rows))
	for _, r := range rows {
		out = append(out, Environment{r.ID, r.Name, r.Production, r.AutoDeployAllowed})
	}
	return out, err
}
func (s *Service) CreateEnvironment(ctx context.Context, a auth.Actor, in EnvironmentInput, req string) (Environment, error) {
	name, err := httpx.Name(in.Name)
	if err != nil {
		return Environment{}, err
	}
	if in.AutoDeployAllowed && in.Production {
		return Environment{}, httpx.Invalid("生产环境只能手动部署")
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Environment, error) {
		if err := auth.LockActor(ctx, q, a); err != nil {
			return Environment{}, err
		}
		if err := admin(a); err != nil {
			return Environment{}, err
		}
		r, err := q.CreateEnvironment(ctx, sqlcdb.CreateEnvironmentParams{Name: name, Production: in.Production, AutoDeployAllowed: in.AutoDeployAllowed})
		if err != nil {
			return Environment{}, err
		}
		err = project.Record(ctx, q, a, nil, nil, "environment.create", req, map[string]string{"environmentId": r.ID})
		return Environment{r.ID, r.Name, r.Production, r.AutoDeployAllowed}, err
	})
}
func (s *Service) ListClusters(ctx context.Context, a auth.Actor) ([]Cluster, error) {
	rows, err := s.q.ListClusters(ctx, sqlcdb.ListClustersParams{IsSuperAdmin: a.IsSuperAdmin, UserID: &a.ID})
	out := make([]Cluster, 0, len(rows))
	for _, r := range rows {
		out = append(out, clusterDTO(r))
	}
	return out, err
}
func (s *Service) GetCluster(ctx context.Context, a auth.Actor, id string) (Cluster, error) {
	rows, err := s.ListClusters(ctx, a)
	if err != nil {
		return Cluster{}, err
	}
	for _, r := range rows {
		if r.ID == id {
			return r, nil
		}
	}
	return Cluster{}, httpx.NotFound()
}
func (s *Service) clusterCredential(ctx context.Context, q *sqlcdb.Queries, id, server string) error {
	if err := httpx.UUID(id); err != nil {
		return err
	}
	c, err := q.LockCredential(ctx, id)
	if err != nil {
		return err
	}
	if c.Kind != "kubeconfig" || c.TeamID != nil {
		return httpx.Invalid("集群必须引用平台级 kubeconfig 凭据")
	}
	v, err := q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: id, Version: c.Version})
	if err != nil {
		return err
	}
	p, err := s.vault.Open(id, c.Version, v.KeyID, v.EncryptedPayload)
	if err != nil {
		return err
	}
	if p["apiServer"] != server {
		return httpx.Invalid("集群 API 地址必须与凭据一致")
	}
	return nil
}
func (s *Service) CreateCluster(ctx context.Context, a auth.Actor, in ClusterInput, req string) (Cluster, error) {
	name, err := httpx.Name(in.Name)
	if err != nil {
		return Cluster{}, err
	}
	if err = credential.HTTPSURL(in.APIServer, true); err != nil {
		return Cluster{}, err
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Cluster, error) {
		if err := auth.LockActor(ctx, q, a); err != nil {
			return Cluster{}, err
		}
		if err := admin(a); err != nil {
			return Cluster{}, err
		}
		if err := s.clusterCredential(ctx, q, in.CredentialID, in.APIServer); err != nil {
			return Cluster{}, err
		}
		r, err := q.CreateCluster(ctx, sqlcdb.CreateClusterParams{Name: name, ApiServer: in.APIServer, CredentialID: in.CredentialID})
		if err != nil {
			return Cluster{}, err
		}
		err = recordCluster(ctx, q, a, r.ID, "cluster.create", req, map[string]string{"clusterId": r.ID})
		return clusterDTO(r), err
	})
}
func (s *Service) UpdateCluster(ctx context.Context, a auth.Actor, id string, in ClusterPatch, req string) (Cluster, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Cluster, error) {
		if err := auth.LockActor(ctx, q, a); err != nil {
			return Cluster{}, err
		}
		if err := admin(a); err != nil {
			return Cluster{}, err
		}
		r, err := q.LockCluster(ctx, id)
		if err != nil {
			return Cluster{}, err
		}
		if in.Name == nil && in.CredentialID == nil {
			return Cluster{}, httpx.Invalid("至少修改一个字段")
		}
		if in.Name != nil {
			r.Name, err = httpx.Name(*in.Name)
			if err != nil {
				return Cluster{}, err
			}
		}
		if in.CredentialID != nil {
			r.CredentialID = *in.CredentialID
		}
		if err = s.clusterCredential(ctx, q, r.CredentialID, r.ApiServer); err != nil {
			return Cluster{}, err
		}
		r, err = q.UpdateCluster(ctx, sqlcdb.UpdateClusterParams{ID: id, Name: r.Name, CredentialID: r.CredentialID})
		if err != nil {
			return Cluster{}, err
		}
		err = recordCluster(ctx, q, a, id, "cluster.update", req, map[string]string{"clusterId": id})
		return clusterDTO(r), err
	})
}
func (s *Service) ListGrants(ctx context.Context, a auth.Actor, clusterID string) ([]Grant, error) {
	if err := admin(a); err != nil {
		return nil, err
	}
	if _, err := s.q.GetCluster(ctx, clusterID); err != nil {
		return nil, err
	}
	rows, err := s.q.ListResourceGrants(ctx, clusterID)
	out := make([]Grant, 0, len(rows))
	for _, r := range rows {
		out = append(out, grantDTO(r))
	}
	return out, err
}

var Resources = []string{"*", "core/pods", "core/services", "core/configmaps", "core/secrets", "core/namespaces", "core/nodes", "core/events", "apps/deployments", "apps/statefulsets", "apps/daemonsets", "apps/replicasets", "batch/jobs", "batch/cronjobs", "networking.k8s.io/ingresses"}
var Actions = []string{"resource.view", "resource.write", "resource.delete", "pod.logs", "pod.exec", "secret.reveal", "node.manage"}

func (s *Service) CreateGrant(ctx context.Context, a auth.Actor, clusterID string, in GrantInput, req string) (Grant, error) {
	if err := httpx.UUID(in.PrincipalID); err != nil {
		return Grant{}, err
	}
	if in.Namespace != "" && in.Namespace != "*" && !DNSName(in.Namespace, 63) {
		return Grant{}, httpx.Invalid("namespace 无效")
	}
	if len(in.Resources) == 0 || len(in.Resources) > 128 || len(in.Actions) == 0 || len(in.Actions) > len(Actions) {
		return Grant{}, httpx.Invalid("resources/actions 必须非空且数量在允许范围内")
	}
	for _, r := range in.Resources {
		if !ValidResource(r) {
			return Grant{}, httpx.Invalid("不支持的资源类型")
		}
	}
	for _, r := range in.Actions {
		if !slices.Contains(Actions, r) {
			return Grant{}, httpx.Invalid("不支持的资源动作")
		}
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (Grant, error) {
		if err := auth.LockActor(ctx, q, a); err != nil {
			return Grant{}, err
		}
		if err := admin(a); err != nil {
			return Grant{}, err
		}
		if _, err := q.LockCluster(ctx, clusterID); err != nil {
			return Grant{}, err
		}
		p := sqlcdb.CreateResourceGrantParams{ClusterID: clusterID, Namespace: in.Namespace, Resources: in.Resources, Actions: in.Actions}
		switch in.PrincipalType {
		case "user":
			p.UserID = &in.PrincipalID
		case "team":
			p.TeamID = &in.PrincipalID
		case "project":
			p.ProjectID = &in.PrincipalID
		default:
			return Grant{}, httpx.Invalid("principalType 无效")
		}
		r, err := q.CreateResourceGrant(ctx, p)
		if err != nil {
			return Grant{}, err
		}
		err = recordCluster(ctx, q, a, clusterID, "resource_grant.create", req, map[string]string{"clusterId": clusterID, "grantId": r.ID})
		return grantDTO(r), err
	})
}

// ValidResource accepts discovery GVR keys, including custom resources, but no subresources.
func ValidResource(value string) bool {
	if value == "*" {
		return true
	}
	p := strings.Split(value, "/")
	if len(p) != 2 || len(p[0]) > 253 || !DNSName(p[1], 253) {
		return false
	}
	for _, label := range strings.Split(p[0], ".") {
		if !DNSName(label, 63) {
			return false
		}
	}
	return true
}
func (s *Service) DeleteGrant(ctx context.Context, a auth.Actor, clusterID, id, req string) error {
	_, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		if err := auth.LockActor(ctx, q, a); err != nil {
			return false, err
		}
		if err := admin(a); err != nil {
			return false, err
		}
		if _, err := q.LockCluster(ctx, clusterID); err != nil {
			return false, err
		}
		n, err := q.DeleteResourceGrant(ctx, sqlcdb.DeleteResourceGrantParams{ID: id, ClusterID: clusterID})
		if err != nil {
			return false, err
		}
		if n == 0 {
			return false, httpx.NotFound()
		}
		return true, recordCluster(ctx, q, a, clusterID, "resource_grant.delete", req, map[string]string{"clusterId": clusterID, "grantId": id})
	})
	return err
}
func DNSName(s string, max int) bool {
	if len(s) < 1 || len(s) > max || s[0] == '-' || s[len(s)-1] == '-' {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return true
}

func recordCluster(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, clusterID, action, req string, target any) error {
	data, err := json.Marshal(target)
	if err != nil {
		return err
	}
	return q.RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &a.ID, ClusterID: &clusterID, Action: action, Target: data, RequestID: req, Result: "succeeded"})
}

// Call under the cluster row lock for a mutation so grant revocation is serialized.
func RequireTarget(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, projectID, clusterID, namespace, resource, action string) error {
	if a.IsSuperAdmin {
		return nil
	}
	rows, err := q.ActorResourceGrants(ctx, sqlcdb.ActorResourceGrantsParams{ClusterID: clusterID, UserID: &a.ID, ProjectID: &projectID})
	if err != nil {
		return err
	}
	for _, g := range rows {
		if (g.Namespace == namespace || (g.Namespace == "*" && namespace != "")) && (slices.Contains(g.Resources, "*") || slices.Contains(g.Resources, resource)) && slices.Contains(g.Actions, action) {
			// A team grant can come from another team the actor belongs to.
			// Lock that membership itself, without reversing the team-row lock order.
			if g.TeamID != nil {
				_, err := q.LockGrantMembership(ctx, sqlcdb.LockGrantMembershipParams{TeamID: *g.TeamID, UserID: a.ID})
				if errors.Is(err, pgx.ErrNoRows) {
					continue
				}
				if err != nil {
					return err
				}
			}
			return nil
		}
	}
	return httpx.Forbidden()
}
