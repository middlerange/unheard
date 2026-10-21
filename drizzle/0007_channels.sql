CREATE TABLE "channels" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "platform" text NOT NULL,
  "group_name" text NOT NULL,
  "credentials" text DEFAULT '{}' NOT NULL,
  "created_at" bigint NOT NULL
);
ALTER TABLE "posts" ADD COLUMN "channel_group" text NOT NULL DEFAULT 'personal';
