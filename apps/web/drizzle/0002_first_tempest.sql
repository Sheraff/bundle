CREATE TABLE `github_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`github_account_id` integer NOT NULL,
	`login` text NOT NULL,
	`account_type` text NOT NULL,
	`avatar_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_accounts_github_account_id_unique` ON `github_accounts` (`github_account_id`);--> statement-breakpoint
CREATE TABLE `github_app_installations` (
	`id` text PRIMARY KEY NOT NULL,
	`installation_id` integer NOT NULL,
	`account_id` text NOT NULL,
	`target_type` text NOT NULL,
	`permissions_json` text NOT NULL,
	`suspended_at` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `github_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_app_installations_installation_id_unique` ON `github_app_installations` (`installation_id`);--> statement-breakpoint
CREATE INDEX `github_app_installations_account_id_idx` ON `github_app_installations` (`account_id`);--> statement-breakpoint
CREATE TABLE `github_installation_repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`installation_id` integer NOT NULL,
	`github_repo_id` integer NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`private` integer NOT NULL,
	`access_status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_installation_repositories_installation_repo_unique` ON `github_installation_repositories` (`installation_id`,`github_repo_id`);--> statement-breakpoint
CREATE INDEX `github_installation_repositories_github_repo_id_idx` ON `github_installation_repositories` (`github_repo_id`);--> statement-breakpoint
CREATE INDEX `github_installation_repositories_owner_name_idx` ON `github_installation_repositories` (`owner`,`name`);--> statement-breakpoint
CREATE TABLE `github_user_tokens` (
	`user_id` text PRIMARY KEY NOT NULL,
	`encrypted_access_token` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`github_user_id` integer NOT NULL,
	`login` text NOT NULL,
	`avatar_url` text,
	`name` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_github_user_id_unique` ON `users` (`github_user_id`);--> statement-breakpoint
ALTER TABLE `repositories` ADD `account_id` text REFERENCES github_accounts(id);--> statement-breakpoint
ALTER TABLE `repositories` ADD `enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `visibility` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `disabled_at` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `deleted_at` text;