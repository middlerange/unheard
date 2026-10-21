-- Team Collaboration Tables (Issue #9)

CREATE TABLE IF NOT EXISTS "post_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL REFERENCES "posts"("id") ON DELETE cascade,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"content" text NOT NULL,
	"mentions" text DEFAULT '[]',
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "post_comments_post_id_idx" ON "post_comments" ("post_id");
CREATE INDEX IF NOT EXISTS "post_comments_user_id_idx" ON "post_comments" ("user_id");

CREATE TABLE IF NOT EXISTS "post_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL REFERENCES "posts"("id") ON DELETE cascade,
	"requested_by" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"reviewed_by" text REFERENCES "users"("id") ON DELETE set null,
	"status" text NOT NULL DEFAULT 'pending',
	"notes" text,
	"requested_at" integer NOT NULL,
	"reviewed_at" integer
);

CREATE INDEX IF NOT EXISTS "post_approvals_post_id_idx" ON "post_approvals" ("post_id");

CREATE TABLE IF NOT EXISTS "team_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
	"email" text NOT NULL,
	"role" text NOT NULL DEFAULT 'editor',
	"invited_by" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"token" text NOT NULL UNIQUE,
	"expires_at" integer NOT NULL,
	"accepted_at" integer,
	"created_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "team_invites_team_id_idx" ON "team_invites" ("team_id");
CREATE INDEX IF NOT EXISTS "team_invites_token_idx" ON "team_invites" ("token");
