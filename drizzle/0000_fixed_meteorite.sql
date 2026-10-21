CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"filename" text NOT NULL,
	"path" text NOT NULL,
	"type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"platform" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"platform_post_id" text,
	"error" text,
	"reply_settings" text DEFAULT 'everyone',
	"as_carousel" boolean DEFAULT false,
	"carousel_name" text
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"publish_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;