BEGIN;
DROP TABLE idempotency_records, audit_events, project_members, projects, team_members, teams, users;
COMMIT;
