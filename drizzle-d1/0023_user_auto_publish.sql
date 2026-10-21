-- ABOUTME: Stores each user’s scheduled publishing preference.
-- ABOUTME: Existing and future users require approval unless explicitly enabled.

ALTER TABLE `users` ADD COLUMN `auto_publish` integer NOT NULL DEFAULT false;
