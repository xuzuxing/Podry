BEGIN;
-- Never discard provider identities: old binaries cannot safely replay them.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM webhook_deliveries WHERE provider <> 'github') THEN
  RAISE EXCEPTION 'non-GitHub webhook history prevents downgrade' USING ERRCODE='23514';
 END IF;
END $$;
ALTER TABLE webhook_deliveries DROP CONSTRAINT webhook_deliveries_provider_check;
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_provider_check CHECK(provider='github');
COMMIT;
