import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { fileURLToPath } from 'node:url'

import { assertNoDirectPrivateRouteGoto } from './helpers/navigation-contract'

const webPort = process.env.MOCK_LOOM_E2E_WEB_PORT ?? '15173'
const webBaseURL = `http://127.0.0.1:${webPort}`
const currentSpecFilePath = fileURLToPath(import.meta.url)

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`
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

interface RuntimeFixture {
  workspaceId: string
  workspaceName: string
  integrationId: string
  integrationName: string
  packId: string
  packName: string
  sourceId: string
}

async function createRuntimeFixture(request: APIRequestContext): Promise<RuntimeFixture> {
  const suffix = uniqueSuffix()
  const workspaceName = `Spec 031 Workspace ${suffix}`
  const integrationName = `Spec 031 Integration ${suffix}`
  const packName = 'Navigation Pack'

  let response = await request.post('/api/v1/workspaces', {
    data: {
      name: workspaceName,
      slug: `spec-031-workspace-${suffix}`,
    },
  })
  let payload = await expectJSON(response, 201)
  const workspaceId = pickString(payload, ['id', 'ID'])
  expect(workspaceId).toBeTruthy()

  response = await request.post(`/api/v1/workspaces/${workspaceId}/integrations`, {
    data: {
      name: integrationName,
      slug: `spec-031-integration-${suffix}`,
      baseUrl: `https://mock.example.com/spec-031/${suffix}`,
    },
  })
  payload = await expectJSON(response, 201)
  const integrationId = pickString(payload, ['id', 'ID'])
  expect(integrationId).toBeTruthy()

  response = await request.post(`/api/v1/integrations/${integrationId}/data-sources`, {
    data: {
      name: 'Navigation Users',
      slug: 'navigation-users',
      kind: 'JSON',
    },
  })
  payload = await expectJSON(response, 201)
  const sourceId = pickString(payload, ['id', 'ID'])
  expect(sourceId).toBeTruthy()

  response = await request.post(`/api/v1/integrations/${integrationId}/data-sources/${sourceId}/baseline`, {
    multipart: {
      file: {
        name: 'navigation-users.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify([
            { id: 'ENT-9001', email: 'alpha@example.com', status: 'ACTIVE' },
            { id: 'ENT-9002', email: 'beta@example.com', status: 'ACTIVE' },
          ])
        ),
      },
    },
  })
  payload = await expectJSON(response, 200)
  expect(payload.recordCount).toBe(2)

  response = await request.post(`/api/v1/integrations/${integrationId}/packs`, {
    data: {
      name: packName,
      slug: `spec-031-pack-${suffix}`,
      basePath: '/api',
    },
  })
  payload = await expectJSON(response, 201)
  const packId = pickString(payload, ['id', 'ID'])
  expect(packId).toBeTruthy()

  response = await request.post(`/api/v1/integrations/${integrationId}/packs/${packId}/imports`, {
    data: {
      sourceType: 'OPENAPI',
      payload: `openapi: 3.0.3
info:
  title: spec-031
  version: 1.0.0
paths:
  /users:
    get:
      responses:
        "200":
          description: ok
`,
    },
  })
  await expectJSON(response, 200)

  return {
    workspaceId,
    workspaceName,
    integrationId,
    integrationName,
    packId,
    packName,
    sourceId,
  }
}

