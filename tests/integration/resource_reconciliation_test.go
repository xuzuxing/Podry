package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xuzuxing/podry/internal/audit"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
	"github.com/xuzuxing/podry/internal/resource"
	"github.com/xuzuxing/podry/internal/server"
)

func resourceReconciliationSetup(t *testing.T) (*resourceWriteFixture, resource.Operation) {
	t.Helper()
	f := resourceWriteSetup(t)
	p := f.preview(t, writeDoc("manual-check"))
	op := f.apply(t, p, "manual-check-apply", false)
	f.api.drop = true
	f.step(t)
	f.service.WritesEnabled = false
	op = f.operation(t, op.ID)
	if op.Status != "unknown" || f.api.writes != 1 {
		t.Fatal("missing uncertain durable intent", op)
	}
	return f, op
}

func resourceReconciliationInput(revision int64) resource.ReconcileOperationInput {
	return resource.ReconcileOperationInput{ExpectedRevision: revision, Reason: "人工核对 private-resource-reason"}
}

func resourceReconciliationRequest(f *resourceWriteFixture, id, token, key string, in any) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(in)
	r := httptest.NewRequest("POST", "/api/resource-operations/"+id+"/reconcile", bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	r.Header.Set("Idempotency-Key", key)
	w := httptest.NewRecorder()
	f.f.handler.ServeHTTP(w, r)
	return w
}

func resourceReconcile(t *testing.T, f *resourceWriteFixture, op resource.Operation, key string, want int) json.RawMessage {
	t.Helper()
	w := resourceReconciliationRequest(f, op.ID, f.developer, key, resourceReconciliationInput(op.Revision))
	if w.Code != want || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("resource reconcile: status=%d want=%d body=%s", w.Code, want, w.Body.String())
	}
	return w.Body.Bytes()
}

func resourceReconciliationCounts(t *testing.T, f *resourceWriteFixture, want int) {
	t.Helper()
	for _, sql := range []string{"SELECT count(*) FROM audit_events WHERE action='resource.reconcile'", "SELECT count(*) FROM idempotency_records WHERE operation_id='reconcileResourceOperation'"} {
		var n int
		if err := f.f.pool.QueryRow(context.Background(), sql).Scan(&n); err != nil || n != want {
			t.Fatal("non-atomic resource reconciliation", n, want, err)
		}
	}
}

func resourceReconciliationService(f *resourceWriteFixture, vault *credential.Vault) {
	f.service = resource.New(f.f.pool, vault, testJWT)
	f.f.handler = server.New(fstest.MapFS{"index.html": {Data: []byte("test")}}, server.Dependencies{Auth: f.f.auth, Project: project.New(f.f.pool), Platform: platform.New(f.f.pool, vault), Resource: f.service, Audit: audit.New(f.f.pool)})
}

func TestResourceReconciliationSuccessAndOfflineReplay(t *testing.T) {
	f, op := resourceReconciliationSetup(t)
	raw := resourceReconcile(t, f, op, "resource-check-success", 200)
	out := decode[resource.OperationReconciliation](t, raw)
	if out.OperationID != op.ID || out.Revision != op.Revision+1 || out.Status != "succeeded" || out.CheckedAt.IsZero() || len(out.Items) != 1 || out.Items[0].Ref.UID == "" || out.Items[0].Error != nil || f.api.writes != 1 {
		t.Fatal(out)
	}
	current := f.operation(t, op.ID)
	row, err := sqlcdb.New(f.f.pool).GetResourceOperation(context.Background(), op.ID)
	if err != nil || row.FinishedAt == nil || row.LeaseOwner != nil || current.Revision != out.Revision || current.Status != "succeeded" || !reflect.DeepEqual(current.Items, out.Items) {
		t.Fatal("result and history not committed", current, err)
	}
	resourceReconciliationCounts(t, f, 1)
	var auditText string
	if err := f.f.pool.QueryRow(context.Background(), "SELECT target::text FROM audit_events WHERE action='resource.reconcile'").Scan(&auditText); err != nil {
		t.Fatal(err)
	}
	for _, hidden := range []string{"private-document-content", "private-resource-reason", "podry.io/operation", "Manifest", "Expected"} {
		if bytes.Contains(raw, []byte(hidden)) || strings.Contains(auditText, hidden) {
			t.Fatal("observation leaked private data", hidden)
		}
	}
	reads := f.api.reads
	resourceReconciliationService(f, nil)
	if replay := resourceReconcile(t, f, op, "resource-check-success", 200); !bytes.Equal(raw, replay) || f.api.reads != reads {
		t.Fatal("offline replay required keys/network or changed bytes")
	}
	in := resourceReconciliationInput(op.Revision)
	in.Reason = "another reason"
	if r := resourceReconciliationRequest(f, op.ID, f.developer, "resource-check-success", in); r.Code != 409 {
		t.Fatal("idempotency hash ignored reason", r.Code)
	}
	f.f.call("DELETE", f.path("/resource-grants/"+f.grant.ID), f.admin, nil, 204)
	resourceReconcile(t, f, op, "resource-check-success", 404)
	resourceReconciliationCounts(t, f, 1)
}

