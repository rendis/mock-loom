CREATE TABLE IF NOT EXISTS core_integration_endpoint_revisions (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  contract_json TEXT NOT NULL,
  scenarios_json TEXT NOT NULL,
  restored_from_revision_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(integration_id) REFERENCES core_integrations(id),
  FOREIGN KEY(endpoint_id) REFERENCES core_integration_endpoints(id)
);

CREATE INDEX IF NOT EXISTS idx_endpoint_revisions_endpoint_created
  ON core_integration_endpoint_revisions(integration_id, endpoint_id, created_at DESC);
