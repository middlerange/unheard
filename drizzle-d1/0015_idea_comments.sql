-- Idea Comments/Variations (collaborative idea refinement)

CREATE TABLE IF NOT EXISTS "idea_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"idea_id" text NOT NULL REFERENCES "ideas"("id") ON DELETE cascade,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"content" text NOT NULL,
	"suggested_text" text,
	"is_applied" integer DEFAULT false NOT NULL,
	"applied_at" integer,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "idea_comments_idea_id_idx" ON "idea_comments" ("idea_id");
CREATE INDEX IF NOT EXISTS "idea_comments_user_id_idx" ON "idea_comments" ("user_id");