func TestResourceReconciliationApplyKindsAndUpdate(t *testing.T) {
	for _, kind := range []string{"update", "Secret", "Widget"} {
		t.Run(kind, func(t *testing.T) {
			f := resourceWriteSetup(t)
			doc := writeDoc("typed-check")
			switch kind {
			case "update":
				r := f.seedAction(t, "ConfigMap", "typed-check")
				doc.ExpectedUID, doc.ExpectedResourceVersion = r.UID, r.ResourceVersion
			case "Secret":
				doc.Manifest = strings.Replace(doc.Manifest, "kind: ConfigMap", "kind: Secret", 1)
			case "Widget":
				doc.Manifest = strings.ReplaceAll(strings.Replace(doc.Manifest, "apiVersion: v1", "apiVersion: example.test/v1", 1), "kind: ConfigMap", "kind: Widget")
			}
			op := f.apply(t, f.preview(t, doc), "typed-check-apply", false)
			f.api.drop = true
			f.step(t)
			f.service.WritesEnabled = false
			op = f.operation(t, op.ID)
			out := decode[resource.OperationReconciliation](t, resourceReconcile(t, f, op, "typed-check-observe", 200))
			if out.Status != "succeeded" || f.api.writes != 1 || bytes.Contains(mustJSON(t, out), []byte("private-document-content")) {
				t.Fatal(out)
			}
		})
	}
}

func TestResourceReconciliationActionsAndDeleteFinalizer(t *testing.T) {
	for _, action := range []string{"delete", "restart", "scale", "finalizer"} {
		t.Run(action, func(t *testing.T) {
			f := actionSetup(t)
			r := f.seedAction(t, "Deployment", "action-check")
			in := resource.ActionInput{Action: action, Ref: &r}
			if action == "scale" {
				n := int32(2)
				in.Replicas = &n
			}
			if action == "finalizer" {
				in.Action, f.api.holdDelete = "delete", true
			}
			op := f.action(t, "manual-action-intent", in)
			f.api.drop = true
			f.step(t)
			f.service.WritesEnabled = false
			op = f.operation(t, op.ID)
			out := decode[resource.OperationReconciliation](t, resourceReconcile(t, f, op, "manual-action-check", 200))
			if action == "finalizer" {
				if out.Status != "unknown" {
					t.Fatal("finalizer resolved without evidence", out)
				}
				busy, err := sqlcdb.New(f.f.pool).ResourceActionBusy(context.Background(), sqlcdb.ResourceActionBusyParams{ClusterID: f.cluster.ID, Namespace: "demo"})
				if err != nil || !busy {
					t.Fatal("unknown stopped blocking conflicting releases", busy, err)
				}
				f.api.mu.Lock()
				f.api.objects[actionPath(r)]["metadata"].(map[string]any)["uid"] = uuid.NewString()
				f.api.mu.Unlock()
				op = f.operation(t, op.ID)
				out = decode[resource.OperationReconciliation](t, resourceReconcile(t, f, op, "manual-deleted-old-uid", 200))
			}
			if out.Status != "succeeded" || f.api.writes != 1 {
				t.Fatal("read repeated action or failed to confirm", out, f.api.writes)
			}
			busy, err := sqlcdb.New(f.f.pool).ResourceActionBusy(context.Background(), sqlcdb.ResourceActionBusyParams{ClusterID: f.cluster.ID, Namespace: "demo"})
			if err != nil || busy {
				t.Fatal("confirmed terminal action still occupies namespace", busy, err)
			}
		})
	}
}

