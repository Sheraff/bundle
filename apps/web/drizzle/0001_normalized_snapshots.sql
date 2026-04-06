ALTER TABLE scenario_runs ADD COLUMN normalized_snapshot_r2_key TEXT;

ALTER TABLE scenario_runs ADD COLUMN normalized_schema_version INTEGER;

ALTER TABLE scenario_runs ADD COLUMN normalization_started_at TEXT;

ALTER TABLE scenario_runs ADD COLUMN normalized_at TEXT;

ALTER TABLE scenario_runs ADD COLUMN failure_code TEXT;

ALTER TABLE scenario_runs ADD COLUMN failure_message TEXT;
