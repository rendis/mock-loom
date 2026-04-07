---
name: mock-loom
description: >-
  Interact with mock-loom Rule-Based API Mocking Engine via MCP tools.
  Set up workspaces, integrations, packs, endpoint contracts and scenarios,
  data sources, send mock requests, and debug entity state with timeline/rollback.
  Use when working with mock-loom, API mocking, API simulation, mock server,
  route import from OpenAPI/Postman/cURL, entity rollback, traffic logs,
  or when the user asks to create, test, inspect, or manage mock endpoints.
allowed-tools:
  - mcp__mock-loom__*
---

# mock-loom MCP

MCP integration for the mock-loom Rule-Based API Mocking Engine.

Uses `mcp-openapi-proxy` — it reads the OpenAPI spec and exposes three MCP tools:

- `ml_list_endpoints`
- `ml_describe_endpoint`
- `ml_call_endpoint`

Each REST operation still gets a stable endpoint `toolName` such as `ml_get_api_v1_workspaces`, but that identifier is passed into `ml_describe_endpoint` / `ml_call_endpoint`; it is not a top-level MCP tool by itself.

## Setup

### Install the proxy binary

```bash
go install github.com/rendis/mcp-openapi-proxy/cmd/mcp-openapi-proxy@latest
```

### Configuration

`.mcp.json` at the project root is auto-detected by Claude Code. No additional setup needed when opening the project.

**Env vars** (set in `.mcp.json`):

| Variable | Purpose | Default |
|----------|---------|---------|
| `MCP_SPEC` | OpenAPI spec URL or file path | (required) |
| `MCP_BASE_URL` | API base URL | (required) |
| `MCP_AUTH_TOKEN` | Static auth token (dev/dummy mode) | — |
| `MCP_AUTH_PROFILE` | Token storage namespace for OIDC sessions | `ml` / `default` |
| `MCP_TOOL_PREFIX` | Tool name prefix | `ml` |
| `MCP_OIDC_ISSUER` | OIDC issuer URL for proxy login | — |
| `MCP_OIDC_CLIENT_ID` | OIDC client ID for proxy login | — |
| `MCP_OIDC_SCOPES` | Optional scope override for proxy login | Proxy default |

### Claude Code (CLI)

Auto-detected from `.mcp.json` in repo root. To add manually:

```bash
claude mcp add mock-loom -s project -- mcp-openapi-proxy
```

### OpenAI Codex

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.mock-loom]
command = "mcp-openapi-proxy"
args = []

