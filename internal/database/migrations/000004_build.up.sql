BEGIN;
ALTER TABLE pipelines ADD CONSTRAINT pipelines_identity_app UNIQUE(id,app_id);
CREATE TABLE builds (
 id uuid PRIMARY KEY, app_id uuid NOT NULL REFERENCES applications(id), pipeline_id uuid NOT NULL,
 config_version integer NOT NULL, commit_sha text NOT NULL CHECK(commit_sha ~ '^[0-9a-f]{40}$'),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','canceling','succeeded','failed','canceled','unknown')),
 attempt_no integer NOT NULL DEFAULT 1 CHECK(attempt_no>0), artifact_id uuid,
 requested_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(pipeline_id,app_id) REFERENCES pipelines(id,app_id),
 FOREIGN KEY(app_id,config_version) REFERENCES app_config_versions(app_id,version), UNIQUE(id,app_id)
);
CREATE TABLE build_attempts (
 id uuid PRIMARY KEY, build_id uuid NOT NULL REFERENCES builds(id), attempt_no integer NOT NULL CHECK(attempt_no>0),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','canceling','succeeded','failed','canceled','unknown')),
 build_cluster_id uuid NOT NULL REFERENCES clusters(id), namespace text NOT NULL, job_name text NOT NULL, job_uid text,
 execution_spec jsonb NOT NULL CHECK(jsonb_typeof(execution_spec)='object'), execution_hash text NOT NULL CHECK(execution_hash ~ '^[0-9a-f]{64}$'),
 stage text NOT NULL DEFAULT 'planned' CHECK(stage IN ('planned','creating','preparing','starting','observing','verifying','finished')),
 lease_owner text, lease_expires_at timestamptz, revision bigint NOT NULL DEFAULT 1,
 next_poll_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz, error_code text,
 log_availability text NOT NULL DEFAULT 'unavailable' CHECK(log_availability IN ('runtime','archived','unavailable','expired')),
 UNIQUE(build_id,attempt_no), UNIQUE(build_cluster_id,namespace,job_name), UNIQUE(id,build_id)
);
CREATE FUNCTION podry_build_inputs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.build_id,NEW.attempt_no,NEW.build_cluster_id,NEW.namespace,NEW.job_name,NEW.execution_spec,NEW.execution_hash)
 IS DISTINCT FROM ROW(OLD.build_id,OLD.attempt_no,OLD.build_cluster_id,OLD.namespace,OLD.job_name,OLD.execution_spec,OLD.execution_hash)
 OR (OLD.job_uid IS NOT NULL AND NEW.job_uid IS DISTINCT FROM OLD.job_uid) THEN
  RAISE EXCEPTION 'immutable build execution identity' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER build_attempt_inputs_immutable BEFORE UPDATE ON build_attempts FOR EACH ROW EXECUTE FUNCTION podry_build_inputs_immutable();
CREATE TABLE artifacts (
 id uuid PRIMARY KEY, app_id uuid NOT NULL REFERENCES applications(id), build_id uuid NOT NULL,
 attempt_id uuid NOT NULL UNIQUE, image_repository text NOT NULL, digest text NOT NULL CHECK(digest ~ '^sha256:[0-9a-f]{64}$'),
 source text NOT NULL DEFAULT 'build' CHECK(source='build'), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(build_id,app_id) REFERENCES builds(id,app_id), FOREIGN KEY(attempt_id,build_id) REFERENCES build_attempts(id,build_id), UNIQUE(id,app_id)
);
ALTER TABLE builds ADD CONSTRAINT builds_artifact_app FOREIGN KEY(artifact_id,app_id) REFERENCES artifacts(id,app_id);
CREATE TRIGGER artifact_immutable BEFORE UPDATE OR DELETE ON artifacts FOR EACH ROW EXECUTE FUNCTION podry_immutable_row();
CREATE TABLE log_archives (
 id uuid PRIMARY KEY, build_attempt_id uuid NOT NULL UNIQUE REFERENCES build_attempts(id), storage_key text NOT NULL UNIQUE,
 byte_size bigint NOT NULL CHECK(byte_size>=0 AND byte_size<=20971520), sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX builds_app_history ON builds(app_id,created_at DESC,id);
CREATE INDEX build_attempts_pending ON build_attempts(next_poll_at,lease_expires_at) WHERE status IN ('queued','running','unknown');
COMMIT;
