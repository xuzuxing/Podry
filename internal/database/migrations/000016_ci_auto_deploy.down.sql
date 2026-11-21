BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM auto_deploy_intents)
 OR EXISTS(SELECT 1 FROM environments WHERE auto_deploy_allowed)
 OR EXISTS(SELECT 1 FROM app_environment_bindings WHERE auto_deploy)
 OR EXISTS(SELECT 1 FROM pipelines WHERE definition->>'triggerMode'='on_ci_success') THEN
   RAISE EXCEPTION 'automatic deployment configuration or history prevents downgrade';
 END IF;
END $$;
DROP TRIGGER builds_capture_auto_deploy ON builds;
DROP FUNCTION podry_capture_auto_deploy();
DROP TABLE auto_deploy_intents;
DROP FUNCTION podry_auto_deploy_identity();
DROP TABLE pipeline_deploy_authorizations;
ALTER TABLE environments DROP CONSTRAINT environments_auto_deploy_policy;
ALTER TABLE environments ADD CONSTRAINT environments_auto_deploy_allowed_check CHECK(NOT auto_deploy_allowed);
ALTER TABLE app_environment_bindings ADD CONSTRAINT app_environment_bindings_auto_deploy_check CHECK(NOT auto_deploy);
COMMIT;
