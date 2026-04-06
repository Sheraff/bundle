CREATE TABLE IF NOT EXISTS comparisons (
  id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  head_scenario_run_id TEXT NOT NULL,
  base_scenario_run_id TEXT,
  head_commit_group_id TEXT NOT NULL,
  base_commit_group_id TEXT,
  pull_request_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_base_sha TEXT,
  requested_head_sha TEXT NOT NULL,
  selected_base_commit_sha TEXT,
  selected_head_commit_sha TEXT NOT NULL,
  current_total_raw_bytes INTEGER NOT NULL,
  current_total_gzip_bytes INTEGER NOT NULL,
  current_total_brotli_bytes INTEGER NOT NULL,
  baseline_total_raw_bytes INTEGER,
  baseline_total_gzip_bytes INTEGER,
  baseline_total_brotli_bytes INTEGER,
  delta_total_raw_bytes INTEGER,
  delta_total_gzip_bytes INTEGER,
  delta_total_brotli_bytes INTEGER,
  selected_entrypoint_relation TEXT,
  selected_entrypoint_confidence TEXT,
  selected_entrypoint_evidence_json TEXT,
  stable_identity_summary_json TEXT,
  has_degraded_stable_identity INTEGER NOT NULL,
  budget_state TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id),
  FOREIGN KEY (series_id) REFERENCES series(id),
  FOREIGN KEY (head_scenario_run_id) REFERENCES scenario_runs(id),
  FOREIGN KEY (base_scenario_run_id) REFERENCES scenario_runs(id),
  FOREIGN KEY (head_commit_group_id) REFERENCES commit_groups(id),
  FOREIGN KEY (base_commit_group_id) REFERENCES commit_groups(id),
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS comparisons_kind_series_id_head_scenario_run_id_unique
  ON comparisons (kind, series_id, head_scenario_run_id);

CREATE INDEX IF NOT EXISTS comparisons_repository_id_idx
  ON comparisons (repository_id);

CREATE INDEX IF NOT EXISTS comparisons_series_id_idx
  ON comparisons (series_id);

CREATE INDEX IF NOT EXISTS comparisons_pull_request_id_idx
  ON comparisons (pull_request_id);

CREATE INDEX IF NOT EXISTS comparisons_head_scenario_run_id_idx
  ON comparisons (head_scenario_run_id);

CREATE INDEX IF NOT EXISTS comparisons_base_scenario_run_id_idx
  ON comparisons (base_scenario_run_id);

CREATE TABLE IF NOT EXISTS budget_results (
  id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  comparison_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  status TEXT NOT NULL,
  blocking INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id),
  FOREIGN KEY (comparison_id) REFERENCES comparisons(id),
  FOREIGN KEY (series_id) REFERENCES series(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS budget_results_comparison_id_item_key_unique
  ON budget_results (comparison_id, item_key);

CREATE INDEX IF NOT EXISTS budget_results_repository_id_idx
  ON budget_results (repository_id);

CREATE INDEX IF NOT EXISTS budget_results_series_id_idx
  ON budget_results (series_id);

CREATE INDEX IF NOT EXISTS budget_results_comparison_id_idx
  ON budget_results (comparison_id);
