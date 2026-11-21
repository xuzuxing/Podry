BEGIN;
CREATE TABLE resource_previews (
 id uuid PRIMARY KEY, cluster_id uuid NOT NULL REFERENCES clusters(id), requested_by uuid NOT NULL REFERENCES users(id),
 encrypted_documents bytea NOT NULL, key_id text NOT NULL, items_redacted jsonb NOT NULL CHECK(jsonb_typeof(items_redacted)='array'),
 expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,cluster_id,requested_by)
);
CREATE TABLE resource_operations (
 id uuid PRIMARY KEY, preview_id uuid NOT NULL UNIQUE REFERENCES resource_previews(id),
 cluster_id uuid NOT NULL REFERENCES clusters(id), requested_by uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind='apply'),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','partial','unknown')),
 encrypted_payload bytea NOT NULL, key_id text NOT NULL,
 payload_redacted jsonb NOT NULL CHECK(jsonb_typeof(payload_redacted)='array'),
 result_redacted jsonb NOT NULL CHECK(jsonb_typeof(result_redacted)='array'),
 stop_on_error boolean NOT NULL DEFAULT false,
 lease_owner text, lease_expires_at timestamptz, revision bigint NOT NULL DEFAULT 1, retry_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 CHECK ((lease_owner IS NULL)=(lease_expires_at IS NULL)),
 FOREIGN KEY(preview_id,cluster_id,requested_by) REFERENCES resource_previews(id,cluster_id,requested_by)
);
CREATE INDEX resource_operations_pending ON resource_operations(status,lease_expires_at) WHERE status IN ('queued','running','unknown');
CREATE FUNCTION podry_resource_preview_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at')
 OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN
  RAISE EXCEPTION 'immutable resource preview' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER resource_preview_identity BEFORE UPDATE ON resource_previews FOR EACH ROW EXECUTE FUNCTION podry_resource_preview_identity();
CREATE FUNCTION podry_resource_operation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.preview_id,NEW.cluster_id,NEW.requested_by,NEW.kind,NEW.encrypted_payload,NEW.key_id,NEW.payload_redacted,NEW.stop_on_error,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.preview_id,OLD.cluster_id,OLD.requested_by,OLD.kind,OLD.encrypted_payload,OLD.key_id,OLD.payload_redacted,OLD.stop_on_error,OLD.created_at)
 OR NEW.revision<>OLD.revision+1 OR OLD.status IN ('succeeded','failed','partial') THEN
  RAISE EXCEPTION 'immutable resource operation identity' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER resource_operation_identity BEFORE UPDATE ON resource_operations FOR EACH ROW EXECUTE FUNCTION podry_resource_operation_identity();
COMMIT;
