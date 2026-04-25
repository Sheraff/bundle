CREATE TABLE `hosted_synthetic_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`scenario_slug` text NOT NULL,
	`display_name` text NOT NULL,
	`source_text` text NOT NULL,
	`budget_raw_bytes` integer,
	`budget_gzip_bytes` integer,
	`budget_brotli_bytes` integer,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX `hosted_synthetic_scenarios_repository_slug_unique` ON `hosted_synthetic_scenarios` (`repository_id`,`scenario_slug`);
CREATE INDEX `hosted_synthetic_scenarios_repository_id_idx` ON `hosted_synthetic_scenarios` (`repository_id`);
