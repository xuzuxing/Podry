BEGIN;
CREATE TABLE applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id),
 name text NOT NULL CHECK(name ~ '^[a-z][a-z0-9-]{1,61}[a-z0-9]$'), description text NOT NULL DEFAULT '',
 source_mode text NOT NULL CHECK(source_mode='git'), workflow_version integer NOT NULL DEFAULT 0 CHECK(workflow_version>=0),
 archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,name)
);
CREATE TABLE app_config_versions (
 app_id uuid NOT NULL REFERENCES applications(id), version integer NOT NULL CHECK(version>0),
 git_config jsonb CHECK(git_config IS NULL OR jsonb_typeof(git_config)='object'),
 build_config jsonb CHECK(build_config IS NULL OR jsonb_typeof(build_config)='object'),
 chart_config jsonb CHECK(chart_config IS NULL OR (jsonb_typeof(chart_config)='object' AND chart_config ? 'workloadKind' AND chart_config->>'workloadKind' IN ('Deployment','Job'))),
 deploy_values jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(deploy_values)='object'),
 secret_refs jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(secret_refs)='array'),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(app_id,version)
);
CREATE TRIGGER app_configs_immutable BEFORE UPDATE OR DELETE ON app_config_versions
FOR EACH ROW EXECUTE FUNCTION podry_immutable_row();
CREATE FUNCTION podry_config_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous app_config_versions;
BEGIN
 PERFORM 1 FROM applications WHERE id=NEW.app_id FOR UPDATE;
 SELECT * INTO previous FROM app_config_versions WHERE app_id=NEW.app_id ORDER BY version DESC LIMIT 1;
 IF NEW.version <> COALESCE(previous.version,0)+1 THEN
   RAISE EXCEPTION 'configuration sequence conflict' USING ERRCODE='23514';
 END IF;
 IF previous.chart_config IS NOT NULL AND (NEW.chart_config IS NULL OR
    previous.chart_config->>'workloadKind' IS DISTINCT FROM NEW.chart_config->>'workloadKind') THEN
   RAISE EXCEPTION 'chart kind locked' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER app_configs_sequence BEFORE INSERT ON app_config_versions
FOR EACH ROW EXECUTE FUNCTION podry_config_sequence();
CREATE TABLE deployment_targets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cluster_id uuid NOT NULL REFERENCES clusters(id),
 namespace text NOT NULL CHECK(namespace<>''), release_name text NOT NULL,
 UNIQUE(cluster_id,namespace,release_name)
);
CREATE TABLE app_environment_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), app_id uuid NOT NULL REFERENCES applications(id),
 environment_id uuid NOT NULL REFERENCES environments(id), target_id uuid NOT NULL UNIQUE REFERENCES deployment_targets(id),
 override_values jsonb NOT NULL DEFAULT '{}' CHECK(override_values='{}'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), auto_deploy boolean NOT NULL DEFAULT false CHECK(NOT auto_deploy),
 current_deployment_id uuid, UNIQUE(app_id,environment_id), UNIQUE(id,app_id)
);
CREATE TABLE pipelines (
 id uuid PRIMARY KEY, app_id uuid NOT NULL REFERENCES applications(id), binding_id uuid,
 kind text NOT NULL CHECK(kind IN ('ci','cd')), definition jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), enabled boolean NOT NULL DEFAULT true,
 CHECK((kind='ci' AND binding_id IS NULL) OR (kind='cd' AND binding_id IS NOT NULL)),
 FOREIGN KEY(binding_id,app_id) REFERENCES app_environment_bindings(id,app_id)
);
CREATE UNIQUE INDEX pipelines_one_ci ON pipelines(app_id) WHERE kind='ci';
CREATE UNIQUE INDEX pipelines_one_cd ON pipelines(binding_id) WHERE kind='cd';
COMMIT;
