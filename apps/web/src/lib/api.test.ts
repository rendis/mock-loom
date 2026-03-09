import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getAuthConfig,
  getDataSourceSchema,
  getDataSources,
  getEndpointAutocompleteContext,
  getIntegrationPacks,
  updateEndpointRoute,
  updateDataSourceSchema,
  uploadDataSourceBaseline,
  getWorkspaceMembers,
  getWorkspaces,
} from './api'

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('getAuthConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes camelCase provider fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          dummyAuth: false,
          panelProvider: {
            name: 'oidc',
            issuer: 'https://issuer.example.com',
            discoveryUrl: 'https://issuer.example.com/.well-known/openid-configuration',
            jwksUrl: 'https://issuer.example.com/.well-known/jwks.json',
            authorizationEndpoint: 'https://issuer.example.com/authorize',
            tokenEndpoint: 'https://issuer.example.com/token',
            userinfoEndpoint: 'https://issuer.example.com/userinfo',
            endSessionEndpoint: 'https://issuer.example.com/logout',
            clientId: 'mock-loom-panel',
            audience: 'mock-loom-api',
            scopes: 'openid profile email',
          },
        })
      )
    )

    const config = await getAuthConfig()
    expect(config.dummyAuth).toBe(false)
    expect(config.panelProvider?.discoveryUrl).toBe('https://issuer.example.com/.well-known/openid-configuration')
    expect(config.panelProvider?.jwksUrl).toBe('https://issuer.example.com/.well-known/jwks.json')
    expect(config.panelProvider?.clientId).toBe('mock-loom-panel')
    expect(config.panelProvider?.audience).toBe('mock-loom-api')
  })

  it('normalizes snake_case provider fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          dummy_auth: false,
          panelProvider: {
            name: 'oidc',
            issuer: 'https://issuer.example.com',
            discovery_url: 'https://issuer.example.com/.well-known/openid-configuration',
            jwks_url: 'https://issuer.example.com/.well-known/jwks.json',
            authorization_endpoint: 'https://issuer.example.com/authorize',
            token_endpoint: 'https://issuer.example.com/token',
            userinfo_endpoint: 'https://issuer.example.com/userinfo',
            end_session_endpoint: 'https://issuer.example.com/logout',
            client_id: 'mock-loom-panel',
            audience: 'mock-loom-api',
            scopes: 'openid profile email',
          },
        })
      )
    )

    const config = await getAuthConfig()
    expect(config.dummyAuth).toBe(false)
    expect(config.panelProvider?.discoveryUrl).toBe('https://issuer.example.com/.well-known/openid-configuration')
    expect(config.panelProvider?.jwksUrl).toBe('https://issuer.example.com/.well-known/jwks.json')
    expect(config.panelProvider?.authorizationEndpoint).toBe('https://issuer.example.com/authorize')
    expect(config.panelProvider?.tokenEndpoint).toBe('https://issuer.example.com/token')
    expect(config.panelProvider?.userinfoEndpoint).toBe('https://issuer.example.com/userinfo')
    expect(config.panelProvider?.endSessionEndpoint).toBe('https://issuer.example.com/logout')
    expect(config.panelProvider?.clientId).toBe('mock-loom-panel')
    expect(config.panelProvider?.audience).toBe('mock-loom-api')
  })
})

describe('getDataSources', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes snake_case data source fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              id: 'src-1',
              integration_id: 'int-1',
              name: 'Users',
              slug: 'users',
              kind: 'JSON',
              status: 'ACTIVE',
              last_sync_at: '2026-03-02T12:00:00Z',
              record_count: 42,
              created_at: '2026-03-02T10:00:00Z',
              updated_at: '2026-03-02T12:00:00Z',
            },
          ],
        })
      )
    )

    const items = await getDataSources('token', 'int-1')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'src-1',
      integrationId: 'int-1',
      name: 'Users',
      slug: 'users',
      kind: 'JSON',
      status: 'ACTIVE',
      recordCount: 42,
    })
  })
})

describe('getIntegrationPacks', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes basePath and auth summary from mixed payload keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              id: 'pack-1',
              integration_id: 'int-1',
              name: 'Core',
              slug: 'core',
              base_path: '/api/v1',
              status: 'ACTIVE',
              route_count: 3,
              authEnabled: true,
              auth_type: 'PREBUILT',
              auth_policy: {
                mode: 'CUSTOM_EXPR',
                prebuilt: { denyAll: false },
                custom_expr: "auth.email == 'dev@example.com'",
              },
              created_at: '2026-03-03T10:00:00Z',
              updated_at: '2026-03-03T11:00:00Z',
            },
          ],
        })
      )
    )

    const packs = await getIntegrationPacks('token', 'int-1')
    expect(packs).toHaveLength(1)
    expect(packs[0]).toMatchObject({
      id: 'pack-1',
      integrationId: 'int-1',
      name: 'Core',
      slug: 'core',
      basePath: '/api/v1',
      routeCount: 3,
      auth: {
        enabled: true,
        type: 'PREBUILT',
      },
      authPolicy: {
        mode: 'CUSTOM_EXPR',
        customExpr: "auth.email == 'dev@example.com'",
      },
    })
  })
})

