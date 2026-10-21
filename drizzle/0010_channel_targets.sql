ALTER TABLE "channels" ADD COLUMN "owner_type" text NOT NULL DEFAULT 'person';
ALTER TABLE "channels" ADD COLUMN "is_default" boolean NOT NULL DEFAULT false;
ALTER TABLE "post_targets" ADD COLUMN "channel_id" text REFERENCES "channels"("id") ON DELETE SET NULL;

UPDATE "channels"
SET "owner_type" = CASE WHEN "group_name" = 'company' THEN 'company' ELSE 'person' END;

WITH ranked_channels AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "platform" ORDER BY "created_at" ASC, "id" ASC) AS row_num
  FROM "channels"
)
UPDATE "channels"
SET "is_default" = ranked_channels.row_num = 1
FROM ranked_channels
WHERE ranked_channels."id" = "channels"."id";

UPDATE "post_targets"
SET "channel_id" = "channels"."id"
FROM "posts", "channels"
WHERE "post_targets"."post_id" = "posts"."id"
  AND "post_targets"."platform" = "channels"."platform"
  AND "channels"."group_name" = COALESCE("posts"."channel_group", 'personal')
  AND "post_targets"."channel_id" IS NULL;
