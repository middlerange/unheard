ALTER TABLE "posts" ADD COLUMN "template_id" text REFERENCES "templates"("id") ON DELETE SET NULL;
ALTER TABLE "posts" ADD COLUMN "writing_prompt" text;
