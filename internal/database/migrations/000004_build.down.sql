BEGIN;
DROP TABLE log_archives;
ALTER TABLE builds DROP CONSTRAINT builds_artifact_app;
DROP TABLE artifacts;
DROP TABLE build_attempts;
DROP FUNCTION podry_build_inputs_immutable();
DROP TABLE builds;
ALTER TABLE pipelines DROP CONSTRAINT pipelines_identity_app;
COMMIT;
