-- Bring channels in line with the current app schema used by channel connect flows.
-- The old table used `owner_type`; the current app uses `account_type` and `account_id`.

ALTER TABLE `channels` ADD COLUMN `account_type` text NOT NULL DEFAULT 'personal';
--> statement-breakpoint
ALTER TABLE `channels` ADD COLUMN `account_id` text;
--> statement-breakpoint
UPDATE `channels`
SET `account_type` = CASE
  WHEN `owner_type` = 'company' THEN 'company'
  WHEN `owner_type` = 'page' THEN 'page'
  ELSE 'personal'
END
;
