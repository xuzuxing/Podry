BEGIN;
-- This removes retry/lease metadata, never deployment history or observations.
DROP TRIGGER binding_health_schedule ON app_environment_bindings;
DROP FUNCTION podry_schedule_binding_health();
DROP TABLE binding_health_polls;
COMMIT;
