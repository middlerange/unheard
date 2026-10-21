CREATE TABLE "idea_conversations" (
	"idea_id" text PRIMARY KEY NOT NULL,
	"messages" text DEFAULT '[]' NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idea_conversations" ADD CONSTRAINT "idea_conversations_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE cascade ON UPDATE no action;
