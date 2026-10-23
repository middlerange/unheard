ALTER TABLE research_settings ADD COLUMN daily_time TEXT;
ALTER TABLE research_settings ADD COLUMN daily_timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE research_settings ADD COLUMN next_daily_at INTEGER;
ALTER TABLE research_settings ADD COLUMN daily_claim_id TEXT;
ALTER TABLE research_settings ADD COLUMN daily_claim_until INTEGER;
ALTER TABLE research_settings ADD COLUMN daily_pending_run_id TEXT;
