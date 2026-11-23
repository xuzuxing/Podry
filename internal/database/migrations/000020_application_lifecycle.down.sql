BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM app_environment_bindings WHERE detached_at IS NOT NULL) OR EXISTS(SELECT 1 FROM release_requests WHERE kind='offline') THEN RAISE EXCEPTION 'application lifecycle history prevents downgrade' USING ERRCODE='23514'; END IF; END $$;
CREATE OR REPLACE VIEW application_health AS
WITH binding_states AS (
 SELECT b.app_id, CASE
  WHEN o.observed_at > now()-interval '60 seconds'
   AND o.binding_version=b.version AND o.deployment_id=d.id AND o.deployment_revision=d.revision
   AND d.target_id=b.target_id AND o.credential_id=c.credential_id AND o.credential_version=cr.version
  THEN o.health ELSE 'unknown' END AS health
 FROM app_environment_bindings b JOIN deployment_targets t ON t.id=b.target_id
 JOIN clusters c ON c.id=t.cluster_id JOIN credentials cr ON cr.id=c.credential_id
 LEFT JOIN LATERAL (
  SELECT d.id,d.revision,d.target_id FROM deployments d
  JOIN release_requests r ON r.id=d.request_id JOIN release_snapshots s ON s.id=r.snapshot_id
  WHERE s.binding_id=b.id ORDER BY d.created_at DESC,d.id DESC LIMIT 1
 ) d ON true
 LEFT JOIN binding_observations o ON o.binding_id=b.id
)
SELECT a.id AS app_id, CASE WHEN a.archived_at IS NOT NULL THEN 'stopped'
 WHEN count(s.health)=0 THEN 'unknown'
 WHEN bool_or(s.health='degraded') THEN 'degraded'
 WHEN bool_or(s.health='unknown') THEN 'unknown'
 WHEN bool_or(s.health='progressing') THEN 'progressing'
 WHEN bool_or(s.health='healthy') THEN 'healthy'
 WHEN bool_or(s.health='stopped') THEN 'stopped'
 ELSE 'completed' END::text AS health
FROM applications a LEFT JOIN binding_states s ON s.app_id=a.id GROUP BY a.id;

CREATE OR REPLACE FUNCTION podry_release_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
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

ALTER TABLE release_requests DROP CONSTRAINT release_requests_kind_check, DROP CONSTRAINT release_request_reason;
ALTER TABLE release_requests ADD CONSTRAINT release_requests_kind_check CHECK(kind IN ('deploy','promote','rollback'));
ALTER TABLE release_requests ADD CONSTRAINT release_request_reason CHECK((kind='rollback' AND char_length(btrim(reason)) BETWEEN 1 AND 1000) OR (kind<>'rollback' AND reason=''));
DROP INDEX bindings_active_environment;
ALTER TABLE app_environment_bindings DROP CONSTRAINT detached_binding_inactive, DROP COLUMN detached_at;
ALTER TABLE app_environment_bindings ADD CONSTRAINT app_environment_bindings_app_id_environment_id_key UNIQUE(app_id,environment_id);
COMMIT;
