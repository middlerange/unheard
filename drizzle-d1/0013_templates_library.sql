-- Post Templates Library (Issue #11)

CREATE TABLE IF NOT EXISTS "post_templates_library" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"content_template" text NOT NULL,
	"platform_variants" text DEFAULT '{}',
	"ai_prompt" text,
	"is_favorite" integer NOT NULL DEFAULT 0,
	"usage_count" integer NOT NULL DEFAULT 0,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "post_templates_library_team_id_idx" ON "post_templates_library" ("team_id");
CREATE INDEX IF NOT EXISTS "post_templates_library_category_idx" ON "post_templates_library" ("category");
