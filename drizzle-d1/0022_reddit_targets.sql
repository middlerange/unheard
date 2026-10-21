-- Persist the destination and submission settings required for reliable Reddit publishing.

ALTER TABLE `post_targets` ADD COLUMN `reddit_title` text;
--> statement-breakpoint
ALTER TABLE `post_targets` ADD COLUMN `subreddit` text;
--> statement-breakpoint
ALTER TABLE `post_targets` ADD COLUMN `reddit_post_type` text;
--> statement-breakpoint
ALTER TABLE `post_targets` ADD COLUMN `reddit_url` text;
--> statement-breakpoint
ALTER TABLE `post_targets` ADD COLUMN `flair_id` text;
--> statement-breakpoint
ALTER TABLE `post_targets` ADD COLUMN `nsfw` integer DEFAULT false;
--> statement-breakpoint
ALTER TABLE `post_targets` ADD COLUMN `spoiler` integer DEFAULT false;
