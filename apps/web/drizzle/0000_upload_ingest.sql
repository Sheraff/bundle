CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY NOT NULL,
  github_repo_id INTEGER NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  installation_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS repositories_github_repo_id_unique
  ON repositories (github_repo_id);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS scenarios_repository_id_slug_unique
  ON scenarios (repository_id, slug);

CREATE INDEX IF NOT EXISTS scenarios_repository_id_idx
  ON scenarios (repository_id);

CREATE TABLE IF NOT EXISTS pull_requests (
  id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  base_sha TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  head_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS pull_requests_repository_id_pr_number_unique
  ON pull_requests (repository_id, pr_number);

CREATE INDEX IF NOT EXISTS pull_requests_repository_id_idx
  ON pull_requests (repository_id);

CREATE TABLE IF NOT EXISTS commit_groups (
  id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  pull_request_id TEXT,
  commit_sha TEXT NOT NULL,
  branch TEXT NOT NULL,
  status TEXT NOT NULL,
  latest_upload_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id),
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS commit_groups_repository_id_commit_sha_unique
  ON commit_groups (repository_id, commit_sha);

CREATE INDEX IF NOT EXISTS commit_groups_pull_request_id_idx
  ON commit_groups (pull_request_id);

CREATE TABLE IF NOT EXISTS scenario_runs (
  id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  commit_group_id TEXT NOT NULL,
  pull_request_id TEXT,
  commit_sha TEXT NOT NULL,
  branch TEXT NOT NULL,
  status TEXT NOT NULL,
  scenario_source_kind TEXT NOT NULL,
  artifact_scenario_kind TEXT NOT NULL,
  upload_dedupe_key TEXT NOT NULL,
  raw_artifact_r2_key TEXT NOT NULL,
  raw_envelope_r2_key TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  envelope_sha256 TEXT NOT NULL,
  artifact_size_bytes INTEGER NOT NULL,
  envelope_size_bytes INTEGER NOT NULL,
  artifact_schema_version INTEGER NOT NULL,
  upload_schema_version INTEGER NOT NULL,
  ci_provider TEXT NOT NULL,
  ci_workflow_run_id TEXT NOT NULL,
  ci_workflow_run_attempt INTEGER,
  ci_job TEXT,
  ci_action_version TEXT,
  uploaded_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id),
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id),
  FOREIGN KEY (commit_group_id) REFERENCES commit_groups(id),
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS scenario_runs_upload_dedupe_key_unique
  ON scenario_runs (upload_dedupe_key);

CREATE INDEX IF NOT EXISTS scenario_runs_commit_group_id_idx
  ON scenario_runs (commit_group_id);

CREATE INDEX IF NOT EXISTS scenario_runs_scenario_id_idx
  ON scenario_runs (scenario_id);
