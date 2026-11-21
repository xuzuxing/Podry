package resource

import (
	"bytes"
	"encoding/json"
	"errors"
	"time"

	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
)

type ManifestDocument struct {
	Manifest                string `json:"manifest"`
	ExpectedUID             string `json:"expectedUid,omitempty"`
	ExpectedResourceVersion string `json:"expectedResourceVersion,omitempty"`
}
type DryRunInput struct {
	Documents []ManifestDocument `json:"documents"`
}
type Diff struct {
	Before string `json:"before"`
	After  string `json:"after"`
}
type OperationError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type PreviewItem struct {
	Index  int             `json:"index"`
	Ref    *Ref            `json:"ref"`
	Action string          `json:"action"`
	Diff   Diff            `json:"diff"`
	Valid  bool            `json:"valid"`
	Error  *OperationError `json:"error"`
}
type Preview struct {
	PreviewID string        `json:"previewId"`
	ExpiresAt time.Time     `json:"expiresAt"`
	Items     []PreviewItem `json:"items"`
}
type ApplyInput struct {
	PreviewID   string `json:"previewId"`
	StopOnError bool   `json:"stopOnError"`
}
type OperationItem struct {
	Index  int             `json:"index"`
	Status string          `json:"status"`
	Ref    *Ref            `json:"ref"`
	Error  *OperationError `json:"error"`
}
type Operation struct {
	ID        string          `json:"id"`
	Revision  int64           `json:"revision"`
	Status    string          `json:"status"`
	Items     []OperationItem `json:"items"`
	CreatedAt time.Time       `json:"createdAt"`
}
type writeStamp struct {
	CredentialID           string
	CredentialVersion      int32
	APIServer, Fingerprint string
	TokenVersion           int64
}
type writeDocument struct {
	Type     ResourceType
	Ref      Ref
	Action   string
	Manifest map[string]any
	Expected map[string]any
}
type writePlan struct {
	Stamp     writeStamp
	Documents []writeDocument
}

func stamp(x snapshot, token int64) writeStamp {
	return writeStamp{x.credential.ID, x.credential.Version, x.cluster.ApiServer, x.fingerprint, token}
}
func safeError(err error) *OperationError {
	// All messages originate locally. Never retain a YAML parser, driver or remote message.
	var e *httpx.Error
	if errors.As(err, &e) {
		return &OperationError{e.Code, e.Message}
	}
	return &OperationError{"resource_operation_unavailable", "资源操作暂不可用"}
}
func operationDTO(row sqlcdb.ResourceOperation) (Operation, error) {
	out := Operation{ID: row.ID, Revision: row.Revision, Status: row.Status, CreatedAt: row.CreatedAt, Items: []OperationItem{}}
	err := json.Unmarshal(row.ResultRedacted, &out.Items)
	return out, err
}
func (s *Service) sealPlan(domain, id string, plan writePlan) ([]byte, string, error) {
	raw, err := json.Marshal(plan)
	if err != nil {
		return nil, "", err
	}
	if len(raw) > 4<<20 {
		return nil, "", httpx.Invalid("预览快照超过保存预算")
	}
	return s.vault.Seal(domain+":"+id, 1, map[string]any{"plan": string(raw)})
}
func (s *Service) openPlan(domain, id, key string, encrypted []byte) (writePlan, error) {
	var plan writePlan
	p, err := s.vault.Open(domain+":"+id, 1, key, encrypted)
	if err != nil {
		return plan, err
	}
	raw, ok := p["plan"].(string)
	if !ok {
		return plan, httpx.Fail(503, "resource_snapshot_invalid", "资源快照无效")
	}
	decoder := json.NewDecoder(bytes.NewBufferString(raw))
	decoder.UseNumber()
	err = decoder.Decode(&plan)
	if err == nil && (len(plan.Documents) == 0 || len(plan.Documents) > 50 || plan.Stamp.CredentialID == "") {
		err = httpx.Fail(503, "resource_snapshot_invalid", "资源快照无效")
	}
	return plan, err
}
