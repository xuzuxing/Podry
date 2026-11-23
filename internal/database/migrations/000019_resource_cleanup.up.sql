BEGIN;
ALTER TABLE build_attempts
 ADD COLUMN next_cleanup_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN cleanup_attempts integer NOT NULL DEFAULT 0 CHECK(cleanup_attempts>=0),
 ADD COLUMN cleanup_error_code text,
 ADD COLUMN resources_cleaned_at timestamptz;
ALTER TABLE deployments
 ADD COLUMN next_cleanup_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN cleanup_attempts integer NOT NULL DEFAULT 0 CHECK(cleanup_attempts>=0),
 ADD COLUMN cleanup_error_code text,
 ADD COLUMN resources_cleaned_at timestamptz;
CREATE INDEX build_cleanup_pending ON build_attempts(next_cleanup_at,finished_at,id)
 WHERE stage='finished' AND resources_cleaned_at IS NULL AND job_uid IS NOT NULL;
CREATE INDEX release_cleanup_pending ON deployments(next_cleanup_at,finished_at,id)
 WHERE status IN ('succeeded','failed') AND resources_cleaned_at IS NULL;
COMMIT;
