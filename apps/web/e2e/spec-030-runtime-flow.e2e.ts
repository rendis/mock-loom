import { expect, test, type APIResponse } from '@playwright/test'

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`
}

function buildTestJWT(claims: Record<string, unknown>, signature = 'sig'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${header}.${payload}.${signature}`
}

function pickString(payload: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return value
    }
  }
  return ''
}

async function expectJSON(response: APIResponse, expectedStatus: number): Promise<any> {
  expect(response.status(), `unexpected status for ${response.url()}`).toBe(expectedStatus)
  const text = await response.text()
  if (text.trim() === '') {
    return {}
  }
  return JSON.parse(text)
}

test('SPEC-030 complete runtime flow passes locally', async ({ request }) => {
  const suffix = uniqueSuffix()

  let response = await request.get('/api/v1/auth/me')
  let payload = await expectJSON(response, 200)
  expect(payload.systemRole).toBe('SUPERADMIN')

  response = await request.post('/api/v1/workspaces', {
    data: {
      name: `Spec 030 Workspace ${suffix}`,
      slug: `spec-030-workspace-${suffix}`,
    },
  })
  payload = await expectJSON(response, 201)
  const workspaceId = pickString(payload, ['id', 'ID'])
  expect(workspaceId).toBeTruthy()

  response = await request.post(`/api/v1/workspaces/${workspaceId}/integrations`, {
    data: {
      name: `Spec 030 Integration ${suffix}`,
      slug: `spec-030-integration-${suffix}`,
      baseUrl: `https://mock.example.com/spec-030/${suffix}`,
    },
  })
  payload = await expectJSON(response, 201)
  const integrationId = pickString(payload, ['id', 'ID'])
  expect(integrationId).toBeTruthy()

  response = await request.post(`/api/v1/integrations/${integrationId}/packs`, {
    data: {
      name: 'Runtime Pack',
      slug: `runtime-pack-${suffix}`,
      basePath: '/users',
    },
  })
  payload = await expectJSON(response, 201)
  const packId = pickString(payload, ['id', 'ID'])
  expect(packId).toBeTruthy()

  response = await request.patch(`/api/v1/integrations/${integrationId}/packs/${packId}`, {
    data: {
      authEnabled: true,
      authPolicy: {
        mode: 'PREBUILT',
        prebuilt: {
          emailInList: ['dev@example.com'],
          requiredHeaders: [{ name: 'x-api-key', operator: 'EQUALS', value: 'abc' }],
        },
      },
    },
  })
  expect(response.status()).toBe(200)

  response = await request.post(`/api/v1/integrations/${integrationId}/data-sources`, {
    data: {
      name: 'Runtime Users',
      slug: 'runtime-users',
      kind: 'JSON',
    },
  })
  payload = await expectJSON(response, 201)
  const sourceId = pickString(payload, ['id', 'ID'])

  response = await request.post(`/api/v1/integrations/${integrationId}/data-sources/${sourceId}/baseline`, {
    multipart: {
      file: {
        name: 'runtime-users.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify([
            { id: 'ent-1', email: 'alpha@example.com', status: 'ACTIVE' },
            { id: 'ent-2', email: 'beta@example.com', status: 'ACTIVE' },
          ])
        ),
      },
    },
  })
  payload = await expectJSON(response, 200)
  expect(payload.recordCount).toBe(2)

  response = await request.post(`/api/v1/integrations/${integrationId}/packs/${packId}/imports`, {
    data: {
      sourceType: 'OPENAPI',
      payload: `openapi: 3.0.3
info:
  title: spec-030
  version: 1.0.0
paths:
  /apply:
    post:
      responses:
        "201":
          description: created
`,
    },
  })
  await expectJSON(response, 200)

  response = await request.get(`/api/v1/integrations/${integrationId}/packs/${packId}/routes`)
  payload = await expectJSON(response, 200)
  const routes = payload.items as Array<{ id: string; method: string; path: string }>
  const postApplyRoute = routes.find((item) => item.method === 'POST' && item.path === '/users/apply')
  expect(postApplyRoute).toBeTruthy()

  response = await request.patch(`/api/v1/integrations/${integrationId}/packs/${packId}/endpoints/${postApplyRoute!.id}/route`, {
    data: {
      method: 'POST',
      relativePath: '/apply/:userId',
    },
  })
  payload = await expectJSON(response, 200)
  expect(payload.path).toBe('/users/apply/:userId')

  response = await request.patch(`/api/v1/integrations/${integrationId}/packs/${packId}`, {
    data: {
      basePath: '/runtime/:tenantId',
    },
  })
  await expectJSON(response, 200)

  response = await request.get(`/api/v1/integrations/${integrationId}/packs/${packId}/routes`)
  payload = await expectJSON(response, 200)
  const rebasedRoutes = payload.items as Array<{ id: string; method: string; path: string }>
  const rebasedApplyRoute = rebasedRoutes.find((item) => item.id === postApplyRoute!.id)
  expect(rebasedApplyRoute).toBeTruthy()
  expect(rebasedApplyRoute?.path).toBe('/runtime/:tenantId/apply/:userId')

  response = await request.put(`/api/v1/integrations/${integrationId}/packs/${packId}/endpoints/${postApplyRoute!.id}/scenarios`, {
    data: {
      scenarios: JSON.stringify([
        {
          name: 'Delete User',
          priority: 10,
          conditionExpr: "request.body.operation == 'DELETE'",
          response: {
            statusCode: 200,
            body: { deleted: true },
          },
          mutations: [
            {
              type: 'DELETE',
              sourceSlug: 'runtime-users',
              entityIdExpr: 'request.body.id',
            },
          ],
        },
        {
          name: 'Apply User',
          priority: 20,
          conditionExpr: 'true',
          response: {
            statusCode: 201,
            body: { ok: true },
          },
          mutations: [
            {
              type: 'UPSERT',
              sourceSlug: 'runtime-users',
              entityIdExpr: 'request.body.id',
              payloadExpr: 'request.body',
            },
          ],
        },
      ]),
    },
  })
  expect(response.status()).toBe(204)

  const allowedToken = buildTestJWT({ email: 'dev@example.com', iss: 'https://mock-issuer.local' })

  response = await request.post(`/mock/${workspaceId}/${integrationId}/runtime/tenant-1/apply/usr-2`, {
    headers: {
      Authorization: `Bearer ${allowedToken}`,
      'x-api-key': 'abc',
      'Content-Type': 'application/json',
    },
    data: { id: 'usr-2', email: 'dev@example.com', status: 'PENDING' },
  })
  payload = await expectJSON(response, 201)
  expect(payload.ok).toBeTruthy()

  response = await request.post(`/mock/${workspaceId}/${integrationId}/runtime/tenant-1/apply/usr-2`, {
    headers: {
      Authorization: `Bearer ${allowedToken}`,
      'x-api-key': 'abc',
      'Content-Type': 'application/json',
    },
    data: { id: 'usr-2', operation: 'DELETE' },
  })
  payload = await expectJSON(response, 200)
  expect(payload.deleted).toBeTruthy()

  response = await request.post(`/mock/${workspaceId}/${integrationId}/runtime/tenant-1/apply/usr-deny`, {
    headers: {
      Authorization: `Bearer ${allowedToken}`,
      'Content-Type': 'application/json',
    },
    data: { id: 'usr-deny', email: 'dev@example.com', status: 'PENDING' },
  })
  expect(response.status()).toBe(403)

  response = await request.patch(`/api/v1/integrations/${integrationId}/packs/${packId}`, {
    data: {
      authEnabled: true,
      authPolicy: {
        mode: 'CUSTOM_EXPR',
        customExpr: "auth.email == 'expr@example.com' && request.header['x-api-key'] == 'abc'",
      },
    },
  })
  expect(response.status()).toBe(200)

  const exprToken = buildTestJWT({ email: 'expr@example.com' })
  response = await request.post(`/mock/${workspaceId}/${integrationId}/runtime/tenant-1/apply/usr-3`, {
    headers: {
      Authorization: `Bearer ${exprToken}`,
      'x-api-key': 'abc',
      'Content-Type': 'application/json',
    },
    data: { id: 'usr-3', email: 'expr@example.com', status: 'ACTIVE' },
  })
  expect(response.status()).toBe(201)

  response = await request.post(`/mock/${workspaceId}/${integrationId}/runtime/tenant-1/apply/usr-4`, {
    headers: {
      Authorization: `Bearer ${exprToken}`,
      'x-api-key': 'wrong',
      'Content-Type': 'application/json',
    },
    data: { id: 'usr-4', email: 'expr@example.com', status: 'ACTIVE' },
  })
  expect(response.status()).toBe(403)

  response = await request.patch(`/api/v1/integrations/${integrationId}/packs/${packId}`, {
    data: {
      authEnabled: true,
      authPolicy: {
        mode: 'PREBUILT',
        prebuilt: {
          oidc: {
            issuer: 'https://mock-issuer.local',
            emailClaim: 'email',
          },
        },
      },
    },
  })
  expect(response.status()).toBe(200)

  const invalidSignatureToken = buildTestJWT({ email: 'dev@example.com', iss: 'https://mock-issuer.local' }, 'invalid')
  response = await request.post(`/mock/${workspaceId}/${integrationId}/runtime/tenant-1/apply/usr-invalid`, {
    headers: {
      Authorization: `Bearer ${invalidSignatureToken}`,
      'Content-Type': 'application/json',
    },
    data: { id: 'usr-invalid', email: 'dev@example.com', status: 'ACTIVE' },
  })
  expect(response.status()).toBe(401)

  response = await request.get(`/api/v1/integrations/${integrationId}/data-sources/${sourceId}/entities`)
  payload = await expectJSON(response, 200)
  const entitiesBeforeRollback = payload.items as Array<{ entity_id?: string; entityId?: string }>
  expect(entitiesBeforeRollback.length).toBeGreaterThanOrEqual(2)

  response = await request.get(`/api/v1/integrations/${integrationId}/data-sources/${sourceId}/entities/ent-1/timeline`)
  payload = await expectJSON(response, 200)
  const ent1Timeline = payload.items as Array<{ id: string; action: string }>
  expect(ent1Timeline.length).toBeGreaterThan(0)
  const baselineEvent = ent1Timeline[ent1Timeline.length - 1] as Record<string, any>
  const baselineEventId = pickString(baselineEvent, ['id', 'ID'])
  expect(baselineEventId).toBeTruthy()

  response = await request.post(`/api/v1/integrations/${integrationId}/data-sources/${sourceId}/entities/ent-1/rollback`, {
    data: {
      targetEventId: baselineEventId,
    },
  })
  payload = await expectJSON(response, 200)
  expect(payload.rollbackEventId).toBeTruthy()

  response = await request.post(`/api/v1/integrations/${integrationId}/data-sources/${sourceId}/rollback-complete`)
  payload = await expectJSON(response, 200)
  expect(payload.restoredSnapshotId).toBeTruthy()
  expect(payload.compensationEvents).toBeGreaterThan(0)

  response = await request.get(`/api/v1/integrations/${integrationId}/data-sources/${sourceId}/entities?sort=entity_asc`)
  payload = await expectJSON(response, 200)
  const entitiesAfterRollback = payload.items as Array<Record<string, any>>
  expect(entitiesAfterRollback.length).toBe(2)
  const entityIds = entitiesAfterRollback
    .map((item) => pickString(item, ['entityId', 'entity_id', 'EntityID']))
    .sort()
  expect(entityIds).toEqual(['ent-1', 'ent-2'])
})
