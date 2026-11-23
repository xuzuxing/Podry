BEGIN;
ALTER TABLE webhook_deliveries DROP CONSTRAINT webhook_deliveries_provider_check;
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_provider_check
 CHECK(provider IN ('github','gitea','gitlab','gitee'));
COMMIT;
