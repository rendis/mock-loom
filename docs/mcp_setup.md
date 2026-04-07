# MCP Setup for mock-loom

This guide explains how to configure the MCP (Model Context Protocol) integration for mock-loom with `mcp-openapi-proxy`.

## What is mcp-openapi-proxy?

`mcp-openapi-proxy` reads an OpenAPI specification and exposes a lightweight navigator/executor MCP server. Instead of registering one top-level MCP tool per endpoint, it registers exactly three tools:

- `ml_list_endpoints` — list available API operations
- `ml_describe_endpoint` — fetch the full OpenAPI contract for one operation
- `ml_call_endpoint` — execute one operation by `toolName`

Each API operation still gets a stable endpoint identifier such as `ml_get_api_v1_workspaces`. That identifier is returned by `ml_list_endpoints` and is then passed into `ml_describe_endpoint` or `ml_call_endpoint`.

## Prerequisites

- Go 1.21+ installed
- mock-loom API running (local or remote)

## Installation

```bash
go install github.com/rendis/mcp-openapi-proxy/cmd/mcp-openapi-proxy@latest
```

If the binary is not found, ensure `$GOPATH/bin` (or `$HOME/go/bin`) is in your PATH:

```bash
export PATH="$HOME/go/bin:$PATH"
```

## Configuration

### .mcp.json (already in repo)

The project includes a `.mcp.json` at the repo root that Claude Code auto-detects:

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

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_SPEC` | Yes | URL or local file path to the OpenAPI spec |
| `MCP_BASE_URL` | Yes | Base URL of the mock-loom API |
| `MCP_AUTH_TOKEN` | No | Static Bearer token (for dev/dummy auth mode) |
| `MCP_AUTH_PROFILE` | No | Token storage namespace for OIDC sessions |
| `MCP_TOOL_PREFIX` | No | Prefix for generated tool names (default: spec title) |
| `MCP_OIDC_ISSUER` | No | OIDC issuer URL used by `mcp-openapi-proxy login` |
| `MCP_OIDC_CLIENT_ID` | No | OIDC client ID used by `mcp-openapi-proxy login` |
| `MCP_OIDC_SCOPES` | No | Optional scope override for OIDC login |

For local development with dummy auth, use `MCP_AUTH_TOKEN=dummy-token` and run the API with `make run-dummy`.

## Runtime Tool Model

After the MCP server starts, agents interact through three MCP tools:

| MCP Tool | Purpose |
|----------|---------|
| `ml_list_endpoints` | Discover indexed API operations |
| `ml_describe_endpoint` | Fetch one endpoint's full OpenAPI contract by `toolName` |
| `ml_call_endpoint` | Execute one endpoint by `toolName` with path/query/headers/body |

Typical flow:

1. Call `ml_list_endpoints`
2. Pick the endpoint `toolName` you need (for example `ml_get_api_v1_workspaces`)
3. Call `ml_describe_endpoint` with that `toolName` if you need the full request/response contract
4. Call `ml_call_endpoint` with that `toolName` and the required path/query/body arguments

Example `toolName` identifiers you should expect to see in `ml_list_endpoints`:

- `ml_get_api_v1_workspaces`
- `ml_post_api_v1_workspaces`
- `ml_get_api_v1_workspaces_{workspaceId}_integrations`
- `ml_post_api_v1_integrations_{integrationId}_packs`
- `ml_put_api_v1_integrations_{integrationId}_packs_{packId}_endpoints_{endpointId}_scenarios`
- `ml_get_api_v1_integrations_{integrationId}_data-sources`
- `ml_get_api_v1_auth_config`
- `ml_get_api_v1_auth_me`

## OIDC Authentication (Production)

For production environments using OIDC, configure the proxy with the issuer and client ID it needs for browser-based PKCE login:

```bash
# Login via browser (OIDC PKCE flow)
MCP_OIDC_ISSUER=https://auth.example.com/realms/mock-loom \
MCP_OIDC_CLIENT_ID=mock-loom-cli \
MCP_AUTH_PROFILE=mock-loom \
mcp-openapi-proxy login

# Check token status
mcp-openapi-proxy status

# Clear stored tokens
mcp-openapi-proxy logout
```

The proxy stores tokens locally under the configured auth profile and refreshes them automatically when possible.

When using OIDC:

1. Remove `MCP_AUTH_TOKEN` from the env block in `.mcp.json`
2. Add `MCP_OIDC_ISSUER` and `MCP_OIDC_CLIENT_ID`
3. Optionally add `MCP_OIDC_SCOPES` if your provider needs non-default scopes

mock-loom also exposes `/api/v1/auth/config` for frontend/runtime discovery, but the proxy login flow should be configured with the proxy's documented OIDC env vars above.

## Setup by Agent

### Claude Code (CLI)

Auto-detected from `.mcp.json` in the repo root. Just open the project in Claude Code.

To add manually:

```bash
# Project scope
claude mcp add mock-loom -s project -- mcp-openapi-proxy

# User scope (available in all projects)
claude mcp add mock-loom -s user -- mcp-openapi-proxy
```

Verify:

```bash
claude mcp list
claude mcp get mock-loom
```

Remove if needed:

```bash
claude mcp remove mock-loom
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

Via CLI:

```bash
codex mcp add mock-loom -- mcp-openapi-proxy
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

Restart Gemini CLI after modifying the configuration.

## Troubleshooting

### Binary not found

```bash
# Check it's installed
which mcp-openapi-proxy

# If missing, ensure Go bin is in PATH
export PATH="$HOME/go/bin:$PATH"

# Reinstall
go install github.com/rendis/mcp-openapi-proxy/cmd/mcp-openapi-proxy@latest
```

### Server not connecting

1. Verify the API is running:
   ```bash
   curl -fsS http://127.0.0.1:18081/health
   ```

2. Verify the spec is accessible:
   ```bash
   curl -fsS https://raw.githubusercontent.com/rendis/mock-loom/main/packages/contracts/openapi/mock-loom.v1.yaml | head -5
   ```

3. For local spec, verify the file exists:
   ```bash
   ls -la packages/contracts/openapi/mock-loom.v1.yaml
   ```

### Tools not appearing

1. Check MCP server status in your agent:
   ```bash
   claude mcp list   # Claude Code
   ```

2. Ensure the server shows as "Connected"

3. Restart the agent/CLI after configuration changes

4. Remember that you should see the three proxy tools (`ml_list_endpoints`, `ml_describe_endpoint`, `ml_call_endpoint`) — not one top-level MCP tool per REST endpoint.

### Authentication errors

- **Dummy auth mode**: Ensure `MCP_AUTH_TOKEN=dummy-token` is set and API is running with `make run-dummy`
- **OIDC mode**: Run `mcp-openapi-proxy status` to verify token validity. Re-login with `mcp-openapi-proxy login` if expired.

## OpenAPI Spec Location

The canonical spec is at `packages/contracts/openapi/mock-loom.v1.yaml`.

- The checked-in `.mcp.json` references the GitHub-hosted spec so onboarding works even outside the repo.
- For local contract iteration, you can switch `MCP_SPEC` to `./packages/contracts/openapi/mock-loom.v1.yaml` so the proxy sees uncommitted spec changes immediately.

## References

- [mcp-openapi-proxy](https://github.com/rendis/mcp-openapi-proxy) - The OpenAPI-to-MCP proxy
- [Model Context Protocol](https://modelcontextprotocol.io/) - Official MCP specification
- [Claude Code MCP Docs](https://code.claude.com/docs/en/mcp)
- [OpenAI Codex MCP](https://developers.openai.com/codex/mcp/)
- [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/)
