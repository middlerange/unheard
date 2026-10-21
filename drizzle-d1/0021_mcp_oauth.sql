CREATE TABLE `oauth_clients` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `redirect_uris` text NOT NULL,
  `client_uri` text,
  `logo_uri` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_authorization_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `request_token_hash` text NOT NULL,
  `client_id` text NOT NULL,
  `scope` text NOT NULL,
  `redirect_uri` text NOT NULL,
  `state` text,
  `code_challenge` text NOT NULL,
  `resource` text NOT NULL,
  `expires_at` integer NOT NULL,
  `consumed_at` integer,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_authorization_requests_token_unique` ON `oauth_authorization_requests` (`request_token_hash`);
--> statement-breakpoint
CREATE INDEX `oauth_authorization_requests_client_idx` ON `oauth_authorization_requests` (`client_id`);
--> statement-breakpoint
CREATE TABLE `oauth_authorization_codes` (
  `id` text PRIMARY KEY NOT NULL,
  `code_hash` text NOT NULL,
  `client_id` text NOT NULL,
  `user_id` text NOT NULL,
  `team_id` text NOT NULL,
  `scope` text NOT NULL,
  `redirect_uri` text NOT NULL,
  `code_challenge` text NOT NULL,
  `resource` text NOT NULL,
  `expires_at` integer NOT NULL,
  `consumed_at` integer,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_authorization_codes_code_unique` ON `oauth_authorization_codes` (`code_hash`);
--> statement-breakpoint
CREATE INDEX `oauth_authorization_codes_client_idx` ON `oauth_authorization_codes` (`client_id`);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
  `id` text PRIMARY KEY NOT NULL,
  `access_token_hash` text NOT NULL,
  `refresh_token_hash` text NOT NULL,
  `client_id` text NOT NULL,
  `user_id` text NOT NULL,
  `team_id` text NOT NULL,
  `scope` text NOT NULL,
  `resource` text NOT NULL,
  `access_expires_at` integer NOT NULL,
  `refresh_expires_at` integer NOT NULL,
  `last_used_at` integer,
  `revoked_at` integer,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_tokens_access_unique` ON `oauth_tokens` (`access_token_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_tokens_refresh_unique` ON `oauth_tokens` (`refresh_token_hash`);
--> statement-breakpoint
CREATE INDEX `oauth_tokens_team_idx` ON `oauth_tokens` (`team_id`);
--> statement-breakpoint
CREATE INDEX `oauth_tokens_client_idx` ON `oauth_tokens` (`client_id`);

