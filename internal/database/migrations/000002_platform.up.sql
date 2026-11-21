BEGIN;
CREATE TABLE credentials (
    id uuid PRIMARY KEY, team_id uuid REFERENCES teams(id), name text NOT NULL,
    kind text NOT NULL CHECK(kind IN ('git','registry','kubeconfig','secret')),
    version integer NOT NULL CHECK(version > 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credentials_scope_name ON credentials(COALESCE(team_id,'00000000-0000-0000-0000-000000000000'::uuid),name);
CREATE TABLE secret_versions (
    credential_id uuid NOT NULL REFERENCES credentials(id), version integer NOT NULL CHECK(version>0),
    encrypted_payload bytea NOT NULL, key_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(credential_id,version)
);
ALTER TABLE credentials ADD CONSTRAINT credentials_current_version_fk
FOREIGN KEY(id,version) REFERENCES secret_versions(credential_id,version) DEFERRABLE INITIALLY DEFERRED;
-- Version content is append-only, including for a service role accidentally granted UPDATE.
CREATE FUNCTION podry_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable version' USING ERRCODE='23514'; END $$;
CREATE TRIGGER secret_versions_immutable BEFORE UPDATE OR DELETE ON secret_versions
FOR EACH ROW EXECUTE FUNCTION podry_immutable_row();
CREATE TABLE clusters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, api_server text NOT NULL,
    credential_id uuid NOT NULL REFERENCES credentials(id), connection_status text NOT NULL DEFAULT 'unknown'
      CHECK(connection_status IN ('unknown','connected','unavailable')),
    server_version text, last_checked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audit_events ADD CONSTRAINT audit_events_cluster_fk FOREIGN KEY(cluster_id) REFERENCES clusters(id);
CREATE TABLE environments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, production boolean NOT NULL,
    auto_deploy_allowed boolean NOT NULL DEFAULT false CHECK(NOT auto_deploy_allowed),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE registries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, endpoint text NOT NULL,
    credential_id uuid REFERENCES credentials(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE resource_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id),
    team_id uuid REFERENCES teams(id), project_id uuid REFERENCES projects(id),
    cluster_id uuid NOT NULL REFERENCES clusters(id), namespace text NOT NULL,
    resources text[] NOT NULL, actions text[] NOT NULL,
    CHECK(num_nonnulls(user_id,team_id,project_id)=1),
    CHECK(cardinality(resources)>0 AND cardinality(actions)>0)
);
CREATE INDEX resource_grants_cluster ON resource_grants(cluster_id);
COMMIT;
