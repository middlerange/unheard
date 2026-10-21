-- Webhook Integration Tables (Issue #8)

CREATE TABLE IF NOT EXISTS "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text NOT NULL DEFAULT '[]',
	"status" text NOT NULL DEFAULT 'active',
	"headers" text DEFAULT '{}',
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "webhooks_team_id_idx" ON "webhooks" ("team_id");

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL REFERENCES "webhooks"("id") ON DELETE cascade,
	"event_type" text NOT NULL,
	"payload" text NOT NULL,
	"signature" text NOT NULL,
	"status" text NOT NULL DEFAULT 'pending',
	"response_status" integer,
	"response_body" text,
	"attempt_count" integer NOT NULL DEFAULT 0,
	"next_retry_at" integer,
	"delivered_at" integer,
	"created_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_id_idx" ON "webhook_deliveries" ("webhook_id");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_idx" ON "webhook_deliveries" ("status");
