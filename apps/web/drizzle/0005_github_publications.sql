CREATE TABLE IF NOT EXISTS github_publications (
  id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  pull_request_id TEXT NOT NULL,
  commit_group_id TEXT,
  surface TEXT NOT NULL,
  status TEXT NOT NULL,
  external_publication_id TEXT,
  external_publication_node_id TEXT,
  external_url TEXT,
  published_head_sha TEXT,
  payload_hash TEXT,
  last_attempted_at TEXT,
  last_published_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id),
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id),
  FOREIGN KEY (commit_group_id) REFERENCES commit_groups(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS github_publications_pull_request_id_surface_unique
  ON github_publications (pull_request_id, surface);

CREATE UNIQUE INDEX IF NOT EXISTS github_publications_commit_group_id_surface_unique
  ON github_publications (commit_group_id, surface);

CREATE INDEX IF NOT EXISTS github_publications_repository_id_idx
  ON github_publications (repository_id);

CREATE INDEX IF NOT EXISTS github_publications_pull_request_id_idx
  ON github_publications (pull_request_id);

CREATE INDEX IF NOT EXISTS github_publications_commit_group_id_idx
  ON github_publications (commit_group_id);

CREATE INDEX IF NOT EXISTS github_publications_surface_idx
  ON github_publications (surface);
