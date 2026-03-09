CREATE TABLE IF NOT EXISTS core_data_source_schema_overrides (
  source_id TEXT PRIMARY KEY,
  overrides_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES core_integration_data_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_data_source_schema_overrides_updated_at
  ON core_data_source_schema_overrides(updated_at);
