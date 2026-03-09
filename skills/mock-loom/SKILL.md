---
name: mock-loom
description: >-
  Interact with mock-loom Rule-Based API Mocking Engine via MCP tools.
  Set up workspaces, integrations, packs, endpoint contracts and scenarios,
  data sources, send mock requests, and debug entity state with timeline/rollback.
  Use when working with mock-loom, API mocking, or when the user asks to
  create, test, or manage mock endpoints.
allowed-tools:
  - mcp__mock-loom__*
---

# mock-loom MCP

MCP integration for the mock-loom Rule-Based API Mocking Engine.

## Prerequisites

1. **API must be running**: `make run-dummy` (dummy auth, port 18081)
2. **MCP binary must be built**: `make build-mcp`
3. **MCP config**: `.mcp.json` at project root configures Claude Code to spawn the MCP server

## Quick Start Workflow

```
1. mock_loom_list_workspaces          → discover existing workspaces
2. mock_loom_setup_workspace          → create workspace (idempotent by slug)
3. mock_loom_setup_integration        → create integration in workspace
4. mock_loom_manage_pack              → create endpoint pack (route group)
5. mock_loom_import_routes            → import from OpenAPI/Postman/cURL
   OR mock_loom_configure_endpoint    → manually configure contract + scenarios
6. mock_loom_manage_data_source       → create data source + upload baseline JSON
7. mock_loom_send_mock_request        → test the mock endpoint
8. mock_loom_get_traffic              → verify scenario matching
9. mock_loom_debug_entities           → inspect entity mutations
```

## Tool Reference

### Workspace

| Tool | Purpose | Key Args |
|------|---------|----------|
| `mock_loom_list_workspaces` | List all workspaces | — |
| `mock_loom_setup_workspace` | Create/get workspace | `name`, `slug` |

### Integration & Packs

| Tool | Purpose | Key Args |
|------|---------|----------|
| `mock_loom_setup_integration` | Create/get integration | `workspace_id`, `name`, `slug`, `base_url?`, `auth_mode?` |
| `mock_loom_manage_pack` | Create/update pack | `integration_id`, `name`, `slug`, `base_path`, `pack_id?` |
| `mock_loom_import_routes` | Bulk import routes | `integration_id`, `pack_id`, `source_type` (OPENAPI/POSTMAN/CURL), `payload` |
| `mock_loom_list_routes` | List packs/routes | `integration_id`, `pack_id?` |
| `mock_loom_get_overview` | Full integration overview | `integration_id` |

### Endpoints

| Tool | Purpose | Key Args |
|------|---------|----------|
| `mock_loom_configure_endpoint` | Get/update contract + scenarios | `integration_id`, `pack_id`, `endpoint_id`, `contract?`, `scenarios?` |
| `mock_loom_get_traffic` | View traffic logs | `integration_id`, `pack_id`, `endpoint_id` |

### Data Sources & Debugging

| Tool | Purpose | Key Args |
|------|---------|----------|
| `mock_loom_manage_data_source` | CRUD + baseline + schema | `integration_id`, `action`, `source_id?`, `name?`, `slug?`, `kind?`, `baseline_json?` |
| `mock_loom_debug_entities` | List/create/timeline/rollback | `integration_id`, `source_id`, `action`, `entity_id?`, `target_event_id?`, `payload?` |

### Runtime

| Tool | Purpose | Key Args |
|------|---------|----------|
| `mock_loom_send_mock_request` | Execute mock request | `workspace_id`, `integration_id`, `method`, `path`, `headers?`, `query?`, `body?` |

## Contract JSON Shape

The contract defines expected request structure:

```json
{
  "headers": [
    {"name": "X-Api-Key", "required": true, "schema": {"type": "string"}}
  ],
  "queryParams": [
    {"name": "page", "required": false, "schema": {"type": "integer"}}
  ],
  "body": {
    "type": "object",
    "properties": {
      "name": {"type": "string"},
      "email": {"type": "string", "format": "email"}
    },
    "required": ["name"]
  }
}
```

## Scenario JSON Shape

Scenarios are priority-ordered condition→response rules:

```json
[
  {
    "name": "Get user by ID",
    "priority": 1,
    "conditionExpr": "request.method == 'GET' && request.pathParams.id != ''",
    "response": {
      "status": 200,
      "headers": {"Content-Type": "application/json"},
      "bodyTemplate": "{\"id\": \"{{request.pathParams.id}}\", \"name\": \"John\"}"
    },
    "mutations": []
  },
  {
    "name": "Fallback",
    "priority": 99,
    "conditionExpr": "true",
    "response": {
      "status": 404,
      "headers": {"Content-Type": "application/json"},
      "bodyTemplate": "{\"error\": \"not found\"}"
    }
  }
]
```

## Expression Language (expr-lang)

Scenarios use `expr-lang/expr` for conditions and templates:

### Available Context Variables
- `request.method` — HTTP method
- `request.path` — Request path
- `request.pathParams.<name>` — Path parameters
- `request.query.<name>` — Query parameters
- `request.headers.<name>` — Request headers (lowercase keys)
- `request.body` — Parsed JSON body
- `ds.<slug>` — Data source entities by slug

### Common Patterns
```
request.method == 'POST'
request.body.name != ''
len(ds.users) > 0
request.pathParams.id in map(ds.users, {.id})
```

## Known API Behaviors

- **Response keys**: Workspace/Integration/Pack creation returns **PascalCase** keys (`ID`, `Name`, `Slug`).
- **Member responses**: Use **snake_case** keys.
- **DELETE/PATCH**: Often return **204 No Content** (no body).
- **Data source PATCH**: Requires both `name` and `slug`.
- **PUT /schema**: Requires ALL fields, not just overrides.
- **Auth modes**: `NONE`, `BEARER`, `API_KEY`.
- **Data source kinds**: `JSON`, `CSV`.
- **Import types**: `OPENAPI`, `POSTMAN`, `CURL`.
