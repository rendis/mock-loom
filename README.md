# mock-loom

Rule-Based API Mocking Engine scaffold with:

- OIDC login-only authentication (autodiscovery)
- Global users + workspace memberships
- Invite-by-email member flow
- First-login superadmin bootstrap (allowlist guarded)

## Monorepo layout

- `apps/api`: Go Fiber API + SQLite persistence
- `apps/web`: React SPA (OIDC Authorization Code + PKCE)
- `packages/contracts/openapi`: OpenAPI source contract

## Requirements

- Go 1.24+
- Node.js 20+
- pnpm 10+

## Quick start

1. Install JS dependencies:
   ```bash
   pnpm install
   ```
2. Configure API env:
   - Copy `apps/api/.env.example` values to your environment.
   - At minimum set:
     - `MOCK_LOOM_AUTH_DISCOVERY_URL`
     - `MOCK_LOOM_AUTH_CLIENT_ID`
     - `MOCK_LOOM_BOOTSTRAP_ALLOWED_EMAILS` or `MOCK_LOOM_BOOTSTRAP_ALLOWED_DOMAINS`
3. Run API:
   ```bash
   cd apps/api
   go run ./cmd/server
   ```
4. Run web:
   ```bash
   cd apps/web
   pnpm dev
   ```

## Verification commands

- API tests:
  ```bash
  cd apps/api
  go test ./...
  go vet ./...
  ```
- Web checks:
  ```bash
  pnpm --filter @mock-loom/web typecheck
  pnpm --filter @mock-loom/web test
  pnpm --filter @mock-loom/web build
  ```

## Core API routes

- Auth: `/api/v1/auth/config`, `/api/v1/auth/me`, `/api/v1/auth/logout`
- Workspaces: `/api/v1/workspaces`
- Members: `/api/v1/workspaces/{workspaceId}/members...`
- Integrations: `/api/v1/workspaces/{workspaceId}/integrations...`, `/api/v1/integrations/{integrationId}/...`
- Data Sources: `/api/v1/integrations/{integrationId}/data-sources...`

Contract reference:

- `packages/contracts/openapi/mock-loom.v1.yaml`
