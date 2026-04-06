CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  entrypoint_key TEXT NOT NULL,
  entrypoint_kind TEXT NOT NULL,
  lens TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id),
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS series_repository_id_scenario_id_environment_entrypoint_lens_unique
  ON series (repository_id, scenario_id, environment, entrypoint_key, lens);

CREATE INDEX IF NOT EXISTS series_repository_id_idx
  ON series (repository_id);

CREATE INDEX IF NOT EXISTS series_scenario_id_idx
  ON series (scenario_id);

CREATE TABLE IF NOT EXISTS series_points (
  id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  scenario_run_id TEXT NOT NULL,
  commit_group_id TEXT NOT NULL,
  pull_request_id TEXT,
  commit_sha TEXT NOT NULL,
  branch TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  entry_js_raw_bytes INTEGER NOT NULL,
  entry_js_gzip_bytes INTEGER NOT NULL,
  entry_js_brotli_bytes INTEGER NOT NULL,
  direct_css_raw_bytes INTEGER NOT NULL,
  direct_css_gzip_bytes INTEGER NOT NULL,
  direct_css_brotli_bytes INTEGER NOT NULL,
  total_raw_bytes INTEGER NOT NULL,
  total_gzip_bytes INTEGER NOT NULL,
  total_brotli_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id),
  FOREIGN KEY (series_id) REFERENCES series(id),
  FOREIGN KEY (scenario_run_id) REFERENCES scenario_runs(id),
  FOREIGN KEY (commit_group_id) REFERENCES commit_groups(id),
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS series_points_series_id_scenario_run_id_unique
  ON series_points (series_id, scenario_run_id);

CREATE INDEX IF NOT EXISTS series_points_repository_id_idx
  ON series_points (repository_id);

CREATE INDEX IF NOT EXISTS series_points_series_id_measured_at_idx
  ON series_points (series_id, measured_at);

CREATE INDEX IF NOT EXISTS series_points_commit_group_id_idx
  ON series_points (commit_group_id);
