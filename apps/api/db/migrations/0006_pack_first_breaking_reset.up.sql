PRAGMA foreign_keys = OFF;

-- Breaking reset for pack-first endpoint architecture.
DROP TABLE IF EXISTS core_integration_endpoint_revisions;
DROP TABLE IF EXISTS core_integration_traffic;
DROP TABLE IF EXISTS core_integration_endpoints;
DROP TABLE IF EXISTS core_integration_packs;

CREATE TABLE IF NOT EXISTS core_integration_packs (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  auth_enabled INTEGER NOT NULL DEFAULT 0,
  auth_policy_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(integration_id, slug),
  FOREIGN KEY(integration_id) REFERENCES core_integrations(id)
);

CREATE TABLE IF NOT EXISTS core_integration_endpoints (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('INHERIT', 'OVERRIDE', 'NONE')) DEFAULT 'INHERIT',
  auth_override_policy_json TEXT NOT NULL DEFAULT '{}',
  contract_json TEXT NOT NULL DEFAULT '{}',
  scenarios_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(integration_id, method, path),
  FOREIGN KEY(integration_id) REFERENCES core_integrations(id),
  FOREIGN KEY(pack_id) REFERENCES core_integration_packs(id)
);

CREATE TABLE IF NOT EXISTS core_integration_traffic (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  endpoint_id TEXT,
  request_summary_json TEXT NOT NULL,
  matched_scenario TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(integration_id) REFERENCES core_integrations(id),
  FOREIGN KEY(endpoint_id) REFERENCES core_integration_endpoints(id)
);

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

CREATE INDEX IF NOT EXISTS idx_packs_integration ON core_integration_packs(integration_id);
CREATE INDEX IF NOT EXISTS idx_routes_integration ON core_integration_endpoints(integration_id);
CREATE INDEX IF NOT EXISTS idx_routes_pack ON core_integration_endpoints(pack_id);
CREATE INDEX IF NOT EXISTS idx_traffic_integration ON core_integration_traffic(integration_id);
CREATE INDEX IF NOT EXISTS idx_endpoint_revisions_endpoint_created
  ON core_integration_endpoint_revisions(integration_id, endpoint_id, created_at DESC);

-- Explicitly clear legacy integration-level auth policies in this breaking reset.
DELETE FROM core_integration_auth_mock_policies;

PRAGMA foreign_keys = ON;