func TestResourceReconciliationUncertainEvidence(t *testing.T) {
	for _, mutation := range []string{"missing", "marker", "content", "uid", "kind", "discovery", "read-error"} {
		t.Run(mutation, func(t *testing.T) {
			f := actionSetup(t)
			r := f.seedAction(t, "Deployment", "uncertain-check")
			op := f.action(t, "uncertain-action-intent", resource.ActionInput{Action: "restart", Ref: &r})
			f.api.drop = true
			f.step(t)
			f.service.WritesEnabled = false
			op = f.operation(t, op.ID)
			f.api.mu.Lock()
			current := f.api.objects[actionPath(r)]
			switch mutation {
			case "missing":
				delete(f.api.objects, actionPath(r))
			case "marker":
				delete(bm(current["metadata"]), "annotations")
			case "content":
				bm(current["spec"])["replicas"] = float64(9)
			case "uid":
				bm(current["metadata"])["uid"] = uuid.NewString()
			case "kind":
				current["kind"] = "StatefulSet"
			case "discovery":
				f.api.hook = func(req *http.Request) {
					if req.URL.Path == "/apis/apps/v1" {
						req.URL.Path = "/missing-discovery"
					}
				}
			case "read-error":
				f.api.hook = func(req *http.Request) {
					if req.URL.Path == actionPath(r) {
						req.URL.Path = "/private-invalid-response"
					}
				}
			}
			f.api.mu.Unlock()
			out := decode[resource.OperationReconciliation](t, resourceReconcile(t, f, op, "uncertain-action-check", 200))
			if out.Status != "unknown" || out.Items[0].Error == nil || out.Items[0].Error.Code != "resource_outcome_unknown" || f.api.writes != 1 {
				t.Fatal("incomplete evidence released target", out)
			}
			var finished bool
			if err := f.f.pool.QueryRow(context.Background(), "SELECT finished_at IS NOT NULL FROM resource_operations WHERE id=$1", op.ID).Scan(&finished); err != nil || finished {
				t.Fatal("unknown became terminal", err)
			}
		})
	}
}

func TestResourceReconciliationStopsPendingAndFencesOldWorker(t *testing.T) {
	f := resourceWriteSetup(t)
	op := f.apply(t, f.preview(t, writeDoc("first-unknown"), writeDoc("never-submit")), "manual-partial-intent", false)
	f.api.drop = true
	f.step(t)
	op = f.operation(t, op.ID)
	op.Items[0].Status, op.Items[1].Status, op.Items[1].Error = "running", "pending", nil
	if _, err := f.f.pool.Exec(context.Background(), "UPDATE resource_operations SET status='running',result_redacted=$2,lease_owner='expired-worker',lease_expires_at=clock_timestamp()-interval '1 second',revision=revision+1 WHERE id=$1", op.ID, mustJSON(t, op.Items)); err != nil {
		t.Fatal(err)
	}
	f.service.WritesEnabled = false
	op = f.operation(t, op.ID)
	out := decode[resource.OperationReconciliation](t, resourceReconcile(t, f, op, "manual-partial-check", 200))
	if out.Status != "partial" || out.Items[0].Status != "succeeded" || out.Items[1].Status != "skipped" || f.api.writes != 1 {
		t.Fatal("pending item resumed", out)
	}
	owner := "expired-worker"
	_, err := sqlcdb.New(f.f.pool).AdvanceResourceOperation(context.Background(), sqlcdb.AdvanceResourceOperationParams{ID: op.ID, Revision: op.Revision, Owner: &owner, Status: "unknown", ResultRedacted: mustJSON(t, op.Items), ReleaseLease: true})
	if err != pgx.ErrNoRows {
		t.Fatal("late worker overwrote reconciliation", err)
	}
}

