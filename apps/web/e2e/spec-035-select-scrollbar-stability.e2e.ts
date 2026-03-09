import { expect, test, type APIRequestContext, type APIResponse, type Locator, type Page } from '@playwright/test'
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
  integrationId: string
}

async function createRuntimeFixture(request: APIRequestContext): Promise<RuntimeFixture> {
  const suffix = uniqueSuffix()

  let response = await request.post('/api/v1/workspaces', {
    data: {
      name: `Spec 035 Workspace ${suffix}`,
      slug: `spec-035-workspace-${suffix}`,
    },
  })
  let payload = await expectJSON(response, 201)
  const workspaceId = pickString(payload, ['id', 'ID'])
  expect(workspaceId).toBeTruthy()

  response = await request.post(`/api/v1/workspaces/${workspaceId}/integrations`, {
    data: {
      name: `Spec 035 Integration ${suffix}`,
      slug: `spec-035-integration-${suffix}`,
      baseUrl: `https://mock.example.com/spec-035/${suffix}`,
    },
  })
  payload = await expectJSON(response, 201)
  const integrationId = pickString(payload, ['id', 'ID'])
  expect(integrationId).toBeTruthy()

  response = await request.post(`/api/v1/integrations/${integrationId}/data-sources`, {
    data: {
      name: 'Spec 035 Source',
      slug: 'spec-035-source',
      kind: 'JSON',
    },
  })
  await expectJSON(response, 201)

  return { integrationId }
}

async function findRightmostVisibleCombobox(page: Page): Promise<Locator> {
  const comboboxes = page.locator("[role='combobox']")
  const count = await comboboxes.count()
  let bestIndex = -1
  let bestRightEdge = Number.NEGATIVE_INFINITY

  for (let index = 0; index < count; index += 1) {
    const candidate = comboboxes.nth(index)
    if (!(await candidate.isVisible())) {
      continue
    }
    const box = await candidate.boundingBox()
    if (!box) {
      continue
    }
    const rightEdge = box.x + box.width
    if (rightEdge > bestRightEdge) {
      bestRightEdge = rightEdge
      bestIndex = index
    }
  }

  if (bestIndex < 0) {
    throw new Error('No visible combobox found in viewport')
  }

  return comboboxes.nth(bestIndex)
}

test('SPEC-035 select open-state keeps body scrollbar stable and cleans up markers', async ({ request, page }) => {
  assertNoDirectPrivateRouteGoto(currentSpecFilePath)
  const fixture = await createRuntimeFixture(request)

  await page.goto(`${webBaseURL}/login`)
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole('button', { name: 'Continue to Workspace' }).click()
  await expect(page).toHaveURL(/\/workspace$/)

  await page.getByRole('button', { name: /Spec 035 Integration/ }).click()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/overview`))
  await page.getByRole('link', { name: 'Data Sources' }).click()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/data-sources`))
  await page.locator('button:has-text("New Data Source"):visible').first().click()

  const body = page.locator('body')
  const html = page.locator('html')
  const sourceTypeSelect = await findRightmostVisibleCombobox(page)

  await expect(body).not.toHaveAttribute('data-select-open', 'true')
  await expect(html).not.toHaveAttribute('data-select-open', 'true')

  await sourceTypeSelect.click()
  await expect(body).toHaveAttribute('data-select-open', 'true')
  await expect(html).toHaveAttribute('data-select-open', 'true')
  await expect(body).toHaveAttribute('data-scroll-locked', /[1-9]/)
  await expect(page.getByRole('listbox')).toBeVisible()

  const openStateMetrics = await page.evaluate(() => {
    const styles = getComputedStyle(document.body)
    return {
      overflowY: styles.overflowY,
      marginRight: styles.marginRight,
      paddingRight: styles.paddingRight,
      rightGap: Math.abs(window.innerWidth - document.body.getBoundingClientRect().right),
    }
  })

  expect(openStateMetrics.overflowY).toBe('scroll')
  expect(openStateMetrics.marginRight).toBe('0px')
  expect(openStateMetrics.paddingRight).toBe('0px')
  expect(openStateMetrics.rightGap).toBeLessThanOrEqual(1)

  await page.getByRole('option').first().click()
  await expect(body).not.toHaveAttribute('data-select-open', 'true')
  await expect(html).not.toHaveAttribute('data-select-open', 'true')

  const closedStateRightGap = await page.evaluate(() => Math.abs(window.innerWidth - document.body.getBoundingClientRect().right))
  expect(closedStateRightGap).toBeLessThanOrEqual(1)

  await sourceTypeSelect.click()
  await expect(body).toHaveAttribute('data-select-open', 'true')
  await expect(html).toHaveAttribute('data-select-open', 'true')
  await page.keyboard.press('Escape')
  await expect(body).not.toHaveAttribute('data-select-open', 'true')
  await expect(html).not.toHaveAttribute('data-select-open', 'true')
})
