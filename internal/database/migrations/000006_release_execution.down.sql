BEGIN;
DROP TABLE deployment_resources;
DROP INDEX deployment_poll;
ALTER TABLE deployments DROP COLUMN revision,DROP COLUMN fencing_token,DROP COLUMN lease_owner,DROP COLUMN lease_until,DROP COLUMN next_poll_at,DROP COLUMN started_at,DROP COLUMN finished_at,DROP COLUMN error_code;
DROP INDEX target_active_deployment;
ALTER TABLE deployment_targets DROP COLUMN active_deployment_id,DROP COLUMN fencing_token;
COMMIT;
