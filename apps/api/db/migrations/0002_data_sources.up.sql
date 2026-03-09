CREATE TABLE IF NOT EXISTS core_integration_data_sources (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CSV', 'JSON')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PENDING', 'ERROR')),
  last_sync_at TEXT,
  record_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(integration_id, slug),
  FOREIGN KEY(integration_id) REFERENCES core_integrations(id)
);

CREATE INDEX IF NOT EXISTS idx_data_sources_integration ON core_integration_data_sources(integration_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_integration_table ON snapshots(integration_id, table_name, created_at);
CREATE INDEX IF NOT EXISTS idx_events_snapshot_entity ON events(snapshot_id, entity_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_working_datasets_snapshot_entity ON working_datasets(snapshot_id, entity_id);
