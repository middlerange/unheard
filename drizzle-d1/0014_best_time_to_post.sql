-- AI Best Time to Post (Issue #12)

CREATE TABLE IF NOT EXISTS "best_time_predictions" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
	"platform" text NOT NULL,
	"channel_id" text REFERENCES "channels"("id") ON DELETE cascade,
	"day_of_week" integer NOT NULL,
	"hour_of_day" integer NOT NULL,
	"score" integer NOT NULL,
	"confidence" integer NOT NULL,
	"calculated_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "best_time_predictions_team_id_idx" ON "best_time_predictions" ("team_id");
CREATE INDEX IF NOT EXISTS "best_time_predictions_platform_idx" ON "best_time_predictions" ("platform");

CREATE TABLE IF NOT EXISTS "posting_time_analytics" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
	"platform" text NOT NULL,
	"post_id" text NOT NULL REFERENCES "posts"("id") ON DELETE cascade,
	"scheduled_hour" integer NOT NULL,
	"day_of_week" integer NOT NULL,
	"engagement_rate" integer,
	"created_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "posting_time_analytics_team_id_idx" ON "posting_time_analytics" ("team_id");
CREATE INDEX IF NOT EXISTS "posting_time_analytics_post_id_idx" ON "posting_time_analytics" ("post_id");
