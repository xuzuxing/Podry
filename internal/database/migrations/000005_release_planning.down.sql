BEGIN;
ALTER TABLE app_environment_bindings DROP CONSTRAINT binding_current_deployment;
DROP TABLE deployments,release_requests,release_snapshots,deployment_previews;
DROP FUNCTION podry_preview_immutable();
COMMIT;
