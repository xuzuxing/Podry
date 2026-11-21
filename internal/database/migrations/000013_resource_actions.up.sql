BEGIN;
ALTER TABLE resource_operations ALTER COLUMN preview_id DROP NOT NULL;
ALTER TABLE resource_operations DROP CONSTRAINT resource_operations_kind_check;
ALTER TABLE resource_operations ADD CONSTRAINT resource_operations_kind_check CHECK(kind IN ('apply','delete','restart','scale'));
ALTER TABLE resource_operations ADD CONSTRAINT resource_operation_preview_kind CHECK((kind='apply')=(preview_id IS NOT NULL));
COMMIT;