describe('updateEndpointRoute', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('patches endpoint route identity in pack scope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'ep-1',
        packId: 'pack-1',
        method: 'PATCH',
        path: '/api/orders/:orderid',
        authMode: 'INHERIT',
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const payload = await updateEndpointRoute('token', 'int-1', 'pack-1', 'ep-1', {
      method: 'PATCH',
      relativePath: '/orders/:orderId',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/integrations/int-1/packs/pack-1/endpoints/ep-1/route', expect.any(Object))
    expect(payload).toMatchObject({
      id: 'ep-1',
      packId: 'pack-1',
      method: 'PATCH',
      path: '/api/orders/:orderid',
      authMode: 'INHERIT',
    })
  })
})

describe('workspace normalization', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes workspace metadata and timestamps', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              id: 'ws-1',
              name: 'Workspace One',
              slug: 'workspace-one',
              description: 'Main workspace',
              metadata_json: '{"owner":"qa"}',
              status: 'ACTIVE',
              created_at: '2026-03-03T10:00:00Z',
              updated_at: '2026-03-03T11:00:00Z',
            },
          ],
        })
      )
    )

    const items = await getWorkspaces('token')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'ws-1',
      metadataJson: '{"owner":"qa"}',
      createdAt: '2026-03-03T10:00:00Z',
      updatedAt: '2026-03-03T11:00:00Z',
    })
  })

  it('normalizes member identity projection fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              id: 'mem-1',
              workspace_id: 'ws-1',
              user_id: 'usr-1',
              user_email: 'member@example.com',
              user_full_name: 'Member One',
              role: 'EDITOR',
              membership_status: 'ACTIVE',
              invited_by: 'usr-admin',
              joined_at: '2026-03-03T10:00:00Z',
              created_at: '2026-03-03T09:00:00Z',
            },
          ],
        })
      )
    )

    const items = await getWorkspaceMembers('token', 'ws-1')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'mem-1',
      workspaceId: 'ws-1',
      userId: 'usr-1',
      userEmail: 'member@example.com',
      userFullName: 'Member One',
      role: 'EDITOR',
      membershipStatus: 'ACTIVE',
    })
  })
})

describe('getEndpointAutocompleteContext', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes autocomplete payload keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          request_paths: ['request.body.id'],
          sourcePaths: ['source.users.id'],
          Functions: ['contains(field, value)'],
          template_paths: ['{{request.body.id}}'],
        })
      )
    )

    const context = await getEndpointAutocompleteContext('token', 'int-1', 'ep-1', 'pack-1')
    expect(context).toEqual({
      requestPaths: ['request.body.id'],
      sourcePaths: ['source.users.id'],
      functions: ['contains(field, value)'],
      templatePaths: ['{{request.body.id}}'],
    })
  })
})

describe('uploadDataSourceBaseline', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends optional csvDelimiter when provided', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData
      expect(form.get('csvDelimiter')).toBe('semicolon')
      return jsonResponse({
        sourceId: 'src-1',
        snapshotId: 'snap-1',
        recordCount: 2,
        status: 'ACTIVE',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const file = new File(['id;name\n1;alice\n2;bob\n'], 'users.csv', { type: 'text/csv' })
    const result = await uploadDataSourceBaseline('token', 'int-1', 'src-1', file, { csvDelimiter: 'semicolon' })
    expect(result.recordCount).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('data source schema contracts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes schema get payload with fields and warnings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          source_id: 'src-1',
          schema_json: '{"type":"object"}',
          fields: [
            {
              key: 'age',
              inferred_type: 'string',
              effective_type: 'number',
              overridden: true,
            },
          ],
          warnings: [
            {
              key: 'age',
              expected_type: 'number',
              mismatch_count: 2,
            },
          ],
        })
      )
    )

    const result = await getDataSourceSchema('token', 'int-1', 'src-1')
    expect(result.sourceId).toBe('src-1')
    expect(result.schemaJson).toBe('{"type":"object"}')
    expect(result.fields).toEqual([
      {
        key: 'age',
        inferredType: 'string',
        effectiveType: 'number',
        overridden: true,
      },
    ])
    expect(result.warnings).toEqual([
      {
        key: 'age',
        expectedType: 'number',
        mismatchCount: 2,
      },
    ])
  })

  it('sends schema update payload and normalizes response', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { fields?: Array<{ key: string; type: string }> }
      expect(body.fields).toEqual([
        { key: 'id', type: 'string' },
        { key: 'age', type: 'number' },
      ])
      return jsonResponse({
        sourceId: 'src-1',
        schemaJson: '{"type":"object"}',
        fields: [
          { key: 'id', inferredType: 'string', effectiveType: 'string', overridden: false },
          { key: 'age', inferredType: 'string', effectiveType: 'number', overridden: true },
        ],
        warnings: [{ key: 'age', expectedType: 'number', mismatchCount: 1 }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await updateDataSourceSchema('token', 'int-1', 'src-1', {
      fields: [
        { key: 'id', type: 'string' },
        { key: 'age', type: 'number' },
      ],
    })
    expect(result.fields).toHaveLength(2)
    expect(result.warnings).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
