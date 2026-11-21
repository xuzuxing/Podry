BEGIN;
-- The last explicit workflow save delegates Push admission to a real user.
-- No bearer token, payload or signing secret is stored here.
CREATE TABLE pipeline_push_authorizations (
 pipeline_id uuid PRIMARY KEY REFERENCES pipelines(id) ON DELETE CASCADE,
 authorized_by uuid NOT NULL REFERENCES users(id),
 pipeline_version integer NOT NULL CHECK(pipeline_version>0),
 repository_url text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE webhook_deliveries (
 id uuid PRIMARY KEY,
 provider text NOT NULL CHECK(provider='github'),
 pipeline_id uuid NOT NULL REFERENCES pipelines(id),
 delivery_id text NOT NULL CHECK(length(delivery_id) BETWEEN 1 AND 100),
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 build_id uuid REFERENCES builds(id),
 status text NOT NULL CHECK(status IN ('ignored','accepted')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,pipeline_id,delivery_id),
 CHECK((status='accepted')=(build_id IS NOT NULL))
);
CREATE TRIGGER webhook_deliveries_immutable BEFORE UPDATE OR DELETE ON webhook_deliveries
FOR EACH ROW EXECUTE FUNCTION podry_immutable_row();
COMMIT;
