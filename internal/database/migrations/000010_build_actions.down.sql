BEGIN;
-- Never erase cancellation provenance or make old workers resume a stopped Job.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM build_attempts WHERE cancel_requested_at IS NOT NULL OR attempt_no>1) THEN
  RAISE EXCEPTION 'build action history prevents downgrade' USING ERRCODE='23514';
 END IF;
END $$;
DROP INDEX build_attempts_pending;
CREATE INDEX build_attempts_pending ON build_attempts(next_poll_at,lease_expires_at)
 WHERE status IN ('queued','running','unknown');
DROP TRIGGER build_identity_immutable ON builds;
DROP FUNCTION podry_build_identity_immutable();
DROP TRIGGER build_cancel_immutable ON build_attempts;
DROP FUNCTION podry_build_cancel_immutable();
ALTER TABLE build_attempts DROP CONSTRAINT build_cancel_actor,
 DROP COLUMN cancel_requested_at, DROP COLUMN cancel_requested_by;
COMMIT;
