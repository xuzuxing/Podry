BEGIN;
CREATE TABLE deployment_previews (
 id uuid PRIMARY KEY, app_id uuid NOT NULL REFERENCES applications(id), binding_id uuid NOT NULL,
 artifact_id uuid NOT NULL, config_version integer NOT NULL, binding_version integer NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, consumed_at timestamptz,
 FOREIGN KEY(binding_id,app_id) REFERENCES app_environment_bindings(id,app_id),
 FOREIGN KEY(artifact_id,app_id) REFERENCES artifacts(id,app_id),
 FOREIGN KEY(app_id,config_version) REFERENCES app_config_versions(app_id,version),
 CHECK(expires_at>created_at)
);
CREATE FUNCTION podry_preview_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at')
 OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN
  RAISE EXCEPTION 'immutable deployment preview' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preview_inputs_immutable BEFORE UPDATE ON deployment_previews
FOR EACH ROW EXECUTE FUNCTION podry_preview_immutable();
CREATE TABLE release_snapshots (
 id uuid PRIMARY KEY, preview_id uuid NOT NULL UNIQUE REFERENCES deployment_previews(id),
 app_id uuid NOT NULL REFERENCES applications(id), binding_id uuid NOT NULL, artifact_id uuid NOT NULL,
 config_version integer NOT NULL, binding_version integer NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(binding_id,app_id) REFERENCES app_environment_bindings(id,app_id),
 FOREIGN KEY(artifact_id,app_id) REFERENCES artifacts(id,app_id),
 FOREIGN KEY(app_id,config_version) REFERENCES app_config_versions(app_id,version)
);
CREATE TRIGGER release_snapshot_immutable BEFORE UPDATE OR DELETE ON release_snapshots
FOR EACH ROW EXECUTE FUNCTION podry_immutable_row();
CREATE TABLE release_requests (
 id uuid PRIMARY KEY, snapshot_id uuid NOT NULL UNIQUE REFERENCES release_snapshots(id),
 kind text NOT NULL DEFAULT 'deploy' CHECK(kind='deploy'),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','executing','succeeded','failed','unknown')),
 requested_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE deployments (
 id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE REFERENCES release_requests(id),
 target_id uuid NOT NULL REFERENCES deployment_targets(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','submitting','observing','succeeded','failed','unknown')),
 helm_revision integer CHECK(helm_revision>0), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_environment_bindings ADD CONSTRAINT binding_current_deployment
FOREIGN KEY(current_deployment_id) REFERENCES deployments(id);
CREATE INDEX release_snapshot_history ON release_snapshots(app_id,created_at DESC,id);
CREATE INDEX release_request_pending ON release_requests(created_at,id) WHERE status IN ('queued','executing','unknown');
COMMIT;
