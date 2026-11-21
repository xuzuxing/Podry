BEGIN;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND length(email) <= 254),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    password_hash text NOT NULL,
    is_super_admin boolean NOT NULL DEFAULT false,
    token_version bigint NOT NULL DEFAULT 1 CHECK (token_version > 0),
    disabled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE team_members (
    team_id uuid NOT NULL REFERENCES teams(id), user_id uuid NOT NULL REFERENCES users(id),
    role text NOT NULL CHECK (role IN ('admin','developer','operator','viewer')),
    PRIMARY KEY (team_id,user_id)
);
CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams(id),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(team_id,name), UNIQUE(id,team_id)
);
CREATE TABLE project_members (
    project_id uuid NOT NULL, team_id uuid NOT NULL, user_id uuid NOT NULL,
    role text NOT NULL CHECK (role IN ('admin','developer','operator','viewer')),
    PRIMARY KEY(project_id,user_id),
    FOREIGN KEY(project_id,team_id) REFERENCES projects(id,team_id),
    FOREIGN KEY(team_id,user_id) REFERENCES team_members(team_id,user_id) ON DELETE CASCADE
);
CREATE TABLE audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id),
    team_id uuid REFERENCES teams(id), project_id uuid REFERENCES projects(id), cluster_id uuid,
    action text NOT NULL, target jsonb NOT NULL, request_id text NOT NULL,
    result text NOT NULL CHECK(result IN ('accepted','succeeded','failed','denied','unknown')),
    diff_redacted jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE idempotency_records (
    user_id uuid NOT NULL REFERENCES users(id), operation_id text NOT NULL, key text NOT NULL,
    request_hash text NOT NULL, response_status integer, response_body jsonb,
    expires_at timestamptz NOT NULL, in_progress boolean NOT NULL DEFAULT true,
    PRIMARY KEY(user_id,operation_id,key),
    CHECK (length(key) BETWEEN 8 AND 200),
    CHECK (in_progress OR (response_status BETWEEN 200 AND 299 AND response_body IS NOT NULL))
);
CREATE INDEX team_members_user ON team_members(user_id,team_id);
CREATE INDEX project_members_user ON project_members(user_id,project_id);
CREATE INDEX audit_events_project_time ON audit_events(project_id,created_at DESC,id DESC);
CREATE INDEX audit_events_team_time ON audit_events(team_id,created_at DESC,id DESC);
CREATE INDEX audit_events_cluster_time ON audit_events(cluster_id,created_at DESC,id DESC);

COMMIT;
