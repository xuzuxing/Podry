BEGIN;
-- Persist only comparison results and version identities, never manifests or values.
CREATE TABLE application_drift_observations (
 id uuid PRIMARY KEY,
 binding_id uuid NOT NULL REFERENCES app_environment_bindings(id) ON DELETE CASCADE,
 deployment_id uuid NOT NULL REFERENCES deployments(id),
 snapshot_key text NOT NULL CHECK(snapshot_key ~ '^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN ('aligned','drifted','unknown')),
 reason text NOT NULL CHECK(reason IN ('compared','read_failed','identity_changed','identity_unconfirmed','release_unsettled','resource_operation_pending')),
 resource_count integer NOT NULL CHECK(resource_count BETWEEN 0 AND 64),
 changed_count integer NOT NULL CHECK(changed_count BETWEEN 0 AND resource_count),
 missing_count integer NOT NULL CHECK(missing_count BETWEEN 0 AND resource_count),
 observed_at timestamptz NOT NULL,
 CHECK(changed_count+missing_count<=resource_count),
 CHECK((status='unknown' AND reason<>'compared' AND changed_count=0 AND missing_count=0)
    OR (status='aligned' AND reason='compared' AND changed_count=0 AND missing_count=0)
    OR (status='drifted' AND reason='compared' AND changed_count+missing_count>0))
);
CREATE INDEX application_drift_binding_time_idx ON application_drift_observations(binding_id,observed_at DESC,id DESC);
COMMIT;