func TestResourceReconciliationValidationLeaseAndOwnership(t *testing.T) {
	f, op := resourceReconciliationSetup(t)
	reads := f.api.reads
	for _, in := range []any{resource.ReconcileOperationInput{}, resource.ReconcileOperationInput{ExpectedRevision: op.Revision, Reason: " "}, resource.ReconcileOperationInput{ExpectedRevision: op.Revision, Reason: strings.Repeat("字", 1001)}, map[string]any{"expectedRevision": op.Revision, "reason": "ok", "force": true}} {
		if w := resourceReconciliationRequest(f, op.ID, f.developer, "invalid-manual-check", in); w.Code != 422 {
			t.Fatal("invalid request accepted", w.Code, w.Body.String())
		}
	}
	resourceReconcile(t, f, op, "", 422)
	stale := op
	stale.Revision--
	resourceReconcile(t, f, stale, "stale-manual-check", 409)
	for _, token := range []string{f.admin, ""} {
		w := resourceReconciliationRequest(f, op.ID, token, "non-owner-check", resourceReconciliationInput(op.Revision))
		if token == "" && w.Code != 401 || token != "" && w.Code != 404 {
			t.Fatal("owner boundary bypass", w.Code)
		}
	}
	if _, err := f.f.pool.Exec(context.Background(), "UPDATE resource_operations SET lease_owner='live-worker',lease_expires_at=clock_timestamp()+interval '1 minute',revision=revision+1 WHERE id=$1", op.ID); err != nil {
		t.Fatal(err)
	}
	op = f.operation(t, op.ID)
	assertCode(t, resourceReconcile(t, f, op, "live-worker-check", 409), "resource_reconciliation_busy")
	if _, err := f.f.pool.Exec(context.Background(), "UPDATE resource_operations SET lease_expires_at=clock_timestamp()-interval '1 second',revision=revision+1 WHERE id=$1", op.ID); err != nil {
		t.Fatal(err)
	}
	op = f.operation(t, op.ID)
	tx, err := f.f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "SELECT id FROM resource_operations WHERE id=$1 FOR UPDATE", op.ID); err != nil {
		t.Fatal(err)
	}
	assertCode(t, resourceReconcile(t, f, op, "locked-resource-check", 409), "resource_reconciliation_busy")
	if err = tx.Rollback(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.api.reads != reads {
		t.Fatal("rejected request reached cluster")
	}
	resourceReconciliationCounts(t, f, 0)
}

func TestResourceReconciliationRejectsUnsubmittedAndTerminal(t *testing.T) {
	f := resourceWriteSetup(t)
	op := f.apply(t, f.preview(t, writeDoc("queued-check"), writeDoc("pending-check")), "queued-check-intent", false)
	assertCode(t, resourceReconcile(t, f, op, "queued-manual-check", 409), "resource_operation_not_reconcilable")
	f.step(t)
	op = f.operation(t, op.ID)
	assertCode(t, resourceReconcile(t, f, op, "no-intent-manual-check", 409), "resource_operation_not_reconcilable")
	f.step(t)
	op = f.operation(t, op.ID)
	assertCode(t, resourceReconcile(t, f, op, "terminal-manual-check", 409), "resource_operation_not_reconcilable")
	resourceReconciliationCounts(t, f, 0)
}

func TestResourceReconciliationRechecksDuringRead(t *testing.T) {
	for _, mutation := range []string{"grant", "credential", "account", "revision", "worker"} {
		t.Run(mutation, func(t *testing.T) {
			f, op := resourceReconciliationSetup(t)
			var once sync.Once
			f.api.hook = func(req *http.Request) {
				if req.URL.Path != "/api/v1/namespaces/demo/configmaps/manual-check" {
					return
				}
				once.Do(func() {
					switch mutation {
					case "grant":
						f.f.call("DELETE", f.path("/resource-grants/"+f.grant.ID), f.admin, nil, 204)
					case "credential":
						f.f.call("PUT", "/api/credentials/"+f.credential.ID, f.admin, map[string]any{"expectedVersion": 1, "payload": f.payload()}, 200)
					case "account":
						if _, err := f.f.pool.Exec(context.Background(), "UPDATE users SET token_version=token_version+1 WHERE id=$1", f.devID); err != nil {
							t.Error(err)
						}
					case "revision":
						if _, err := f.f.pool.Exec(context.Background(), "UPDATE resource_operations SET revision=revision+1 WHERE id=$1", op.ID); err != nil {
							t.Error(err)
						}
					case "worker":
						if _, err := f.f.pool.Exec(context.Background(), "UPDATE resource_operations SET lease_owner='other-worker',lease_expires_at=clock_timestamp()+interval '1 minute',revision=revision+1 WHERE id=$1", op.ID); err != nil {
							t.Error(err)
						}
					}
				})
			}
			want := 409
			if mutation == "grant" {
				want = 404
			}
			if mutation == "account" {
				want = 401
			}
			resourceReconcile(t, f, op, "changed-during-check", want)
			resourceReconciliationCounts(t, f, 0)
			row, err := sqlcdb.New(f.f.pool).GetResourceOperation(context.Background(), op.ID)
			if err != nil || row.Status != "unknown" || row.FinishedAt != nil || f.api.writes != 1 {
				t.Fatal("late result committed", row.Status, err)
			}
		})
	}
}

