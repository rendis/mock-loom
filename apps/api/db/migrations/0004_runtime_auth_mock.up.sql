CREATE TABLE IF NOT EXISTS core_integration_auth_mock_policies (
  integration_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('PREBUILT', 'CUSTOM_EXPR')),
  prebuilt_json TEXT NOT NULL DEFAULT '{}',
  custom_expr TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY(integration_id) REFERENCES core_integrations(id)
);

