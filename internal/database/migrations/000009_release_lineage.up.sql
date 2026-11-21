BEGIN;
ALTER TABLE release_requests DROP CONSTRAINT release_requests_kind_check;
ALTER TABLE release_requests ADD CONSTRAINT release_requests_kind_check CHECK(kind IN ('deploy','promote','rollback'));
ALTER TABLE release_requests
 ADD COLUMN source_deployment_id uuid REFERENCES deployments(id),
 ADD COLUMN reason text NOT NULL DEFAULT '',
 ADD CONSTRAINT release_request_source CHECK((kind='deploy')=(source_deployment_id IS NULL)),
 ADD CONSTRAINT release_request_reason CHECK(
  (kind='rollback' AND char_length(btrim(reason)) BETWEEN 1 AND 1000) OR (kind<>'rollback' AND reason=''));
CREATE FUNCTION podry_release_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src record; dst record;
BEGIN
 IF NEW.kind='deploy' THEN RETURN NEW; END IF;
 SELECT d.status,s.app_id,s.binding_id,s.artifact_id INTO src FROM deployments d
 JOIN release_requests r ON r.id=d.request_id JOIN release_snapshots s ON s.id=r.snapshot_id
 WHERE d.id=NEW.source_deployment_id FOR SHARE OF d;
 SELECT app_id,binding_id,artifact_id INTO dst FROM release_snapshots WHERE id=NEW.snapshot_id;
 IF src.status IS DISTINCT FROM 'succeeded' OR src.app_id IS DISTINCT FROM dst.app_id
  OR src.artifact_id IS DISTINCT FROM dst.artifact_id
  OR (NEW.kind='rollback' AND src.binding_id IS DISTINCT FROM dst.binding_id)
  OR (NEW.kind='promote' AND src.binding_id IS NOT DISTINCT FROM dst.binding_id) THEN
  RAISE EXCEPTION 'invalid release lineage' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER release_lineage BEFORE INSERT ON release_requests FOR EACH ROW EXECUTE FUNCTION podry_release_lineage();
CREATE FUNCTION podry_release_request_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
  RAISE EXCEPTION 'immutable release request identity' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER release_request_identity BEFORE UPDATE ON release_requests
 FOR EACH ROW EXECUTE FUNCTION podry_release_request_identity_immutable();
COMMIT;
