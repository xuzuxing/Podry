BEGIN;
ALTER TABLE build_attempts
 ADD COLUMN cancel_requested_at timestamptz,
 ADD COLUMN cancel_requested_by uuid REFERENCES users(id),
 ADD CONSTRAINT build_cancel_actor CHECK((cancel_requested_at IS NULL)=(cancel_requested_by IS NULL));
CREATE FUNCTION podry_build_cancel_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.cancel_requested_at IS NOT NULL AND
  ROW(NEW.cancel_requested_at,NEW.cancel_requested_by) IS DISTINCT FROM ROW(OLD.cancel_requested_at,OLD.cancel_requested_by) THEN
  RAISE EXCEPTION 'immutable build cancellation intent' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER build_cancel_immutable BEFORE UPDATE ON build_attempts
 FOR EACH ROW EXECUTE FUNCTION podry_build_cancel_immutable();
CREATE FUNCTION podry_build_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.app_id,NEW.pipeline_id,NEW.config_version,NEW.commit_sha,NEW.requested_by,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.app_id,OLD.pipeline_id,OLD.config_version,OLD.commit_sha,OLD.requested_by,OLD.created_at)
  OR (OLD.artifact_id IS NOT NULL AND NEW.artifact_id IS DISTINCT FROM OLD.artifact_id) THEN
  RAISE EXCEPTION 'immutable build identity' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER build_identity_immutable BEFORE UPDATE ON builds
 FOR EACH ROW EXECUTE FUNCTION podry_build_identity_immutable();
DROP INDEX build_attempts_pending;
CREATE INDEX build_attempts_pending ON build_attempts(next_poll_at,lease_expires_at)
 WHERE status IN ('queued','running','canceling','unknown');
COMMIT;
