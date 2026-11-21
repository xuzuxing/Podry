BEGIN;
CREATE TABLE binding_observations (
 binding_id uuid PRIMARY KEY REFERENCES app_environment_bindings(id) ON DELETE CASCADE,
 binding_version integer NOT NULL,
 deployment_id uuid NOT NULL REFERENCES deployments(id),
 deployment_revision bigint NOT NULL,
 credential_id uuid NOT NULL REFERENCES credentials(id),
 credential_version integer NOT NULL,
 health text NOT NULL CHECK(health IN ('unknown','progressing','healthy','completed','degraded','stopped')),
 observed_at timestamptz NOT NULL
);
-- Health is a short-lived observation, never a synonym for release success.
-- New execution/revision, target edits, rotation and expiry invalidate it.
CREATE VIEW application_health AS
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
COMMIT;