func TestResourceReconciliationConcurrentRequests(t *testing.T) {
	for _, sameKey := range []bool{true, false} {
		t.Run(map[bool]string{true: "same-key", false: "different-key"}[sameKey], func(t *testing.T) {
			f, op := resourceReconciliationSetup(t)
			entered, resume := make(chan struct{}, 2), make(chan struct{})
			var once sync.Once
			t.Cleanup(func() { once.Do(func() { close(resume) }) })
			f.api.hook = func(req *http.Request) {
				if req.URL.Path == "/api/v1/namespaces/demo/configmaps/manual-check" {
					entered <- struct{}{}
					<-resume
				}
			}
			responses := make(chan *httptest.ResponseRecorder, 2)
			for i := range 2 {
				key := "first-concurrent-check"
				if i == 1 && !sameKey {
					key = "second-concurrent-check"
				}
				go func() {
					responses <- resourceReconciliationRequest(f, op.ID, f.developer, key, resourceReconciliationInput(op.Revision))
				}()
			}
			for range 2 {
				select {
				case <-entered:
				case <-time.After(5 * time.Second):
					t.Fatal("observations did not run concurrently")
				}
			}
			once.Do(func() { close(resume) })
			successes, conflicts := 0, 0
			var body string
			for range 2 {
				select {
				case w := <-responses:
					if w.Code == 200 {
						successes++
					} else if w.Code == 409 {
						conflicts++
					} else {
						t.Fatal(w.Code, w.Body.String())
					}
					if sameKey && body != "" && body != w.Body.String() {
						t.Fatal("same key returned different bytes")
					}
					body = w.Body.String()
				case <-time.After(5 * time.Second):
					t.Fatal("concurrent completion timed out")
				}
			}
			if sameKey && successes != 2 || !sameKey && (successes != 1 || conflicts != 1) {
				t.Fatal(successes, conflicts)
			}
			resourceReconciliationCounts(t, f, 1)
			if f.api.writes != 1 {
				t.Fatal("manual check repeated submission")
			}
		})
	}
}

