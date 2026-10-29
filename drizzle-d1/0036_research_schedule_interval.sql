ALTER TABLE research_settings ADD COLUMN daily_interval_hours INTEGER NOT NULL DEFAULT 24 CHECK (daily_interval_hours IN (12, 24));
