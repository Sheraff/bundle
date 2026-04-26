CREATE TABLE `accepted_policy_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`policy_result_id` text,
	`comparison_id` text,
	`actor_login` text NOT NULL,
	`reason` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`policy_id`) REFERENCES `policies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`policy_result_id`) REFERENCES `policy_results`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`comparison_id`) REFERENCES `comparisons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `accepted_policy_decisions_repository_id_idx` ON `accepted_policy_decisions` (`repository_id`);--> statement-breakpoint
CREATE INDEX `accepted_policy_decisions_policy_id_idx` ON `accepted_policy_decisions` (`policy_id`);--> statement-breakpoint
CREATE INDEX `accepted_policy_decisions_comparison_id_idx` ON `accepted_policy_decisions` (`comparison_id`);--> statement-breakpoint
CREATE TABLE `policies` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`name` text NOT NULL,
	`environment` text,
	`entrypoint_key` text,
	`lens` text,
	`size_metric` text NOT NULL,
	`operator` text NOT NULL,
	`threshold_bytes` integer NOT NULL,
	`severity` text NOT NULL,
	`blocking` integer NOT NULL,
	`enabled` integer NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scenario_id`) REFERENCES `scenarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `policies_repository_id_idx` ON `policies` (`repository_id`);--> statement-breakpoint
CREATE INDEX `policies_scenario_id_idx` ON `policies` (`scenario_id`);--> statement-breakpoint
CREATE TABLE `policy_results` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`comparison_id` text NOT NULL,
	`series_id` text NOT NULL,
	`actual_value` integer,
	`threshold_bytes` integer NOT NULL,
	`result` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`evaluated_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`policy_id`) REFERENCES `policies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`comparison_id`) REFERENCES `comparisons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `policy_results_policy_comparison_unique` ON `policy_results` (`policy_id`,`comparison_id`);--> statement-breakpoint
CREATE INDEX `policy_results_repository_id_idx` ON `policy_results` (`repository_id`);--> statement-breakpoint
CREATE INDEX `policy_results_comparison_id_idx` ON `policy_results` (`comparison_id`);--> statement-breakpoint
CREATE INDEX `policy_results_policy_id_idx` ON `policy_results` (`policy_id`);