[mcp_servers.mock-loom.env]
MCP_SPEC = "https://raw.githubusercontent.com/rendis/mock-loom/main/packages/contracts/openapi/mock-loom.v1.yaml"
MCP_BASE_URL = "http://127.0.0.1:18081"
MCP_AUTH_TOKEN = "dummy-token"
MCP_AUTH_PROFILE = "mock-loom"
MCP_TOOL_PREFIX = "ml"
```

### Gemini CLI

Edit `.gemini/settings.json` (project) or `~/.gemini/settings.json` (global):

```json
{
  "mcpServers": {
    "mock-loom": {
      "command": "mcp-openapi-proxy",
      "args": [],
      "env": {
        "MCP_SPEC": "https://raw.githubusercontent.com/rendis/mock-loom/main/packages/contracts/openapi/mock-loom.v1.yaml",
        "MCP_BASE_URL": "http://127.0.0.1:18081",
        "MCP_AUTH_TOKEN": "dummy-token",
        "MCP_AUTH_PROFILE": "mock-loom",
        "MCP_TOOL_PREFIX": "ml"
      }
    }
  }
}
```

### OIDC (production)

```bash
MCP_OIDC_ISSUER=https://auth.example.com/realms/mock-loom \
MCP_OIDC_CLIENT_ID=mock-loom-cli \
MCP_AUTH_PROFILE=mock-loom \
mcp-openapi-proxy login      # Open browser -> OIDC login
mcp-openapi-proxy status     # Verify token is valid
mcp-openapi-proxy logout     # Clear stored tokens
```

Remove `MCP_AUTH_TOKEN` from env so the proxy uses OIDC tokens instead. Tokens auto-refresh via refresh token. `mock-loom` exposes `/api/v1/auth/config` for the web app, but proxy login should be configured with `MCP_OIDC_ISSUER` + `MCP_OIDC_CLIENT_ID`.

## Quick Start Workflow

```
1. ml_list_endpoints -> discover available operations
2. Find the endpoint toolName you need (for example `ml_get_api_v1_workspaces`)
3. ml_describe_endpoint(toolName=...) -> inspect request/response contract
4. ml_call_endpoint(toolName=...) -> execute the operation with path/query/headers/body
5. Repeat with the next endpoint toolName in the workflow
```

## Tool Reference

The proxy exposes these three MCP tools:

| MCP Tool | Purpose |
|------|---------|
| `ml_list_endpoints` | List indexed API operations with lightweight metadata |
| `ml_describe_endpoint` | Return the full OpenAPI contract for one endpoint `toolName` |
| `ml_call_endpoint` | Execute one endpoint `toolName` with structured args |

Endpoint identifiers follow `ml_{method}_{path}` (path segments joined by underscores, path parameters replaced with `{name}`).

### Common endpoint `toolName` values

| `toolName` | Purpose |
|------|---------|
| `ml_get_api_v1_workspaces` | List all workspaces |
| `ml_post_api_v1_workspaces` | Create workspace |
| `ml_get_api_v1_workspaces_{workspaceId}` | Get workspace by ID |
| `ml_patch_api_v1_workspaces_{workspaceId}` | Update workspace |
| `ml_delete_api_v1_workspaces_{workspaceId}` | Archive workspace |
| `ml_get_api_v1_workspaces_{workspaceId}_members` | List workspace members |
| `ml_post_api_v1_workspaces_{workspaceId}_members_invitations` | Invite member |
| `ml_patch_api_v1_workspaces_{workspaceId}_members_{memberId}_role` | Update member role |
| `ml_patch_api_v1_workspaces_{workspaceId}_members_{memberId}_status` | Update member status |
| `ml_get_api_v1_workspaces_{workspaceId}_integrations` | List integrations in workspace |
| `ml_post_api_v1_workspaces_{workspaceId}_integrations` | Create integration |
| `ml_get_api_v1_integrations_{integrationId}_overview` | Get integration overview |
| `ml_patch_api_v1_integrations_{integrationId}_auth` | Update integration auth mode |
| `ml_get_api_v1_integrations_{integrationId}_packs` | List packs |
| `ml_post_api_v1_integrations_{integrationId}_packs` | Create pack |
| `ml_patch_api_v1_integrations_{integrationId}_packs_{packId}` | Update pack |
| `ml_get_api_v1_integrations_{integrationId}_packs_{packId}_routes` | List routes in pack |
| `ml_post_api_v1_integrations_{integrationId}_packs_{packId}_imports` | Import routes (OpenAPI/Postman/cURL) |
| `ml_get_api_v1_integrations_{integrationId}_packs_{packId}_endpoints_{endpointId}` | Get endpoint details |
| `ml_get_api_v1_integrations_{..}_endpoints_{..}_autocomplete-context` | Get autocomplete context |
| `ml_post_api_v1_integrations_{..}_endpoints_{..}_validate` | Validate contract + scenarios |
| `ml_patch_api_v1_integrations_{..}_endpoints_{..}_route` | Update endpoint route |
| `ml_patch_api_v1_integrations_{..}_endpoints_{..}_auth` | Update endpoint auth |
| `ml_put_api_v1_integrations_{..}_endpoints_{..}_contract` | Update contract |
| `ml_put_api_v1_integrations_{..}_endpoints_{..}_scenarios` | Update scenarios |
| `ml_get_api_v1_integrations_{..}_endpoints_{..}_traffic` | Get traffic logs |
| `ml_get_api_v1_integrations_{..}_endpoints_{..}_revisions` | List revisions |
| `ml_post_api_v1_integrations_{..}_endpoints_{..}_revisions_{revisionId}_restore` | Restore revision |
| `ml_get_api_v1_integrations_{integrationId}_data-sources` | List data sources |
| `ml_post_api_v1_integrations_{integrationId}_data-sources` | Create data source |
| `ml_patch_api_v1_integrations_{integrationId}_data-sources_{sourceId}` | Update data source |
| `ml_delete_api_v1_integrations_{integrationId}_data-sources_{sourceId}` | Delete data source |
| `ml_post_api_v1_integrations_{integrationId}_data-sources_{sourceId}_baseline` | Upload baseline |
| `ml_get_api_v1_auth_config` | Get auth runtime config |
| `ml_get_api_v1_auth_me` | Get authenticated user profile |
| `ml_post_api_v1_auth_logout` | Logout current session |

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

Scenarios are priority-ordered condition->response rules:

```json
[
  {
    "name": "Get user by ID",
    "priority": 1,
    "conditionExpr": "request.params.path.id != ''",
    "response": {
      "statusCode": 200,
      "delayMs": 0,
      "headers": {"Content-Type": "application/json"},
      "body": {"id": "u-1", "name": "John"}
    }
  },
  {
    "name": "Fallback",
    "priority": 99,
    "conditionExpr": "true",
    "response": {
      "statusCode": 404,
      "delayMs": 0,
      "headers": {"Content-Type": "application/json"},
      "body": {"error": "not found"}
    }
  }
]
```

### String response body

`response.body` accepts a JSON object or a string. String bodies are sent as raw bytes — use `response.headers` to set Content-Type:

```json
{
  "name": "HTML response",
  "priority": 10,
  "conditionExpr": "request.body.accion == 'buscarAlumno'",
  "response": {
    "statusCode": 200,
    "delayMs": 0,
    "headers": {"Content-Type": "text/html; charset=utf-8"},
    "body": "<html><body><table><tr><td>26075524</td><td>JUAN PEREZ</td></tr></table></body></html>"
  }
}
```

- JSON object -> serialized as JSON, auto Content-Type `application/json`
- String -> raw bytes, default Content-Type `text/plain; charset=utf-8` (override via headers)
- null/omitted -> no body

## Expression Language (expr-lang)

Scenarios use `expr-lang/expr` for conditions and mutations.

### Available Context Variables

**request** (top-level aliases + params):
- `request.method` — HTTP method
- `request.path` — Full request path
- `request.header.<name>` — Request headers (lowercase keys)
- `request.query.<name>` — Query parameters
- `request.body` — Parsed request body (see below)
- `request.params.path.<name>` — Path parameters (e.g. `{userId}` or `:userId`)
- `request.params.query.<name>` — Query parameters (alias)
- `request.params.headers.<name>` — Headers (alias)
- `request.params.body` — Body (alias)

**source** (data source entities):
- `source.<slug>` — Array of all entities for a data source
- `source.<slug>_by_id` — Map of entities indexed by ID

**auth** (authentication context):
- `auth.token` — Raw auth token
- `auth.email` — Authenticated email
- `auth.claims` — Token claims map
- `auth.headers` — Auth-related headers

### Request Body Parsing

Body parsing depends on `Content-Type`:

| Content-Type | `request.body` type | Example |
|---|---|---|
| `application/json` | Parsed JSON (object, array, etc.) | `request.body.name` |
| `application/x-www-form-urlencoded` | Map of field->string (first value per key) | `request.body.accion` |
| Other / missing | Raw string or JSON attempt | — |

Form-urlencoded example — request body `accion=buscar&txtRun=26075524`:
```
request.body.accion == "buscar" && request.body.txtRun == "26075524"
```

### Common Patterns
```
request.method == 'POST'
request.body.name != ''
request.params.path.id != ''
len(source.users) > 0
source.users_by_id[request.params.path.id] != nil
request.body.accion == "buscarAlumno"
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
