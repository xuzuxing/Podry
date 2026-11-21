BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM application_drift_observations) THEN
  RAISE EXCEPTION 'application drift history exists; downgrade would discard observations';
 END IF;
END $$;
DROP TABLE application_drift_observations;
COMMIT;
