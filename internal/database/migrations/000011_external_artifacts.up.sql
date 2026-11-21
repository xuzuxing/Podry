BEGIN;
ALTER TABLE applications DROP CONSTRAINT applications_source_mode_check,
 ADD CONSTRAINT applications_source_mode_check CHECK(source_mode IN ('git','image'));
ALTER TABLE artifacts ALTER COLUMN build_id DROP NOT NULL, ALTER COLUMN attempt_id DROP NOT NULL;
ALTER TABLE artifacts DROP CONSTRAINT artifacts_source_check;
ALTER TABLE artifacts ADD COLUMN registry_id uuid REFERENCES registries(id),
 ADD COLUMN registry_credential_id uuid,
 ADD COLUMN registry_credential_version integer,
 ADD COLUMN imported_by uuid REFERENCES users(id),
 ADD CONSTRAINT artifacts_source_check CHECK(source IN ('build','external')),
 ADD CONSTRAINT artifacts_origin_check CHECK(
  (source='build' AND build_id IS NOT NULL AND attempt_id IS NOT NULL AND registry_id IS NULL AND imported_by IS NULL AND registry_credential_id IS NULL AND registry_credential_version IS NULL)
  OR (source='external' AND build_id IS NULL AND attempt_id IS NULL AND registry_id IS NOT NULL AND imported_by IS NOT NULL)),
 ADD CONSTRAINT artifacts_registry_credential_pair CHECK((registry_credential_id IS NULL)=(registry_credential_version IS NULL)),
 ADD CONSTRAINT artifacts_registry_credential_version_fk FOREIGN KEY(registry_credential_id,registry_credential_version) REFERENCES secret_versions(credential_id,version);
COMMIT;
