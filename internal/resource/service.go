// Package resource implements permission-scoped Kubernetes browsing and writes.
package resource

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"slices"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/kubernetes"
)

type Service struct {
	pool       *pgxpool.Pool
	vault      *credential.Vault
	signingKey []byte
	mu         sync.Mutex
	streams    map[string]int
	active     int
	// RecheckInterval bounds permission revocation latency for active log streams.
	RecheckInterval time.Duration
	// Writes require an explicit opt-in. Previewing never persists cluster objects.
	WritesEnabled bool
	// PublicOrigin is an optional trusted origin for TLS-terminating proxies.
	PublicOrigin string
	execMu       sync.Mutex
	execSessions map[string]*execSession
	execClosing  bool
	execWG       sync.WaitGroup
}

func New(pool *pgxpool.Pool, vault *credential.Vault, secret string) *Service {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("podry/resource-cursor/v1"))
	return &Service{pool: pool, vault: vault, signingKey: mac.Sum(nil), streams: map[string]int{}, RecheckInterval: 5 * time.Second}
}

type snapshot struct {
	cluster     sqlcdb.Cluster
	credential  sqlcdb.Credential
	grants      []sqlcdb.ResourceGrant
	fingerprint string
	payload     map[string]any
	admin       bool
}

func (s *Service) snapshot(ctx context.Context, a auth.Actor, id string, decrypt bool) (snapshot, error) {
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (snapshot, error) {
		return s.snapshotQuery(ctx, q, a, id, decrypt)
	})
}
func (s *Service) snapshotQuery(ctx context.Context, q *sqlcdb.Queries, a auth.Actor, id string, decrypt bool) (snapshot, error) {
	out := snapshot{admin: a.IsSuperAdmin}
	if err := auth.LockActor(ctx, q, a); err != nil {
		return out, err
	}
	var err error
	out.cluster, err = q.ShareCluster(ctx, id)
	if err != nil {
		return out, err
	}
	out.grants, err = q.ActorClusterGrants(ctx, sqlcdb.ActorClusterGrantsParams{ClusterID: id, UserID: &a.ID})
	if err != nil {
		return out, err
	}
	if !a.IsSuperAdmin && len(out.grants) == 0 {
		return out, httpx.NotFound()
	}
	out.credential, err = q.GetCredential(ctx, out.cluster.CredentialID)
	if err != nil {
		return out, err
	}
	data, _ := json.Marshal(out.grants)
	sum := sha256.Sum256(data)
	out.fingerprint = hex.EncodeToString(sum[:])
	if decrypt {
		v, e := q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: out.credential.ID, Version: out.credential.Version})
		if e != nil {
			return out, e
		}
		out.payload, err = s.vault.Open(out.credential.ID, out.credential.Version, v.KeyID, v.EncryptedPayload)
		if err == nil && out.payload["apiServer"] != out.cluster.ApiServer {
			err = httpx.Fail(409, "revision_conflict", "集群凭据绑定已变化")
		}
	}
	return out, err
}
func (s *Service) recheck(ctx context.Context, a auth.Actor, old snapshot) error {
	now, err := s.snapshot(ctx, a, old.cluster.ID, false)
	if err != nil {
		return err
	}
	return recheckSnapshot(old, now)
}

func recheckSnapshot(old, now snapshot) error {
	if now.cluster.CredentialID != old.cluster.CredentialID || now.credential.Version != old.credential.Version || now.cluster.ApiServer != old.cluster.ApiServer || now.fingerprint != old.fingerprint {
		return httpx.Fail(409, "revision_conflict", "集群配置、凭据或资源授权已变化，请重新查询")
	}
	return nil
}
func (x snapshot) allows(resource, namespace, action string, namespaced bool) bool {
	if x.admin {
		return true
	}
	for _, g := range x.grants {
		if !slices.Contains(g.Actions, action) || (!slices.Contains(g.Resources, "*") && !slices.Contains(g.Resources, resource)) {
			continue
		}
		if namespaced && g.Namespace != "" && (g.Namespace == "*" || namespace != "" && g.Namespace == namespace) {
			return true
		}
		if !namespaced && g.Namespace == "" {
			return true
		}
	}
	return false
}
func (x snapshot) any(resource, action string) bool {
	if x.admin {
		return true
	}
	for _, g := range x.grants {
		if slices.Contains(g.Actions, action) && (resource == "" || slices.Contains(g.Resources, "*") || slices.Contains(g.Resources, resource)) {
			return true
		}
	}
	return false
}
func (s *Service) client(ctx context.Context, a auth.Actor, id, resource, action string) (snapshot, *kubernetes.Client, error) {
	// Authorization is established before decrypting credentials or making remote calls.
	x, err := s.snapshot(ctx, a, id, false)
	if err != nil {
		return x, nil, err
	}
	if !x.any(resource, action) {
		return x, nil, httpx.NotFound()
	}
	y, err := s.snapshot(ctx, a, id, true)
	if err != nil {
		return x, nil, err
	}
	if y.fingerprint != x.fingerprint {
		return x, nil, httpx.Fail(409, "revision_conflict", "资源授权已变化")
	}
	c, err := kubernetes.New(y.payload)
	return y, c, err
}
