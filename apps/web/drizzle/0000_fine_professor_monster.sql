CREATE TABLE `acknowledgements` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`pull_request_id` text NOT NULL,
	`comparison_id` text NOT NULL,
	`series_id` text NOT NULL,
	`item_key` text NOT NULL,
	`actor_github_user_id` integer,
	`actor_login` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`comparison_id`) REFERENCES `comparisons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acknowledgements_pull_request_id_comparison_id_item_key_unique` ON `acknowledgements` (`pull_request_id`,`comparison_id`,`item_key`);--> statement-breakpoint
CREATE INDEX `acknowledgements_repository_id_idx` ON `acknowledgements` (`repository_id`);--> statement-breakpoint
CREATE INDEX `acknowledgements_pull_request_id_idx` ON `acknowledgements` (`pull_request_id`);--> statement-breakpoint
CREATE INDEX `acknowledgements_comparison_id_idx` ON `acknowledgements` (`comparison_id`);--> statement-breakpoint
CREATE TABLE `budget_results` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`comparison_id` text NOT NULL,
	`series_id` text NOT NULL,
	`item_key` text NOT NULL,
	`metric_key` text NOT NULL,
	`status` text NOT NULL,
	`blocking` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`comparison_id`) REFERENCES `comparisons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_results_comparison_id_item_key_unique` ON `budget_results` (`comparison_id`,`item_key`);--> statement-breakpoint
CREATE INDEX `budget_results_repository_id_idx` ON `budget_results` (`repository_id`);--> statement-breakpoint
CREATE INDEX `budget_results_series_id_idx` ON `budget_results` (`series_id`);--> statement-breakpoint
CREATE INDEX `budget_results_comparison_id_idx` ON `budget_results` (`comparison_id`);--> statement-breakpoint
CREATE TABLE `commit_group_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`commit_group_id` text NOT NULL,
	`pull_request_id` text,
	`commit_sha` text NOT NULL,
	`branch` text NOT NULL,
	`status` text NOT NULL,
	`latest_upload_at` text NOT NULL,
	`quiet_window_deadline` text NOT NULL,
	`settled_at` text,
	`expected_scenario_count` integer NOT NULL,
	`fresh_scenario_count` integer NOT NULL,
	`pending_scenario_count` integer NOT NULL,
	`inherited_scenario_count` integer NOT NULL,
	`missing_scenario_count` integer NOT NULL,
	`failed_scenario_count` integer NOT NULL,
	`impacted_scenario_count` integer NOT NULL,
	`unchanged_scenario_count` integer NOT NULL,
	`comparison_count` integer NOT NULL,
	`changed_metric_count` integer NOT NULL,
	`no_baseline_series_count` integer NOT NULL,
	`failed_comparison_count` integer NOT NULL,
	`degraded_comparison_count` integer NOT NULL,
	`summary_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commit_group_id`) REFERENCES `commit_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commit_group_summaries_commit_group_id_unique` ON `commit_group_summaries` (`commit_group_id`);--> statement-breakpoint
CREATE INDEX `commit_group_summaries_repository_id_idx` ON `commit_group_summaries` (`repository_id`);--> statement-breakpoint
CREATE INDEX `commit_group_summaries_pull_request_id_idx` ON `commit_group_summaries` (`pull_request_id`);--> statement-breakpoint
CREATE INDEX `commit_group_summaries_status_idx` ON `commit_group_summaries` (`status`);--> statement-breakpoint
CREATE TABLE `commit_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`pull_request_id` text,
	`commit_sha` text NOT NULL,
	`branch` text NOT NULL,
	`status` text NOT NULL,
	`latest_upload_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commit_groups_repository_id_commit_sha_unique` ON `commit_groups` (`repository_id`,`commit_sha`);--> statement-breakpoint
