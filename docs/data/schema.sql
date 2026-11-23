-- Podry V1.0 PostgreSQL design draft, 2026-11-19.
-- Review artifact only. Not an installed migration and not runtime-validated.
-- Sensitive payloads must be authenticated ciphertext, never plaintext JSON.
BEGIN;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    name text NOT NULL,
    password_hash text NOT NULL,
    is_super_admin boolean NOT NULL DEFAULT false,
    token_version integer NOT NULL DEFAULT 1 CHECK (token_version > 0),
    disabled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE team_members (
    team_id uuid NOT NULL REFERENCES teams(id), user_id uuid NOT NULL REFERENCES users(id),
    role text NOT NULL CHECK (role IN ('admin','developer','operator','viewer')),
    PRIMARY KEY (team_id,user_id)
);
CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams(id),
    name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(team_id,name)
);
CREATE TABLE project_members (
    project_id uuid NOT NULL REFERENCES projects(id), user_id uuid NOT NULL REFERENCES users(id),
    role text NOT NULL CHECK (role IN ('admin','developer','operator','viewer')),
    PRIMARY KEY(project_id,user_id)
);
CREATE TABLE credentials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams(id),
    name text NOT NULL, kind text NOT NULL CHECK(kind IN ('git','registry','kubeconfig','secret')),
    encrypted_payload bytea NOT NULL, key_id text NOT NULL,
    version integer NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE secret_versions (
    credential_id uuid NOT NULL REFERENCES credentials(id), version integer NOT NULL CHECK(version > 0),
    encrypted_payload bytea NOT NULL, key_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), retired_at timestamptz,
    PRIMARY KEY(credential_id,version)
);
CREATE TABLE clusters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
    api_server text NOT NULL, credential_id uuid NOT NULL REFERENCES credentials(id),
    connection_status text NOT NULL DEFAULT 'unknown' CHECK(connection_status IN ('unknown','connected','unavailable')),
    server_version text, last_checked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE environments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
    production boolean NOT NULL DEFAULT false,
    auto_deploy_allowed boolean NOT NULL DEFAULT false CHECK(NOT production OR NOT auto_deploy_allowed),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE registries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
    endpoint text NOT NULL, credential_id uuid REFERENCES credentials(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE resource_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id), team_id uuid REFERENCES teams(id), project_id uuid REFERENCES projects(id),
    cluster_id uuid NOT NULL REFERENCES clusters(id), namespace text NOT NULL,
    resources text[] NOT NULL, actions text[] NOT NULL,
    CHECK(num_nonnulls(user_id,team_id,project_id)=1),
    CHECK(cardinality(resources)>0 AND cardinality(actions)>0)
);
CREATE TABLE applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id),
    name text NOT NULL, description text NOT NULL DEFAULT '',
    source_mode text NOT NULL CHECK(source_mode IN ('git','image')),
    workflow_version integer NOT NULL DEFAULT 0 CHECK(workflow_version>=0),
    archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id,name)
);
CREATE TABLE app_config_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), app_id uuid NOT NULL REFERENCES applications(id),
    version integer NOT NULL CHECK(version>0),
    git_config jsonb, build_config jsonb,
    -- NULL means Base Configurations has not been explicitly saved yet.
    -- workloadKind is locked after the first non-NULL chart_config; enforce across versions in the service transaction.
    chart_config jsonb CHECK(chart_config IS NULL OR (jsonb_typeof(chart_config)='object' AND chart_config ? 'workloadKind' AND chart_config->>'workloadKind' IN ('Deployment','Job'))),
    deploy_values jsonb NOT NULL DEFAULT '{}',
    secret_refs jsonb NOT NULL DEFAULT '[]',
    created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(app_id,version), CHECK(jsonb_typeof(secret_refs)='array')
);
CREATE TABLE deployment_targets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cluster_id uuid NOT NULL REFERENCES clusters(id),
    namespace text NOT NULL CHECK(namespace<>''), release_name text NOT NULL CHECK(release_name<>''),
    active_deployment_id uuid, fencing_token bigint NOT NULL DEFAULT 0,
    UNIQUE(cluster_id,namespace,release_name)
);
CREATE TABLE app_environment_bindings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), app_id uuid NOT NULL REFERENCES applications(id),
    environment_id uuid NOT NULL REFERENCES environments(id),
    target_id uuid NOT NULL UNIQUE REFERENCES deployment_targets(id),
    override_values jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1 CHECK(version>0),
    auto_deploy boolean NOT NULL DEFAULT false, current_deployment_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(app_id,environment_id), UNIQUE(id,app_id)
);
CREATE TABLE pipelines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), app_id uuid NOT NULL REFERENCES applications(id),
    binding_id uuid, kind text NOT NULL CHECK(kind IN ('ci','cd')),
    definition jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1 CHECK(version>0),
    enabled boolean NOT NULL DEFAULT true,
    CHECK((kind='ci' AND binding_id IS NULL) OR (kind='cd' AND binding_id IS NOT NULL)),
    FOREIGN KEY(binding_id,app_id) REFERENCES app_environment_bindings(id,app_id), UNIQUE(id,app_id)
);
CREATE UNIQUE INDEX pipelines_one_ci ON pipelines(app_id) WHERE kind='ci';
CREATE UNIQUE INDEX pipelines_one_cd ON pipelines(binding_id) WHERE kind='cd';
CREATE TABLE builds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), app_id uuid NOT NULL REFERENCES applications(id),
    pipeline_id uuid NOT NULL, config_version integer NOT NULL,
    commit_sha text NOT NULL CHECK(commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
    status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','canceling','succeeded','failed','canceled','unknown')),
    attempt_no integer NOT NULL DEFAULT 1 CHECK(attempt_no>0),
    requested_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(pipeline_id,app_id) REFERENCES pipelines(id,app_id),
    FOREIGN KEY(app_id,config_version) REFERENCES app_config_versions(app_id,version), UNIQUE(id,app_id)
);
CREATE TABLE build_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), build_id uuid NOT NULL REFERENCES builds(id),
    attempt_no integer NOT NULL CHECK(attempt_no>0),
    status text NOT NULL CHECK(status IN ('queued','running','canceling','succeeded','failed','canceled','unknown')),
    build_cluster_id uuid NOT NULL REFERENCES clusters(id), namespace text NOT NULL,
    job_name text NOT NULL, job_uid text,
    -- Frozen B4 execution inputs contain versioned references, never plaintext credentials.
    execution_spec jsonb NOT NULL, execution_hash text NOT NULL,
    stage text NOT NULL DEFAULT 'planned' CHECK(stage IN ('planned','creating','preparing','starting','observing','verifying','finished')),
    next_poll_at timestamptz NOT NULL DEFAULT now(),
    log_availability text NOT NULL DEFAULT 'unavailable' CHECK(log_availability IN ('runtime','archived','unavailable','expired')),
    lease_owner text, lease_expires_at timestamptz, revision bigint NOT NULL DEFAULT 1,
    started_at timestamptz, finished_at timestamptz, error_code text,
    cancel_requested_at timestamptz, cancel_requested_by uuid REFERENCES users(id),
    -- v19 runtime cleanup metadata; execution inputs and history remain immutable.
    next_cleanup_at timestamptz NOT NULL DEFAULT now(), cleanup_attempts integer NOT NULL DEFAULT 0 CHECK(cleanup_attempts>=0),
    cleanup_error_code text, resources_cleaned_at timestamptz,
    CHECK((cancel_requested_at IS NULL)=(cancel_requested_by IS NULL)),
    UNIQUE(build_id,attempt_no), UNIQUE(build_cluster_id,namespace,job_name), UNIQUE(id,build_id)
);
CREATE TABLE artifacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), app_id uuid NOT NULL REFERENCES applications(id),
    build_id uuid, attempt_id uuid,
    image_repository text NOT NULL, digest text NOT NULL CHECK(digest ~ '^sha256:[0-9a-f]{64}$'),
    source text NOT NULL CHECK(source IN ('build','external')),
    registry_id uuid REFERENCES registries(id), registry_credential_id uuid, registry_credential_version integer,
    imported_by uuid REFERENCES users(id),
    FOREIGN KEY(registry_credential_id,registry_credential_version) REFERENCES secret_versions(credential_id,version),
    CHECK((registry_credential_id IS NULL)=(registry_credential_version IS NULL)),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(build_id,app_id) REFERENCES builds(id,app_id),
    FOREIGN KEY(attempt_id,build_id) REFERENCES build_attempts(id,build_id),
    CHECK((source='build' AND build_id IS NOT NULL AND attempt_id IS NOT NULL AND registry_id IS NULL AND imported_by IS NULL AND registry_credential_id IS NULL AND registry_credential_version IS NULL) OR
          (source='external' AND build_id IS NULL AND attempt_id IS NULL AND registry_id IS NOT NULL AND imported_by IS NOT NULL)), UNIQUE(id,app_id)
);
CREATE TABLE deployment_previews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), app_id uuid NOT NULL REFERENCES applications(id),
    binding_id uuid NOT NULL, config_version integer NOT NULL, binding_version integer NOT NULL,
    snapshot jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users(id),
    expires_at timestamptz NOT NULL, consumed_at timestamptz,
    FOREIGN KEY(binding_id,app_id) REFERENCES app_environment_bindings(id,app_id),
    FOREIGN KEY(app_id,config_version) REFERENCES app_config_versions(app_id,version)
);
CREATE TABLE release_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), app_id uuid NOT NULL REFERENCES applications(id),
    binding_id uuid NOT NULL, artifact_id uuid NOT NULL, config_version integer NOT NULL,
    binding_version integer NOT NULL,
    chart_name text NOT NULL, chart_version text NOT NULL, chart_sha256 text NOT NULL,
    chart_storage_key text NOT NULL,
    values_redacted jsonb NOT NULL, secret_refs jsonb NOT NULL DEFAULT '[]',
    manifest_redacted text NOT NULL, manifest_sha256 text NOT NULL,
    -- Execution values contain no plaintext secrets; secret_refs resolve exact encrypted versions.
    execution_values jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(binding_id,app_id) REFERENCES app_environment_bindings(id,app_id),
    FOREIGN KEY(artifact_id,app_id) REFERENCES artifacts(id,app_id),
    FOREIGN KEY(app_id,config_version) REFERENCES app_config_versions(app_id,version)
);
CREATE TABLE release_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_id uuid NOT NULL REFERENCES release_snapshots(id),
    kind text NOT NULL CHECK(kind IN ('deploy','promote','rollback')),
    source_deployment_id uuid,
    reason text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','executing','succeeded','failed','unknown')),
    requested_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
    CHECK((kind='deploy')=(source_deployment_id IS NULL)),
    CHECK((kind='rollback' AND char_length(btrim(reason)) BETWEEN 1 AND 1000) OR (kind<>'rollback' AND reason=''))
);
CREATE TABLE deployments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL UNIQUE REFERENCES release_requests(id),
    target_id uuid NOT NULL REFERENCES deployment_targets(id),
    status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','submitting','observing','succeeded','failed','unknown')),
    helm_revision integer, fencing_token bigint,
    next_cleanup_at timestamptz NOT NULL DEFAULT now(), cleanup_attempts integer NOT NULL DEFAULT 0 CHECK(cleanup_attempts>=0),
    cleanup_error_code text, resources_cleaned_at timestamptz,
    lease_owner text, lease_expires_at timestamptz, revision bigint NOT NULL DEFAULT 1,
    started_at timestamptz, finished_at timestamptz, error_code text,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE release_requests ADD FOREIGN KEY(source_deployment_id) REFERENCES deployments(id);
