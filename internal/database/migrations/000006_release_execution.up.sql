BEGIN;
ALTER TABLE deployment_targets
 ADD COLUMN active_deployment_id uuid REFERENCES deployments(id),
 ADD COLUMN fencing_token bigint NOT NULL DEFAULT 0 CHECK(fencing_token>=0);
CREATE UNIQUE INDEX target_active_deployment ON deployment_targets(active_deployment_id) WHERE active_deployment_id IS NOT NULL;
ALTER TABLE deployments
 ADD COLUMN revision bigint NOT NULL DEFAULT 0,
 ADD COLUMN fencing_token bigint NOT NULL DEFAULT 0,
 ADD COLUMN lease_owner uuid,
 ADD COLUMN lease_until timestamptz,
 ADD COLUMN next_poll_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN started_at timestamptz,
 ADD COLUMN finished_at timestamptz,
 ADD COLUMN error_code text;
CREATE INDEX deployment_poll ON deployments(next_poll_at,created_at,id) WHERE status IN ('queued','submitting','observing','unknown');
CREATE TABLE deployment_resources (
 deployment_id uuid NOT NULL REFERENCES deployments(id),
 api_version text NOT NULL, kind text NOT NULL, namespace text NOT NULL, name text NOT NULL,
 uid text NOT NULL CHECK(uid<>''),
 owner_references jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(owner_references)='array'),
 observed_generation bigint NOT NULL DEFAULT 0,
 observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(deployment_id,api_version,kind,namespace,name)
);
COMMIT;
