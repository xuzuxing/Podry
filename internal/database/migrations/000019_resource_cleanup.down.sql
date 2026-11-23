BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM build_attempts WHERE cleanup_attempts>0)
 OR EXISTS(SELECT 1 FROM deployments WHERE cleanup_attempts>0) THEN
  RAISE EXCEPTION 'resource cleanup history prevents downgrade';
 END IF;
END $$;
DROP INDEX release_cleanup_pending;
DROP INDEX build_cleanup_pending;
ALTER TABLE deployments DROP COLUMN resources_cleaned_at, DROP COLUMN cleanup_error_code,
 DROP COLUMN cleanup_attempts, DROP COLUMN next_cleanup_at;
ALTER TABLE build_attempts DROP COLUMN resources_cleaned_at, DROP COLUMN cleanup_error_code,
 DROP COLUMN cleanup_attempts, DROP COLUMN next_cleanup_at;
COMMIT;