test('SPEC-031 click-only private navigation remains discoverable', async ({ request, page }) => {
  assertNoDirectPrivateRouteGoto(currentSpecFilePath)
  const fixture = await createRuntimeFixture(request)

  await page.goto(`${webBaseURL}/login`)
  await expect(page).toHaveURL(/\/login$/)

  await page.getByRole('button', { name: 'Continue to Workspace' }).click()
  await expect(page).toHaveURL(/\/workspace$/)

  await page.getByRole('button', { name: 'Open workspace switcher' }).click()
  await page.getByRole('button', { name: new RegExp(fixture.workspaceName) }).click()
  await expect(page.locator('aside')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Integration selector' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: new RegExp(fixture.integrationName) })).toBeVisible()

  await page.getByRole('button', { name: new RegExp(fixture.integrationName) }).click()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/overview`))
  await expect(page.getByRole('button', { name: 'Open workspace switcher' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to workspace home' })).toBeVisible()

  await page.getByRole('link', { name: 'Packs' }).click()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/packs`))
  await expect(page.getByRole('heading', { name: 'Packs' })).toBeVisible()

  const modalPackName = `UI Pack ${uniqueSuffix()}`
  const modalPackSlug = `ui-pack-${uniqueSuffix()}`
  await page.getByRole('button', { name: '+ New Pack' }).click()
  const packModal = page.getByRole('dialog', { name: 'New Pack' })
  await expect(packModal).toBeVisible()
  await packModal.getByLabel('Pack name').fill(modalPackName)
  await packModal.getByLabel('Pack slug').fill(modalPackSlug)
  await packModal.locator('[aria-label=\"Pack base path\"] input').first().fill('/api/v2/:tenantId')
  await packModal.getByRole('button', { name: 'Create Pack' }).click()
  await expect(packModal).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/packs/.+`))

  await page.getByRole('link', { name: 'Packs' }).click()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/packs$`))

  const createdPackCard = page.locator('article', { hasText: modalPackName })
  await expect(createdPackCard).toBeVisible()
  await createdPackCard.getByRole('button', { name: 'Edit pack' }).click()
  const editPackModal = page.getByRole('dialog', { name: 'Edit Pack' })
  await expect(editPackModal).toBeVisible()
  await editPackModal.getByRole('switch', { name: 'Pack auth enabled' }).click()
  await editPackModal.getByRole('radio', { name: 'Custom Expr', exact: true }).click()
  await editPackModal.getByLabel('Pack custom auth expression').fill("auth.email == 'qa@example.com'")
  await editPackModal.getByRole('button', { name: 'Save Pack' }).click()
  await expect(editPackModal).toBeHidden()

  await createdPackCard.getByRole('button', { name: 'Open pack' }).click()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/packs/`))
  const newEndpointButton = page.getByRole('button', { name: '+ New Endpoint' }).first()
  await expect(newEndpointButton).toBeVisible()

  await newEndpointButton.click()
  const newEndpointDialog = page.getByRole('dialog', { name: 'New Endpoint' })
  await expect(newEndpointDialog).toBeVisible()
  await expect(newEndpointDialog.getByLabel('Pack base path prefix')).toHaveText('/api/v2/:tenantid')
  await newEndpointDialog.getByLabel('Endpoint method').click()
  await page.getByRole('option', { name: 'POST', exact: true }).click()
  await newEndpointDialog.locator('[aria-label=\"Endpoint relative path\"] input').first().fill('/orders/:orderId')
  await newEndpointDialog.getByRole('button', { name: 'Create Endpoint' }).click()
  await expect(newEndpointDialog).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/packs/.*/endpoints/`))
  await expect(page.getByText('/api/v2/:tenantid/orders/:orderid')).toBeVisible()
  await page.getByLabel('Endpoint method').first().click()
  await page.getByRole('option', { name: 'PUT', exact: true }).click()
  await page.locator('[aria-label=\"Endpoint relative path\"] input').first().fill('/orders/:orderId/items/:itemId')
  await page.getByRole('button', { name: 'Save Route' }).click()
  await expect(page.getByText('/api/v2/:tenantid/orders/:orderid/items/:itemid')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Validate' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible()
  await page.getByRole('button', { name: 'Validate' }).click()
  await page.getByRole('button', { name: 'Publish' }).click()

  await page.getByRole('button', { name: 'Scenarios' }).click()
  await expect(page.getByRole('heading', { name: 'Scenario Editor' })).toBeVisible()

  await page.getByRole('button', { name: 'Traffic' }).click()
  await expect(page.getByRole('heading', { name: 'Event Stream' })).toBeVisible()

  await page.getByRole('button', { name: 'Contract' }).click()
  await expect(page.getByRole('heading', { name: 'Response Schema Definition' })).toBeVisible()

  await page.getByRole('link', { name: 'Data Sources' }).click()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/data-sources`))
  await expect(page.getByRole('heading', { name: 'Baseline Upload' })).toBeVisible()
  await expect(page.getByLabel('Schema type for status')).toBeVisible()
  await page.getByLabel('Schema type for status').click()
  await page.getByRole('option', { name: 'boolean', exact: true }).click()
  await page.getByRole('button', { name: 'Save schema' }).click()
  await expect(page.getByText('Schema updated.')).toBeVisible()
  await expect(page.getByText('Type mismatches detected in current records.')).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/data-sources`))
  await expect(page.getByLabel('Schema type for status')).toContainText('boolean')

  await page.getByRole('link', { name: 'Debugger' }).click()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/data-debugger`))
  await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible()

  await page.getByRole('button', { name: 'Revert to this state' }).first().click()
  const rollbackModal = page.getByRole('heading', { name: 'Confirm State Rollback' })
  await expect(rollbackModal).toBeVisible()

  const rollbackOpenURL = page.url()
  await page.goBack()
  await expect(rollbackModal).toBeHidden()
  await expect(page).toHaveURL(rollbackOpenURL)

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/data-sources`))
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/data-debugger`))

  await page.getByRole('link', { name: 'Session Logs' }).click()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/session-logs`))

  await page.getByRole('link', { name: 'Entity Map' }).click()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/entity-map`))

  await page.getByRole('link', { name: 'Audit' }).click()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/audit-history`))

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/entity-map`))
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/audit-history`))

  await page.getByRole('link', { name: 'Overview' }).click()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/overview`))

  await page.getByRole('button', { name: 'Open Data Sources' }).click()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/data-sources`))
  await expect(page.getByRole('heading', { name: 'Baseline Upload' })).toBeVisible()
})
