BEGIN;
ALTER TABLE audit_events DROP CONSTRAINT audit_events_cluster_fk;
ALTER TABLE credentials DROP CONSTRAINT credentials_current_version_fk;
DROP TABLE resource_grants,registries,environments,clusters,secret_versions,credentials;
DROP FUNCTION podry_immutable_row();
COMMIT;