func TestResourceReconciliationMembershipRevocation(t *testing.T) {
	for _, phase := range []string{"during-read", "lock-wait"} {
		t.Run(phase, func(t *testing.T) {
			f, op := resourceReconciliationSetup(t)
			team := decode[struct {
				ID string `json:"id"`
			}](t, f.f.call("POST", "/api/teams", f.admin, map[string]any{"name": "reconcile-team"}, 201))
			proj := decode[struct {
				ID string `json:"id"`
			}](t, f.f.call("POST", "/api/projects", f.admin, map[string]any{"teamId": team.ID, "name": "reconcile-project"}, 201))
			for _, path := range []string{"/api/teams/" + team.ID + "/members", "/api/projects/" + proj.ID + "/members"} {
				f.f.call("POST", path, f.admin, map[string]any{"userId": f.devID, "role": "developer"}, 201)
			}
			f.f.call("POST", f.path("/resource-grants"), f.admin, map[string]any{"principalType": "project", "principalId": proj.ID, "namespace": "demo", "resources": []string{"core/configmaps"}, "actions": []string{"resource.view", "resource.write"}}, 201)
			f.f.call("DELETE", f.path("/resource-grants/"+f.grant.ID), f.admin, nil, 204)
			if phase == "during-read" {
				var once sync.Once
				f.api.hook = func(req *http.Request) {
					if req.URL.Path == "/api/v1/namespaces/demo/configmaps/manual-check" {
						once.Do(func() { f.f.call("DELETE", "/api/projects/"+proj.ID+"/members/"+f.devID, f.admin, nil, 204) })
					}
				}
				resourceReconcile(t, f, op, "member-during-read", 404)
			} else {
				ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
				defer cancel()
				tx, err := f.f.pool.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer tx.Rollback(context.Background())
				if _, err = tx.Exec(ctx, "SELECT id FROM teams WHERE id=$1 FOR UPDATE", team.ID); err != nil {
					t.Fatal(err)
				}
				done := make(chan *httptest.ResponseRecorder, 1)
				go func() {
					done <- resourceReconciliationRequest(f, op.ID, f.developer, "member-lock-wait", resourceReconciliationInput(op.Revision))
				}()
				for {
					var waiting bool
					if err = f.f.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM teams%')").Scan(&waiting); err != nil {
						t.Fatal(err)
					}
					if waiting {
						break
					}
					select {
					case <-ctx.Done():
						t.Fatal("reconciliation never waited for membership lock")
					case <-time.After(10 * time.Millisecond):
					}
				}
				if _, err = tx.Exec(ctx, "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", proj.ID, f.devID); err != nil {
					t.Fatal(err)
				}
				if err = tx.Commit(ctx); err != nil {
					t.Fatal(err)
				}
				select {
				case w := <-done:
					if w.Code != 404 {
						t.Fatal(w.Code, w.Body.String())
					}
				case <-ctx.Done():
					t.Fatal("reconciliation did not finish after revocation")
				}
			}
			resourceReconciliationCounts(t, f, 0)
			row, err := sqlcdb.New(f.f.pool).GetResourceOperation(context.Background(), op.ID)
			if err != nil || row.Status != "unknown" || row.Revision != op.Revision || f.api.writes != 1 {
				t.Fatal("revoked membership committed result", row.Status, err)
			}
		})
	}
}

func TestResourceReconciliationRotatedCredentialsAndMissingKey(t *testing.T) {
	f, op := resourceReconciliationSetup(t)
	resourceReconciliationService(f, nil)
	assertCode(t, resourceReconcile(t, f, op, "missing-plan-key", 503), "resource_snapshot_unavailable")
	resourceReconciliationCounts(t, f, 0)
	vault, _ := credential.New(testCredentialKey)
	resourceReconciliationService(f, vault)
	f.f.call("PUT", "/api/credentials/"+f.credential.ID, f.admin, map[string]any{"expectedVersion": 1, "payload": f.payload()}, 200)
	// A new login after token invalidation may explicitly recover its own intent.
	if _, err := f.f.pool.Exec(context.Background(), "UPDATE users SET token_version=token_version+1 WHERE id=$1", f.devID); err != nil {
		t.Fatal(err)
	}
	f.developer = f.f.login("dev@resource-write.test")
	out := decode[resource.OperationReconciliation](t, resourceReconcile(t, f, op, "rotated-current-check", 200))
	if out.Status != "succeeded" || f.api.writes != 1 {
		t.Fatal(out)
	}
}

func TestResourceReconciliationTransactionRollback(t *testing.T) {
	f, op := resourceReconciliationSetup(t)
	ctx := context.Background()
	for _, sql := range []string{
		"CREATE FUNCTION reject_resource_reconcile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='resource.reconcile' THEN RAISE EXCEPTION 'private fixture audit failure'; END IF; RETURN NEW; END $$",
		"CREATE TRIGGER reject_resource_reconcile BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_resource_reconcile()",
	} {
		if _, err := f.f.pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	if raw := resourceReconcile(t, f, op, "atomic-resource-check", 500); bytes.Contains(raw, []byte("private fixture")) {
		t.Fatal("driver error leaked")
	}
	row, err := sqlcdb.New(f.f.pool).GetResourceOperation(ctx, op.ID)
	if err != nil || row.Status != op.Status || row.Revision != op.Revision || row.FinishedAt != nil {
		t.Fatal("business mutation did not roll back", row, err)
	}
	resourceReconciliationCounts(t, f, 0)
	if _, err := f.f.pool.Exec(ctx, "DROP TRIGGER reject_resource_reconcile ON audit_events"); err != nil {
		t.Fatal(err)
	}
	resourceReconcile(t, f, op, "atomic-resource-check", 200)
	resourceReconciliationCounts(t, f, 1)
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
