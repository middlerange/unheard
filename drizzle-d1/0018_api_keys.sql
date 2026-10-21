CREATE TABLE `api_keys` (
  `id` text PRIMARY KEY NOT NULL,
  `team_id` text NOT NULL,
  `created_by` text NOT NULL,
  `name` text NOT NULL,
  `key_hash` text NOT NULL,
  `key_prefix` text NOT NULL,
  `last_used_at` integer,
  `revoked_at` integer,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);
--> statement-breakpoint
CREATE INDEX `api_keys_team_id_idx` ON `api_keys` (`team_id`);
