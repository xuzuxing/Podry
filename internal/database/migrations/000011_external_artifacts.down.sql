BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM artifacts WHERE source='external') OR EXISTS(SELECT 1 FROM applications WHERE source_mode='image') THEN
  RAISE EXCEPTION 'external image history prevents downgrade' USING ERRCODE='23514';
 END IF;
END $$;
ALTER TABLE applications DROP CONSTRAINT applications_source_mode_check,
 ADD CONSTRAINT applications_source_mode_check CHECK(source_mode='git');
ALTER TABLE artifacts DROP CONSTRAINT artifacts_origin_check,
 DROP CONSTRAINT artifacts_registry_credential_pair, DROP CONSTRAINT artifacts_registry_credential_version_fk,
 DROP CONSTRAINT artifacts_source_check,
 DROP COLUMN registry_id, DROP COLUMN registry_credential_id, DROP COLUMN registry_credential_version, DROP COLUMN imported_by,
 ADD CONSTRAINT artifacts_source_check CHECK(source='build'),
 ALTER COLUMN build_id SET NOT NULL, ALTER COLUMN attempt_id SET NOT NULL;
COMMIT;
