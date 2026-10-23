CREATE TABLE research_usage (
 id TEXT PRIMARY KEY NOT NULL,
 team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
 stage TEXT NOT NULL CHECK(stage IN ('research','draft_generation','slack_revision','legacy')), operation TEXT NOT NULL, model TEXT NOT NULL,
 service_tier TEXT NOT NULL DEFAULT 'default', response_id TEXT,
 status TEXT NOT NULL DEFAULT 'pending',
 input_tokens INTEGER, output_tokens INTEGER,
 cached_input_tokens INTEGER, cache_write_tokens INTEGER,
 cost_nano_usd INTEGER, cost_status TEXT NOT NULL DEFAULT 'unknown', rate_card TEXT,
 created_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE INDEX research_usage_team_time ON research_usage(team_id, created_at);
CREATE INDEX research_usage_run ON research_usage(team_id, run_id);

INSERT INTO research_usage (
 id, team_id, run_id, stage, operation, model, status,
 input_tokens, output_tokens, cost_nano_usd, cost_status, rate_card, created_at, completed_at
)
SELECT 'legacy-' || id, team_id, id, 'legacy', 'historical-total', 'gpt-6-luna', 'completed',
 input_tokens, output_tokens, input_tokens * 125 + output_tokens * 500, 'historical',
 '{"asOf":"2026-10-23","input":0.1,"output":0.5,"cachedInput":0.01,"write30m":0.125,"write12h":0.25,"basis":"all input at default cache-write rate; stage and cache details unavailable"}',
 created_at, completed_at
FROM research_runs WHERE input_tokens > 0 OR output_tokens > 0;
