CREATE TABLE research_settings (
 team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
 icp TEXT NOT NULL, daily_enabled INTEGER NOT NULL DEFAULT 0, last_daily_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE research_sources (
 id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, seed_id TEXT NOT NULL,
 enabled INTEGER NOT NULL, last_collected_at INTEGER, last_error TEXT, item_count INTEGER NOT NULL DEFAULT 0,
 UNIQUE(team_id, seed_id)
);
CREATE TABLE research_runs (
 id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, mode TEXT NOT NULL,
 status TEXT NOT NULL, days INTEGER NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER,
 source_count INTEGER NOT NULL DEFAULT 0, collected_count INTEGER NOT NULL DEFAULT 0, findings_count INTEGER NOT NULL DEFAULT 0,
 input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_hits INTEGER NOT NULL DEFAULT 0,
 error TEXT, icp TEXT NOT NULL, source_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX research_runs_active_team ON research_runs(team_id) WHERE status IN ('queued','collecting','ranking');
CREATE TABLE research_run_sources (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', item_count INTEGER NOT NULL DEFAULT 0, error TEXT,
 UNIQUE(run_id,source_id)
);
CREATE TABLE research_items (
 id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, source_id TEXT NOT NULL,
 canonical_url TEXT NOT NULL, title TEXT NOT NULL, excerpt TEXT NOT NULL, published_at INTEGER,
 content TEXT, content_hash TEXT, collected_at INTEGER NOT NULL, content_type TEXT NOT NULL DEFAULT 'article',
 transcript_status TEXT NOT NULL DEFAULT 'not_applicable', UNIQUE(team_id,canonical_url)
);
CREATE INDEX research_items_team_date ON research_items(team_id,published_at);
CREATE TABLE research_cache (
 id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, value TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE research_findings (
 id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, published_at INTEGER NOT NULL,
 score INTEGER NOT NULL, summary TEXT NOT NULL, why_it_matters TEXT NOT NULL, content_angle TEXT NOT NULL,
 evidence TEXT NOT NULL, limitations TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', idea_id TEXT,
 created_at INTEGER NOT NULL, family_key TEXT NOT NULL, content_type TEXT NOT NULL DEFAULT 'article', transcript_status TEXT NOT NULL DEFAULT 'not_applicable',
 UNIQUE(team_id,item_id), UNIQUE(team_id,family_key)
);
CREATE INDEX research_findings_team ON research_findings(team_id,score);
