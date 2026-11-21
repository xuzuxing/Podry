BEGIN;
ALTER TABLE environments DROP CONSTRAINT environments_auto_deploy_allowed_check;
ALTER TABLE environments ADD CONSTRAINT environments_auto_deploy_policy CHECK(NOT production OR NOT auto_deploy_allowed);
ALTER TABLE app_environment_bindings DROP CONSTRAINT app_environment_bindings_auto_deploy_check;

CREATE TABLE pipeline_deploy_authorizations (
 pipeline_id uuid PRIMARY KEY REFERENCES pipelines(id) ON DELETE CASCADE,
 authorized_by uuid NOT NULL REFERENCES users(id),
 pipeline_version integer NOT NULL CHECK(pipeline_version>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auto_deploy_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 build_id uuid NOT NULL REFERENCES builds(id),
 pipeline_id uuid NOT NULL,
 binding_id uuid NOT NULL REFERENCES app_environment_bindings(id),
 authorized_by uuid NOT NULL REFERENCES users(id),
 config_version integer NOT NULL CHECK(config_version>0),
 workflow_version integer NOT NULL CHECK(workflow_version>0),
 pipeline_version integer NOT NULL CHECK(pipeline_version>0),
 ci_version integer NOT NULL CHECK(ci_version>0),
 binding_version integer NOT NULL CHECK(binding_version>0),
 status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','blocked','dispatched','skipped')),
 error_code text,
 request_id uuid UNIQUE REFERENCES release_requests(id),
 next_poll_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(build_id,pipeline_id),
 CHECK((status='dispatched')=(request_id IS NOT NULL))
);
CREATE INDEX auto_deploy_intents_pending ON auto_deploy_intents(next_poll_at,id) WHERE status IN ('waiting','blocked');
CREATE FUNCTION podry_auto_deploy_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'auto deployment history is immutable' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.build_id,NEW.pipeline_id,NEW.binding_id,NEW.authorized_by,NEW.config_version,
     NEW.workflow_version,NEW.pipeline_version,NEW.ci_version,NEW.binding_version,NEW.created_at)
   IS DISTINCT FROM
    (OLD.id,OLD.build_id,OLD.pipeline_id,OLD.binding_id,OLD.authorized_by,OLD.config_version,
     OLD.workflow_version,OLD.pipeline_version,OLD.ci_version,OLD.binding_version,OLD.created_at)
   OR OLD.status IN ('dispatched','skipped') THEN
   RAISE EXCEPTION 'auto deployment identity or terminal state is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER auto_deploy_intents_identity BEFORE UPDATE OR DELETE ON auto_deploy_intents
FOR EACH ROW EXECUTE FUNCTION podry_auto_deploy_identity();

-- Capture policy in the SAME transaction as build admission. Existing builds
-- are never backfilled when automatic deployment is enabled later.
CREATE FUNCTION podry_capture_auto_deploy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO auto_deploy_intents(build_id,pipeline_id,binding_id,authorized_by,config_version,
   workflow_version,pipeline_version,ci_version,binding_version)
 SELECT NEW.id,cd.id,b.id,d.authorized_by,NEW.config_version,a.workflow_version,cd.version,ci.version,b.version
 FROM applications a JOIN pipelines ci ON ci.id=NEW.pipeline_id AND ci.app_id=a.id AND ci.enabled
 JOIN pipelines cd ON cd.app_id=a.id AND cd.kind='cd' AND cd.enabled
 JOIN pipeline_deploy_authorizations d ON d.pipeline_id=cd.id AND d.pipeline_version=cd.version
 JOIN app_environment_bindings b ON b.id=cd.binding_id AND b.auto_deploy
 JOIN environments e ON e.id=b.environment_id AND e.auto_deploy_allowed AND NOT e.production
 WHERE a.id=NEW.app_id AND a.archived_at IS NULL AND cd.definition->>'triggerMode'='on_ci_success'
   AND cd.definition->>'upstreamPipelineId'=ci.id::text;
 RETURN NEW;
END $$;
CREATE TRIGGER builds_capture_auto_deploy AFTER INSERT ON builds
FOR EACH ROW EXECUTE FUNCTION podry_capture_auto_deploy();
COMMIT;