CREATE INDEX `commit_groups_pull_request_id_idx` ON `commit_groups` (`pull_request_id`);--> statement-breakpoint
CREATE TABLE `comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`series_id` text NOT NULL,
	`head_scenario_run_id` text NOT NULL,
	`base_scenario_run_id` text,
	`head_commit_group_id` text NOT NULL,
	`base_commit_group_id` text,
	`pull_request_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`requested_base_sha` text,
	`requested_head_sha` text NOT NULL,
	`selected_base_commit_sha` text,
	`selected_head_commit_sha` text NOT NULL,
	`current_total_raw_bytes` integer NOT NULL,
	`current_total_gzip_bytes` integer NOT NULL,
	`current_total_brotli_bytes` integer NOT NULL,
	`baseline_total_raw_bytes` integer,
	`baseline_total_gzip_bytes` integer,
	`baseline_total_brotli_bytes` integer,
	`delta_total_raw_bytes` integer,
	`delta_total_gzip_bytes` integer,
	`delta_total_brotli_bytes` integer,
	`selected_entrypoint_relation` text,
	`selected_entrypoint_confidence` text,
	`selected_entrypoint_evidence_json` text,
	`stable_identity_summary_json` text,
	`has_degraded_stable_identity` integer NOT NULL,
	`budget_state` text NOT NULL,
	`failure_code` text,
	`failure_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`head_scenario_run_id`) REFERENCES `scenario_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_scenario_run_id`) REFERENCES `scenario_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`head_commit_group_id`) REFERENCES `commit_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_commit_group_id`) REFERENCES `commit_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comparisons_kind_series_id_head_scenario_run_id_unique` ON `comparisons` (`kind`,`series_id`,`head_scenario_run_id`);--> statement-breakpoint
CREATE INDEX `comparisons_repository_id_idx` ON `comparisons` (`repository_id`);--> statement-breakpoint
CREATE INDEX `comparisons_series_id_idx` ON `comparisons` (`series_id`);--> statement-breakpoint
CREATE INDEX `comparisons_pull_request_id_idx` ON `comparisons` (`pull_request_id`);--> statement-breakpoint
CREATE INDEX `comparisons_head_scenario_run_id_idx` ON `comparisons` (`head_scenario_run_id`);--> statement-breakpoint
CREATE INDEX `comparisons_base_scenario_run_id_idx` ON `comparisons` (`base_scenario_run_id`);--> statement-breakpoint
CREATE TABLE `github_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`pull_request_id` text NOT NULL,
	`commit_group_id` text,
	`surface` text NOT NULL,
	`status` text NOT NULL,
	`external_publication_id` text,
	`external_publication_node_id` text,
	`external_url` text,
	`published_head_sha` text,
	`payload_hash` text,
	`last_attempted_at` text,
	`last_published_at` text,
	`last_error_code` text,
	`last_error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commit_group_id`) REFERENCES `commit_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_publications_pull_request_id_surface_unique` ON `github_publications` (`pull_request_id`,`surface`);--> statement-breakpoint
CREATE UNIQUE INDEX `github_publications_commit_group_id_surface_unique` ON `github_publications` (`commit_group_id`,`surface`);--> statement-breakpoint
CREATE INDEX `github_publications_repository_id_idx` ON `github_publications` (`repository_id`);--> statement-breakpoint
CREATE INDEX `github_publications_pull_request_id_idx` ON `github_publications` (`pull_request_id`);--> statement-breakpoint
CREATE INDEX `github_publications_commit_group_id_idx` ON `github_publications` (`commit_group_id`);--> statement-breakpoint
CREATE INDEX `github_publications_surface_idx` ON `github_publications` (`surface`);--> statement-breakpoint
CREATE TABLE `pr_review_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`pull_request_id` text NOT NULL,
	`commit_group_id` text NOT NULL,
	`commit_sha` text NOT NULL,
	`branch` text NOT NULL,
	`latest_upload_at` text NOT NULL,
	`settled_at` text,
	`status` text NOT NULL,
	`overall_state` text NOT NULL,
	`blocking_regression_count` integer NOT NULL,
	`regression_count` integer NOT NULL,
	`acknowledged_regression_count` integer NOT NULL,
	`improvement_count` integer NOT NULL,
	`pending_scenario_count` integer NOT NULL,
	`inherited_scenario_count` integer NOT NULL,
	`missing_scenario_count` integer NOT NULL,
	`failed_scenario_count` integer NOT NULL,
	`impacted_scenario_count` integer NOT NULL,
	`unchanged_scenario_count` integer NOT NULL,
	`no_baseline_series_count` integer NOT NULL,
	`failed_comparison_count` integer NOT NULL,
	`degraded_comparison_count` integer NOT NULL,
	`summary_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commit_group_id`) REFERENCES `commit_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pr_review_summaries_commit_group_id_unique` ON `pr_review_summaries` (`commit_group_id`);--> statement-breakpoint
