BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM resource_operations WHERE kind<>'apply') THEN
  RAISE EXCEPTION 'resource action history prevents downgrade' USING ERRCODE='23514';
 END IF;
END $$;
ALTER TABLE resource_operations DROP CONSTRAINT resource_operation_preview_kind;
ALTER TABLE resource_operations DROP CONSTRAINT resource_operations_kind_check;
ALTER TABLE resource_operations ADD CONSTRAINT resource_operations_kind_check CHECK(kind='apply');
ALTER TABLE resource_operations ALTER COLUMN preview_id SET NOT NULL;
COMMIT;
