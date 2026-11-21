BEGIN;
DROP TABLE pipelines,app_environment_bindings,deployment_targets,app_config_versions,applications;
DROP FUNCTION podry_config_sequence();
COMMIT;
