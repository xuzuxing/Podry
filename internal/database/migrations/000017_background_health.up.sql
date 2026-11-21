BEGIN;
-- Scheduling metadata only. Health remains a short-lived, identity-bound cache.
CREATE TABLE binding_health_polls (
 binding_id uuid PRIMARY KEY REFERENCES app_environment_bindings(id) ON DELETE CASCADE,
 next_poll_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_until timestamptz, started_at timestamptz,
 last_error_code text,
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE INDEX binding_health_polls_due ON binding_health_polls(next_poll_at,binding_id);
INSERT INTO binding_health_polls(binding_id) SELECT id FROM app_environment_bindings;
CREATE FUNCTION podry_schedule_binding_health() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO binding_health_polls(binding_id) VALUES(NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER binding_health_schedule AFTER INSERT ON app_environment_bindings
FOR EACH ROW EXECUTE FUNCTION podry_schedule_binding_health();
COMMIT;
