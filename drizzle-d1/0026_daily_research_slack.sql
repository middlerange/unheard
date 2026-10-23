ALTER TABLE research_runs ADD COLUMN editorial INTEGER NOT NULL DEFAULT 0;
CREATE TABLE slack_integrations (
  team_id TEXT PRIMARY KEY NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL, channel_id TEXT NOT NULL,
  approver_user_ids TEXT NOT NULL DEFAULT '[]', credentials TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX slack_integrations_workspace ON slack_integrations(workspace_id);
CREATE TABLE research_drafts (
  id TEXT PRIMARY KEY NOT NULL, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL REFERENCES research_findings(id) ON DELETE CASCADE,
  post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  content TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'draft',
  slack_channel_id TEXT, slack_thread_ts TEXT, slack_message_ts TEXT, snapshot_hash TEXT, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX research_drafts_finding ON research_drafts(team_id, finding_id);
CREATE INDEX research_drafts_team_status ON research_drafts(team_id, status, created_at);
CREATE TABLE research_draft_revisions (
  id TEXT PRIMARY KEY NOT NULL, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES research_drafts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, content TEXT NOT NULL, instruction TEXT, slack_user_id TEXT, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX research_draft_revision_number ON research_draft_revisions(draft_id, revision);
CREATE TABLE slack_jobs (
  id TEXT PRIMARY KEY NOT NULL, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT
);
CREATE INDEX slack_jobs_pending ON slack_jobs(status, created_at);
DROP INDEX research_runs_active_team;
CREATE UNIQUE INDEX research_runs_active_team ON research_runs(team_id) WHERE status IN ('queued','collecting','ranking','drafting');
ALTER TABLE channels ADD COLUMN system_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN research_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE post_targets ADD COLUMN publication_progress TEXT;
CREATE TABLE slack_oauth_states (
  id TEXT PRIMARY KEY NOT NULL, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, consumed_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX slack_oauth_states_expiry ON slack_oauth_states(expires_at);
