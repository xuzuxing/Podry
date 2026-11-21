BEGIN;
-- Reject downgrade while derived release history exists; never discard lineage.
ALTER TABLE release_requests DROP CONSTRAINT release_requests_kind_check;
ALTER TABLE release_requests ADD CONSTRAINT release_requests_kind_check CHECK(kind='deploy');
DROP TRIGGER release_request_identity ON release_requests;
DROP FUNCTION podry_release_request_identity_immutable();
DROP TRIGGER release_lineage ON release_requests;
DROP FUNCTION podry_release_lineage();
ALTER TABLE release_requests DROP CONSTRAINT release_request_source, DROP CONSTRAINT release_request_reason,
 DROP COLUMN source_deployment_id, DROP COLUMN reason;
COMMIT;
