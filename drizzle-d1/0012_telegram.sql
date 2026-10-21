-- Telegram Platform Support (Issue #10)

CREATE TABLE IF NOT EXISTS "telegram_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
	"channel_id" text NOT NULL,
	"name" text NOT NULL,
	"bot_token" text NOT NULL,
	"thread_id" text,
	"created_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "telegram_channels_team_id_idx" ON "telegram_channels" ("team_id");
