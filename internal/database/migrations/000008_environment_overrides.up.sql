BEGIN;
ALTER TABLE app_environment_bindings DROP CONSTRAINT app_environment_bindings_override_values_check;
ALTER TABLE app_environment_bindings ADD CONSTRAINT app_environment_bindings_override_values_check
 CHECK(jsonb_typeof(override_values)='object');
COMMIT;
