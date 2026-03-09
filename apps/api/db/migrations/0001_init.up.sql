PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS identity_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  external_identity_id TEXT,
  full_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_system_roles (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('SUPERADMIN', 'PLATFORM_ADMIN')),
  granted_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES identity_users(id)
);

CREATE TABLE IF NOT EXISTS core_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER')),
  membership_status TEXT NOT NULL CHECK (membership_status IN ('PENDING', 'ACTIVE')),
  invited_by TEXT,
  joined_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, user_id),
  FOREIGN KEY(workspace_id) REFERENCES core_workspaces(id),
  FOREIGN KEY(user_id) REFERENCES identity_users(id)
);

CREATE TABLE IF NOT EXISTS core_integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_mode TEXT NOT NULL DEFAULT 'NONE',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, slug),
  FOREIGN KEY(workspace_id) REFERENCES core_workspaces(id)
);

CREATE TABLE IF NOT EXISTS core_integration_endpoints (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  contract_json TEXT NOT NULL DEFAULT '{}',
  scenarios_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(integration_id, method, path),
  FOREIGN KEY(integration_id) REFERENCES core_integrations(id)
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

-- Event sourcing baseline tables for later specs.
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  data_schema TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  diff_payload TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  triggered_by_request_id TEXT,
  FOREIGN KEY(snapshot_id) REFERENCES snapshots(snapshot_id)
);

CREATE TABLE IF NOT EXISTS working_datasets (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  current_data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(snapshot_id) REFERENCES snapshots(snapshot_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_user ON identity_workspace_members(workspace_id, user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON identity_workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_integrations_workspace ON core_integrations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_routes_integration ON core_integration_endpoints(integration_id);
CREATE INDEX IF NOT EXISTS idx_traffic_integration ON core_integration_traffic(integration_id);
