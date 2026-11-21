package build

import (
	"context"
	"encoding/json"

	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
)

// DecodeExecution validates the durable identity before using frozen inputs.
func DecodeExecution(b sqlcdb.Build, row sqlcdb.BuildAttempt) (ExecutionSpec, error) {
	var spec ExecutionSpec
	if json.Unmarshal(row.ExecutionSpec, &spec) != nil || spec.Version != 1 || Hash(spec) != row.ExecutionHash || spec.BuildID != b.ID || spec.AttemptID != row.ID || spec.AppID != b.AppID || spec.CommitSHA != b.CommitSha || spec.ClusterID != row.BuildClusterID || spec.Namespace != row.Namespace || spec.JobName != row.JobName {
		return spec, httpx.Fail(409, "execution_integrity_failed", "构建执行快照校验失败")
	}
	return spec, nil
}

func condition(j object, kind string) bool {
	conditions, _ := obj(j["status"])["conditions"].([]any)
	for _, v := range conditions {
		if obj(v)["type"] == kind && obj(v)["status"] == "True" {
			return true
		}
	}
	return false
}
func podsStopped(pods []object) bool {
	for _, p := range pods {
		phase := obj(p["status"])["phase"]
		if phase != "Succeeded" && phase != "Failed" {
			return false
		}
	}
	return true
}
func jobStopped(j object) bool {
	active, _ := obj(j["status"])["active"].(float64)
	return active == 0 && (condition(j, "Complete") || condition(j, "Failed") || (obj(j["spec"])["suspend"] == true && condition(j, "Suspended")))
}

func (s *Service) cancelStep(ctx context.Context, spec ExecutionSpec, row sqlcdb.BuildAttempt) stepResult {
	r := stepResult{stage: row.Stage, status: "canceling", availability: row.LogAvailability}
	unknown := func(err string) stepResult { r.status = "unknown"; r.code = err; return r }
	if row.Stage == "planned" && row.JobUid == nil {
		r.stage = "finished"
		r.status = "canceled"
		return r
	}
	c, err := s.client(ctx, spec)
	if err != nil {
		return unknown(code(err))
	}
	defer c.Close()
	path := "/apis/batch/v1/namespaces/" + spec.Namespace + "/jobs/" + spec.JobName
	var j object
	err = c.Get(ctx, path, nil, &j)
	missing := code(err) == "resource_not_found"
	if err != nil && !missing {
		return unknown(code(err))
	}
	uid := ""
	if row.JobUid != nil {
		uid = *row.JobUid
	}
	if missing && uid == "" {
		return unknown("job_outcome_unknown")
	}
	if !missing {
		observed := text(obj(j["metadata"])["uid"])
		if !owned(j, spec) || observed == "" || (uid != "" && uid != observed) {
			return unknown("job_identity_conflict")
		}
		uid = observed
		r.uid = uid
		if condition(j, "Complete") || condition(j, "Failed") {
			// Settle the real terminal outcome, including digest verification.
			observing := row
			observing.Stage = "observing"
			return s.step(ctx, spec, observing, false)
		}
		if obj(j["spec"])["suspend"] != true {
			patch := object{"metadata": object{"uid": uid, "resourceVersion": obj(j["metadata"])["resourceVersion"]}, "spec": object{"suspend": true}}
			if err = c.Write(ctx, "PATCH", path, patch, &j); err != nil {
				return unknown(code(err))
			}
			return r // An accepted PATCH is not controller/Pod exit evidence.
		}
		if !jobStopped(j) {
			return r
		}
	}
	pods, err := readPods(ctx, c, spec, uid)
	if err != nil {
		return unknown(code(err))
	}
	if !podsStopped(pods) {
		return r
	}
	r.stage = "finished"
	r.status = "canceled"
	return r
}

// VerifyRetryExit is read-only and must run outside the admission transaction.
func (s *Service) VerifyRetryExit(ctx context.Context, spec ExecutionSpec, row sqlcdb.BuildAttempt) error {
	refuse := func() error { return httpx.Fail(409, "build_exit_unconfirmed", "旧构建任务尚未确认退出") }
	if row.Stage != "finished" || (row.Status != "failed" && row.Status != "canceled") {
		return refuse()
	}
	if row.JobUid == nil {
		if row.Status == "canceled" && row.CancelRequestedAt != nil {
			return nil
		}
		if row.ErrorCode != nil && *row.ErrorCode == "execution_authorization_revoked" {
			return nil
		}
		return refuse()
	}
	c, err := s.client(ctx, spec)
	if err != nil {
		return err
	}
	defer c.Close()
	var j object
	err = c.Get(ctx, "/apis/batch/v1/namespaces/"+spec.Namespace+"/jobs/"+spec.JobName, nil, &j)
	if err != nil && code(err) != "resource_not_found" {
		return err
	}
	if err == nil && (!owned(j, spec) || text(obj(j["metadata"])["uid"]) != *row.JobUid || !jobStopped(j)) {
		return refuse()
	}
	pods, err := readPods(ctx, c, spec, *row.JobUid)
	if err != nil {
		return err
	}
	if !podsStopped(pods) {
		return refuse()
	}
	return nil
}
