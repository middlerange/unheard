ALTER TABLE `post_approvals` ADD COLUMN `snapshot_hash` text;
ALTER TABLE `post_approvals` ADD COLUMN `snapshot_json` text;
ALTER TABLE `post_approvals` ADD COLUMN `callback_token` text;
ALTER TABLE `post_approvals` ADD COLUMN `telegram_message_id` integer;
ALTER TABLE `post_approvals` ADD COLUMN `telegram_user_id` text;
ALTER TABLE `post_approvals` ADD COLUMN `decision_source` text;
ALTER TABLE `post_approvals` ADD COLUMN `sent_at` integer;

CREATE INDEX IF NOT EXISTS `post_approvals_status_idx`
  ON `post_approvals` (`status`, `sent_at`);
