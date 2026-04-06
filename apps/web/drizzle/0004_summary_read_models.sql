CREATE TABLE IF NOT EXISTS acknowledgements (
  id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  pull_request_id TEXT NOT NULL,
  comparison_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  actor_github_user_id INTEGER,
  actor_login TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id),
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id),
  FOREIGN KEY (comparison_id) REFERENCES comparisons(id),
  FOREIGN KEY (series_id) REFERENCES series(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS acknowledgements_pull_request_id_comparison_id_item_key_unique
  ON acknowledgements (pull_request_id, comparison_id, item_key);

CREATE INDEX IF NOT EXISTS acknowledgements_repository_id_idx
  ON acknowledgements (repository_id);

CREATE INDEX IF NOT EXISTS acknowledgements_pull_request_id_idx
  ON acknowledgements (pull_request_id);

CREATE INDEX IF NOT EXISTS acknowledgements_comparison_id_idx
  ON acknowledgements (comparison_id);

CREATE TABLE IF NOT EXISTS commit_group_summaries (
  id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  commit_group_id TEXT NOT NULL,
  pull_request_id TEXT,
  commit_sha TEXT NOT NULL,
  branch TEXT NOT NULL,
  status TEXT NOT NULL,
  latest_upload_at TEXT NOT NULL,
  quiet_window_deadline TEXT NOT NULL,
  settled_at TEXT,
  expected_scenario_count INTEGER NOT NULL,
  fresh_scenario_count INTEGER NOT NULL,
  pending_scenario_count INTEGER NOT NULL,
  inherited_scenario_count INTEGER NOT NULL,
  missing_scenario_count INTEGER NOT NULL,
  failed_scenario_count INTEGER NOT NULL,
  impacted_scenario_count INTEGER NOT NULL,
  unchanged_scenario_count INTEGER NOT NULL,
  comparison_count INTEGER NOT NULL,
  changed_metric_count INTEGER NOT NULL,
  no_baseline_series_count INTEGER NOT NULL,
  failed_comparison_count INTEGER NOT NULL,
  degraded_comparison_count INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id),
  FOREIGN KEY (commit_group_id) REFERENCES commit_groups(id),
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS commit_group_summaries_commit_group_id_unique
  ON commit_group_summaries (commit_group_id);

CREATE INDEX IF NOT EXISTS commit_group_summaries_repository_id_idx
  ON commit_group_summaries (repository_id);

CREATE INDEX IF NOT EXISTS commit_group_summaries_pull_request_id_idx
  ON commit_group_summaries (pull_request_id);

CREATE INDEX IF NOT EXISTS commit_group_summaries_status_idx
  ON commit_group_summaries (status);

CREATE TABLE IF NOT EXISTS pr_review_summaries (
  id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  pull_request_id TEXT NOT NULL,
  commit_group_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  branch TEXT NOT NULL,
  latest_upload_at TEXT NOT NULL,
  settled_at TEXT,
  status TEXT NOT NULL,
  overall_state TEXT NOT NULL,
  blocking_regression_count INTEGER NOT NULL,
  regression_count INTEGER NOT NULL,
  acknowledged_regression_count INTEGER NOT NULL,
  improvement_count INTEGER NOT NULL,
  pending_scenario_count INTEGER NOT NULL,
  inherited_scenario_count INTEGER NOT NULL,
  missing_scenario_count INTEGER NOT NULL,
  failed_scenario_count INTEGER NOT NULL,
  impacted_scenario_count INTEGER NOT NULL,
  unchanged_scenario_count INTEGER NOT NULL,
  no_baseline_series_count INTEGER NOT NULL,
  failed_comparison_count INTEGER NOT NULL,
  degraded_comparison_count INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id),
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id),
  FOREIGN KEY (commit_group_id) REFERENCES commit_groups(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS pr_review_summaries_commit_group_id_unique
  ON pr_review_summaries (commit_group_id);

CREATE INDEX IF NOT EXISTS pr_review_summaries_repository_id_idx
  ON pr_review_summaries (repository_id);

CREATE INDEX IF NOT EXISTS pr_review_summaries_pull_request_id_idx
  ON pr_review_summaries (pull_request_id);

CREATE INDEX IF NOT EXISTS pr_review_summaries_status_idx
  ON pr_review_summaries (status);
