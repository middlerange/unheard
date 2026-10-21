ALTER TABLE "ideas" ADD COLUMN "text" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ideas" DROP COLUMN "title";
--> statement-breakpoint
ALTER TABLE "ideas" DROP COLUMN "notes";
--> statement-breakpoint
ALTER TABLE "ideas" DROP COLUMN "tags";
