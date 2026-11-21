BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM resource_operations) OR EXISTS(SELECT 1 FROM resource_previews) THEN
  RAISE EXCEPTION 'resource preview or operation history prevents downgrade' USING ERRCODE='23514';
 END IF;
END $$;
DROP TABLE resource_operations;
DROP TABLE resource_previews;
DROP FUNCTION podry_resource_operation_identity();
DROP FUNCTION podry_resource_preview_identity();
COMMIT;
