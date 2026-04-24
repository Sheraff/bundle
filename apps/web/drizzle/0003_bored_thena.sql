ALTER TABLE `github_user_tokens` ADD `encrypted_refresh_token` text;--> statement-breakpoint
ALTER TABLE `github_user_tokens` ADD `access_token_expires_at` text;--> statement-breakpoint
ALTER TABLE `github_user_tokens` ADD `refresh_token_expires_at` text;