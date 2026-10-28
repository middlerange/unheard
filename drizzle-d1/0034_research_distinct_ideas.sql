-- Remove the table-level one-item constraint without cascading away existing reviews.
CREATE TABLE research_idea_migration_revisions AS SELECT * FROM research_draft_revisions;
CREATE TABLE research_idea_migration_drafts AS SELECT * FROM research_drafts;
CREATE TABLE research_idea_migration_findings AS SELECT * FROM research_findings;
DROP TABLE research_draft_revisions;
DROP TABLE research_drafts;
DROP TABLE research_findings;

CREATE TABLE research_findings (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
  published_at INTEGER NOT NULL, score INTEGER NOT NULL,
  summary TEXT NOT NULL, why_it_matters TEXT NOT NULL, content_angle TEXT NOT NULL,
  evidence TEXT NOT NULL, limitations TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', idea_id TEXT,
  created_at INTEGER NOT NULL, family_key TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'article', transcript_status TEXT NOT NULL DEFAULT 'not_applicable',
  source_published_at INTEGER, source_discovered_at INTEGER, signal_kind TEXT,
  UNIQUE(team_id, item_id, family_key), UNIQUE(team_id, family_key)
);
INSERT INTO research_findings SELECT * FROM research_idea_migration_findings;
CREATE INDEX research_findings_team ON research_findings(team_id, score);

CREATE TABLE research_drafts (
  id TEXT PRIMARY KEY NOT NULL, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL REFERENCES research_findings(id) ON DELETE CASCADE,
  post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  content TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'draft',
  slack_channel_id TEXT, slack_thread_ts TEXT, slack_message_ts TEXT, snapshot_hash TEXT, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  is_test INTEGER NOT NULL DEFAULT 0
);
INSERT INTO research_drafts SELECT * FROM research_idea_migration_drafts;
CREATE UNIQUE INDEX research_drafts_finding ON research_drafts(team_id, finding_id);
CREATE INDEX research_drafts_team_status ON research_drafts(team_id, status, created_at);
CREATE TRIGGER research_drafts_test_marker_immutable
BEFORE UPDATE OF is_test ON research_drafts
WHEN NEW.is_test <> OLD.is_test
BEGIN
  SELECT RAISE(ABORT, 'Test review marker cannot be changed');
END;

CREATE TABLE research_draft_revisions (
  id TEXT PRIMARY KEY NOT NULL, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES research_drafts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, content TEXT NOT NULL, instruction TEXT, slack_user_id TEXT,
  created_at INTEGER NOT NULL
);
INSERT INTO research_draft_revisions SELECT * FROM research_idea_migration_revisions;
CREATE UNIQUE INDEX research_draft_revision_number ON research_draft_revisions(draft_id, revision);

DROP TABLE research_idea_migration_revisions;
DROP TABLE research_idea_migration_drafts;
DROP TABLE research_idea_migration_findings;