ALTER TABLE deployment_targets ADD FOREIGN KEY(active_deployment_id) REFERENCES deployments(id);
ALTER TABLE app_environment_bindings ADD FOREIGN KEY(current_deployment_id) REFERENCES deployments(id);
CREATE TABLE deployment_resources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deployment_id uuid NOT NULL REFERENCES deployments(id),
    group_name text NOT NULL DEFAULT '', version text NOT NULL, resource text NOT NULL, kind text NOT NULL,
    namespace text NOT NULL DEFAULT '', name text NOT NULL, uid text NOT NULL, manifest_hash text NOT NULL,
    UNIQUE(deployment_id,group_name,resource,namespace,name)
);
CREATE TABLE resource_previews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cluster_id uuid NOT NULL REFERENCES clusters(id),
    requested_by uuid NOT NULL REFERENCES users(id),
    encrypted_documents bytea NOT NULL, key_id text NOT NULL,
    items_redacted jsonb NOT NULL CHECK(jsonb_typeof(items_redacted)='array'),
    expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(id,cluster_id,requested_by)
);
CREATE TABLE resource_operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cluster_id uuid NOT NULL REFERENCES clusters(id),
    requested_by uuid NOT NULL REFERENCES users(id),
    -- v13: only apply consumes a preview; actions freeze a direct resource reference.
    preview_id uuid UNIQUE REFERENCES resource_previews(id), kind text NOT NULL CHECK(kind IN ('apply','delete','restart','scale')),
    CHECK((kind='apply')=(preview_id IS NOT NULL)),
    status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','partial','unknown')),
    encrypted_payload bytea NOT NULL, key_id text NOT NULL,
    payload_redacted jsonb NOT NULL CHECK(jsonb_typeof(payload_redacted)='array'),
    result_redacted jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(result_redacted)='array'),
    stop_on_error boolean NOT NULL DEFAULT false,
    lease_owner text, lease_expires_at timestamptz, revision bigint NOT NULL DEFAULT 1, retry_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
    CHECK((lease_owner IS NULL)=(lease_expires_at IS NULL)),
    FOREIGN KEY(preview_id,cluster_id,requested_by) REFERENCES resource_previews(id,cluster_id,requested_by)
);
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
 provider text NOT NULL CHECK(provider IN ('github','gitea','gitlab','gitee')),
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
CREATE TABLE idempotency_records (
    user_id uuid NOT NULL REFERENCES users(id), operation_id text NOT NULL, key text NOT NULL,
    request_hash text NOT NULL, response_status integer, response_body jsonb,
    expires_at timestamptz NOT NULL, in_progress boolean NOT NULL DEFAULT true,
    PRIMARY KEY(user_id,operation_id,key)
);
CREATE TABLE exec_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
    cluster_id uuid NOT NULL REFERENCES clusters(id), namespace text NOT NULL,
    pod_name text NOT NULL, pod_uid text NOT NULL, container text NOT NULL,
    ticket_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
    consumed_at timestamptz, closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id),
    project_id uuid REFERENCES projects(id), cluster_id uuid REFERENCES clusters(id),
    action text NOT NULL, target jsonb NOT NULL, request_id text NOT NULL,
    result text NOT NULL CHECK(result IN ('accepted','succeeded','failed','denied','unknown')),
    diff_redacted jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pipeline_deploy_authorizations (
 pipeline_id uuid PRIMARY KEY REFERENCES pipelines(id) ON DELETE CASCADE,
 authorized_by uuid NOT NULL REFERENCES users(id),
 pipeline_version integer NOT NULL CHECK(pipeline_version>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auto_deploy_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 build_id uuid NOT NULL REFERENCES builds(id),
 pipeline_id uuid NOT NULL,
 binding_id uuid NOT NULL REFERENCES app_environment_bindings(id),
 authorized_by uuid NOT NULL REFERENCES users(id),
 config_version integer NOT NULL CHECK(config_version>0),
 workflow_version integer NOT NULL CHECK(workflow_version>0),
 pipeline_version integer NOT NULL CHECK(pipeline_version>0),
 ci_version integer NOT NULL CHECK(ci_version>0),
 binding_version integer NOT NULL CHECK(binding_version>0),
 status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','blocked','dispatched','skipped')),
 error_code text,
 request_id uuid UNIQUE REFERENCES release_requests(id),
 next_poll_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(build_id,pipeline_id),
 CHECK((status='dispatched')=(request_id IS NOT NULL))
);
CREATE INDEX auto_deploy_intents_pending ON auto_deploy_intents(next_poll_at,id) WHERE status IN ('waiting','blocked');

-- v17 persistent scheduling; observations remain a separate short-lived cache.
CREATE TABLE binding_health_polls (
 binding_id uuid PRIMARY KEY REFERENCES app_environment_bindings(id) ON DELETE CASCADE,
 next_poll_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_until timestamptz, started_at timestamptz,
 last_error_code text,
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE INDEX binding_health_polls_due ON binding_health_polls(next_poll_at,binding_id);

CREATE TABLE log_archives (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), build_attempt_id uuid REFERENCES build_attempts(id),
    deployment_id uuid REFERENCES deployments(id), storage_key text NOT NULL UNIQUE,
    byte_size bigint NOT NULL CHECK(byte_size>=0), sha256 text NOT NULL,
    expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    CHECK(num_nonnulls(build_attempt_id,deployment_id)=1)
);

CREATE INDEX builds_app_history ON builds(app_id,created_at DESC);
CREATE INDEX build_attempts_pending ON build_attempts(status,lease_expires_at)
    WHERE status IN ('queued','running','canceling','unknown');
CREATE INDEX release_requests_pending ON release_requests(status,created_at)
    WHERE status IN ('queued','executing','unknown');
CREATE INDEX deployments_pending ON deployments(status,lease_expires_at)
    WHERE status IN ('queued','submitting','observing','unknown');
CREATE INDEX resource_operations_pending ON resource_operations(status,lease_expires_at)
    WHERE status IN ('queued','running','unknown');
CREATE INDEX deployment_resources_uid ON deployment_resources(uid);
CREATE INDEX audit_events_project_time ON audit_events(project_id,created_at DESC);
CREATE INDEX audit_events_cluster_time ON audit_events(cluster_id,created_at DESC);
COMMIT;