CREATE INDEX `pr_review_summaries_repository_id_idx` ON `pr_review_summaries` (`repository_id`);--> statement-breakpoint
CREATE INDEX `pr_review_summaries_pull_request_id_idx` ON `pr_review_summaries` (`pull_request_id`);--> statement-breakpoint
CREATE INDEX `pr_review_summaries_status_idx` ON `pr_review_summaries` (`status`);--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`pr_number` integer NOT NULL,
	`base_sha` text NOT NULL,
	`base_ref` text NOT NULL,
	`head_sha` text NOT NULL,
	`head_ref` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pull_requests_repository_id_pr_number_unique` ON `pull_requests` (`repository_id`,`pr_number`);--> statement-breakpoint
CREATE INDEX `pull_requests_repository_id_idx` ON `pull_requests` (`repository_id`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`github_repo_id` integer NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`installation_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_github_repo_id_unique` ON `repositories` (`github_repo_id`);--> statement-breakpoint
CREATE TABLE `scenario_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`commit_group_id` text NOT NULL,
	`pull_request_id` text,
	`commit_sha` text NOT NULL,
	`branch` text NOT NULL,
	`status` text NOT NULL,
	`scenario_source_kind` text NOT NULL,
	`artifact_scenario_kind` text NOT NULL,
	`upload_dedupe_key` text NOT NULL,
	`raw_artifact_r2_key` text NOT NULL,
	`raw_envelope_r2_key` text NOT NULL,
	`artifact_sha256` text NOT NULL,
	`envelope_sha256` text NOT NULL,
	`artifact_size_bytes` integer NOT NULL,
	`envelope_size_bytes` integer NOT NULL,
	`artifact_schema_version` integer NOT NULL,
	`upload_schema_version` integer NOT NULL,
	`ci_provider` text NOT NULL,
	`ci_workflow_run_id` text NOT NULL,
	`ci_workflow_run_attempt` integer,
	`ci_job` text,
	`ci_action_version` text,
	`normalized_snapshot_r2_key` text,
	`normalized_schema_version` integer,
	`normalization_started_at` text,
	`normalized_at` text,
	`failure_code` text,
	`failure_message` text,
	`uploaded_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scenario_id`) REFERENCES `scenarios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commit_group_id`) REFERENCES `commit_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scenario_runs_upload_dedupe_key_unique` ON `scenario_runs` (`upload_dedupe_key`);--> statement-breakpoint
CREATE INDEX `scenario_runs_commit_group_id_idx` ON `scenario_runs` (`commit_group_id`);--> statement-breakpoint
CREATE INDEX `scenario_runs_scenario_id_idx` ON `scenario_runs` (`scenario_id`);--> statement-breakpoint
CREATE TABLE `scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`slug` text NOT NULL,
	`source_kind` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scenarios_repository_id_slug_unique` ON `scenarios` (`repository_id`,`slug`);--> statement-breakpoint
CREATE INDEX `scenarios_repository_id_idx` ON `scenarios` (`repository_id`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`environment` text NOT NULL,
	`entrypoint_key` text NOT NULL,
	`entrypoint_kind` text NOT NULL,
	`lens` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scenario_id`) REFERENCES `scenarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_repository_id_scenario_id_environment_entrypoint_lens_unique` ON `series` (`repository_id`,`scenario_id`,`environment`,`entrypoint_key`,`lens`);--> statement-breakpoint
CREATE INDEX `series_repository_id_idx` ON `series` (`repository_id`);--> statement-breakpoint
CREATE INDEX `series_scenario_id_idx` ON `series` (`scenario_id`);--> statement-breakpoint
CREATE TABLE `series_points` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`series_id` text NOT NULL,
	`scenario_run_id` text NOT NULL,
	`commit_group_id` text NOT NULL,
	`pull_request_id` text,
	`commit_sha` text NOT NULL,
	`branch` text NOT NULL,
	`measured_at` text NOT NULL,
	`entry_js_raw_bytes` integer NOT NULL,
	`entry_js_gzip_bytes` integer NOT NULL,
	`entry_js_brotli_bytes` integer NOT NULL,
	`direct_css_raw_bytes` integer NOT NULL,
	`direct_css_gzip_bytes` integer NOT NULL,
	`direct_css_brotli_bytes` integer NOT NULL,
	`total_raw_bytes` integer NOT NULL,
	`total_gzip_bytes` integer NOT NULL,
	`total_brotli_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scenario_run_id`) REFERENCES `scenario_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commit_group_id`) REFERENCES `commit_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_points_series_id_scenario_run_id_unique` ON `series_points` (`series_id`,`scenario_run_id`);--> statement-breakpoint
CREATE INDEX `series_points_repository_id_idx` ON `series_points` (`repository_id`);--> statement-breakpoint
CREATE INDEX `series_points_series_id_measured_at_idx` ON `series_points` (`series_id`,`measured_at`);--> statement-breakpoint
CREATE INDEX `series_points_commit_group_id_idx` ON `series_points` (`commit_group_id`);