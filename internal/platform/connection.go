package platform

import (
	"context"
	"strings"
	"time"

	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"github.com/xuzuxing/podry/internal/kubernetes"
)

type ConnectionTest struct {
	Status        string    `json:"status"`
	ServerVersion *string   `json:"serverVersion"`
	Message       string    `json:"message"`
	CheckedAt     time.Time `json:"checkedAt"`
}
type connectionSnapshot struct {
	cluster sqlcdb.Cluster
	version int32
	payload map[string]any
}

func (s *Service) TestConnection(ctx context.Context, a auth.Actor, id, request string) (ConnectionTest, error) {
	out := ConnectionTest{}
	if err := admin(a); err != nil {
		return out, err
	}
	x, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (connectionSnapshot, error) {
		var x connectionSnapshot
		if e := auth.LockActor(ctx, q, a); e != nil {
			return x, e
		}
		var e error
		x.cluster, e = q.ShareCluster(ctx, id)
		if e != nil {
			return x, e
		}
		c, e := q.GetCredential(ctx, x.cluster.CredentialID)
		if e != nil {
			return x, e
		}
		x.version = c.Version
		v, e := q.GetSecretVersion(ctx, sqlcdb.GetSecretVersionParams{CredentialID: c.ID, Version: c.Version})
		if e != nil {
			return x, e
		}
		x.payload, e = s.vault.Open(c.ID, c.Version, v.KeyID, v.EncryptedPayload)
		return x, e
	})
	if err != nil {
		return out, err
	}
	if x.payload["apiServer"] != x.cluster.ApiServer {
		return out, httpx.Fail(409, "revision_conflict", "集群凭据绑定已变化")
	}
	c, err := kubernetes.New(x.payload)
	if err != nil {
		return out, err
	}
	defer c.Close()
	var version struct {
		GitVersion string `json:"gitVersion"`
	}
	remoteErr := c.Get(ctx, "/version", nil, &version)
	out = ConnectionTest{Status: "unavailable", Message: "Kubernetes 连接或认证失败", CheckedAt: time.Now().UTC()}
	if remoteErr == nil && strings.HasPrefix(version.GitVersion, "v") && len(version.GitVersion) <= 128 && !strings.ContainsAny(version.GitVersion, "\x00\r\n") {
		out.Status = "connected"
		out.ServerVersion = &version.GitVersion
		out.Message = "Kubernetes 连接成功"
	}
	// Persist only observations for the credential version that actually performed the request.
	_, err = database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		if e := auth.LockActor(ctx, q, a); e != nil {
			return false, e
		}
		current, e := q.LockCluster(ctx, id)
		if e != nil {
			return false, e
		}
		cred, e := q.GetCredential(ctx, current.CredentialID)
		if e != nil {
			return false, e
		}
		if current.CredentialID != x.cluster.CredentialID || cred.Version != x.version {
			return false, httpx.Fail(409, "revision_conflict", "连接测试期间集群凭据已变化")
		}
		if _, e = q.SetClusterObservation(ctx, sqlcdb.SetClusterObservationParams{ID: id, ConnectionStatus: out.Status, ServerVersion: out.ServerVersion, LastCheckedAt: &out.CheckedAt}); e != nil {
			return false, e
		}
		e = q.RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &a.ID, ClusterID: &id, Action: "cluster.connection_test", RequestID: request, Target: []byte(`{"clusterId":"` + id + `"}`), Result: map[bool]string{true: "succeeded", false: "failed"}[out.Status == "connected"]})
		return true, e
	})
	return out, err
}
