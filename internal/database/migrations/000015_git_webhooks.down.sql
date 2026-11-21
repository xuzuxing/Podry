BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM webhook_deliveries)
 OR EXISTS(SELECT 1 FROM pipelines WHERE kind='ci' AND definition->>'push'='true') THEN
  RAISE EXCEPTION 'webhook history or push configuration prevents downgrade' USING ERRCODE='23514';
 END IF;
END $$;
DROP TABLE webhook_deliveries;
DROP TABLE pipeline_push_authorizations;
COMMIT;
