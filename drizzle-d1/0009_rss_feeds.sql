-- RSS Feed Auto-Posting Tables (Issue #7)

CREATE TABLE IF NOT EXISTS "rss_feeds" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"feed_type" text NOT NULL DEFAULT 'rss',
	"status" text NOT NULL DEFAULT 'active',
	"last_fetched_at" integer,
	"last_item_hash" text,
	"fetch_frequency" text NOT NULL DEFAULT '1h',
	"post_template" text NOT NULL DEFAULT '{{title}} {{link}}',
	"target_platforms" text NOT NULL DEFAULT '[]',
	"target_channels" text NOT NULL DEFAULT '[]',
	"filter_keywords" text DEFAULT '',
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "rss_feeds_team_id_idx" ON "rss_feeds" ("team_id");

CREATE TABLE IF NOT EXISTS "rss_feed_items" (
	"id" text PRIMARY KEY NOT NULL,
	"feed_id" text NOT NULL REFERENCES "rss_feeds"("id") ON DELETE cascade,
	"item_hash" text NOT NULL,
	"title" text NOT NULL,
	"link" text NOT NULL,
	"description" text,
	"published_at" integer,
	"processed_at" integer,
	"post_id" text REFERENCES "posts"("id") ON DELETE set null,
	"status" text NOT NULL DEFAULT 'pending',
	"error_message" text
);

CREATE INDEX IF NOT EXISTS "rss_feed_items_feed_id_idx" ON "rss_feed_items" ("feed_id");
CREATE INDEX IF NOT EXISTS "rss_feed_items_hash_idx" ON "rss_feed_items" ("item_hash");
