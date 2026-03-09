import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'

const webPort = process.env.MOCK_LOOM_E2E_WEB_PORT ?? '15173'
const webBaseURL = `http://127.0.0.1:${webPort}`

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
  workspaceName: string
  integrationId: string
  integrationName: string
}

async function mockNoWorkspaceFirstRun(page: Page, systemRole?: 'SUPERADMIN' | 'PLATFORM_ADMIN'): Promise<void> {
  await page.route('**/api/v1/auth/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ dummyAuth: true }),
    })
  })

  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'user-first-run',
        email: 'first-run@example.com',
        fullName: 'First Run User',
        status: 'ACTIVE',
        systemRole,
      }),
    })
  })

  await page.route('**/api/v1/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    })
  })
}

async function createRuntimeFixture(request: APIRequestContext): Promise<RuntimeFixture> {
  const suffix = uniqueSuffix()
  const workspaceName = `Spec 033 Workspace ${suffix}`
  const integrationName = `Spec 033 Integration ${suffix}`

  let response = await request.post('/api/v1/workspaces', {
    data: {
      name: workspaceName,
      slug: `spec-033-workspace-${suffix}`,
    },
  })
  let payload = await expectJSON(response, 201)
  const workspaceId = pickString(payload, ['id', 'ID'])
  expect(workspaceId).toBeTruthy()

  response = await request.post(`/api/v1/workspaces/${workspaceId}/integrations`, {
    data: {
      name: integrationName,
      slug: `spec-033-integration-${suffix}`,
      baseUrl: `https://mock.example.com/spec-033/${suffix}`,
    },
  })
  payload = await expectJSON(response, 201)
  const integrationId = pickString(payload, ['id', 'ID'])
  expect(integrationId).toBeTruthy()

  return {
    workspaceName,
    integrationId,
    integrationName,
  }
}

test('SPEC-033 workspace admin flow stays discoverable and operational', async ({ request, page }) => {
  const fixture = await createRuntimeFixture(request)
  const adminSuffix = uniqueSuffix()
  const invitedEmail = `spec-033-member-${adminSuffix}@example.com`
  const createdWorkspaceName = `Spec 033 Created ${adminSuffix}`
  const createdWorkspaceSlug = `spec-033-created-${adminSuffix}`

  await page.goto(`${webBaseURL}/login`)
  await expect(page).toHaveURL(/\/login$/)

  await page.getByRole('button', { name: 'Continue to Workspace' }).click()
  await expect(page).toHaveURL(/\/workspace$/)

  await page.getByRole('button', { name: 'Open workspace switcher' }).click()
  await page.getByPlaceholder('Search workspaces...').fill(fixture.workspaceName.slice(0, 24))
  await page.getByRole('button', { name: new RegExp(fixture.workspaceName) }).click()
  await expect(page.getByRole('button', { name: new RegExp(fixture.integrationName) })).toBeVisible()

  await page.getByRole('button', { name: 'Open global admin' }).click()
  await expect(page).toHaveURL(/\/admin\/workspaces$/)
  await expect(page.getByRole('heading', { name: 'Global Workspace Administration' })).toBeVisible()

  const createSection = page.getByRole('heading', { name: 'Create Workspace' }).locator('..').locator('..')
  await createSection.getByPlaceholder('Workspace name').fill(createdWorkspaceName)
  await createSection.getByPlaceholder('Workspace slug').fill(createdWorkspaceSlug)
  await createSection.getByPlaceholder('Description').fill('Workspace created from global admin e2e')
  await createSection
    .getByPlaceholder(/Optional metadata JSON/i)
    .fill('{\"source\":\"spec-033-global-admin\"}')
  await createSection.getByRole('button', { name: 'Create Workspace' }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  await page.getByRole('button', { name: 'Workspace admin' }).click()
  await expect(page).toHaveURL(/\/workspace\/admin$/)
  await expect(page.getByRole('heading', { name: 'Workspace Administration' })).toBeVisible()

  await page.getByPlaceholder('Description').fill('Updated by SPEC-033 test')
  await page.getByRole('button', { name: 'Save Workspace' }).click()
  await expect(page.getByText('Workspace updated successfully.')).toBeVisible()

  await page.getByPlaceholder('member@company.com').fill(invitedEmail)
  await page.getByRole('button', { name: 'Add member', exact: true }).click()
  await expect(page.getByText('Member added to workspace.')).toBeVisible()

  const invitedRow = page.locator('tr', { hasText: invitedEmail }).first()
  await expect(invitedRow).toBeVisible()

  const roleCombobox = invitedRow.getByRole('combobox').first()
  await roleCombobox.click()
  await page.getByRole('option', { name: 'ADMIN', exact: true }).click()
  await expect(page.getByText('Member role updated.')).toBeVisible()

  await invitedRow.getByRole('radio', { name: 'Active', exact: true }).click()
  await expect(page.getByText('Member status updated.')).toBeVisible()

  await page.getByRole('button', { name: 'Back to Workspace' }).click()
  await expect(page).toHaveURL(/\/workspace$/)

  await page.getByRole('button', { name: 'Open workspace switcher' }).click()
  await page.getByPlaceholder('Search workspaces...').fill(fixture.workspaceName.slice(0, 24))
  await page.getByRole('button', { name: new RegExp(fixture.workspaceName) }).click()

  await page.getByRole('button', { name: new RegExp(fixture.integrationName) }).click()
  await expect(page).toHaveURL(new RegExp(`/integrations/${fixture.integrationId}/overview`))
})

test('SPEC-033 first-run without workspace shows role-aware create workspace gate for admins', async ({ page }) => {
  await mockNoWorkspaceFirstRun(page, 'SUPERADMIN')

  await page.goto(`${webBaseURL}/login`)
  await expect(page).toHaveURL(/\/login$/)

  await page.getByRole('button', { name: 'Continue to Workspace' }).click()
  await expect(page).toHaveURL(/\/workspace$/)

  await expect(page.getByRole('heading', { name: 'No Workspace Available' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create Workspace' })).toBeVisible()
  await expect(page.getByText('Add Your First Integration')).toHaveCount(0)

  await page.getByRole('button', { name: 'Create Workspace' }).click()
  await expect(page).toHaveURL(/\/admin\/workspaces$/)
})

test('SPEC-033 first-run without workspace hides create workspace action for non-admin users', async ({ page }) => {
  await mockNoWorkspaceFirstRun(page)

  await page.goto(`${webBaseURL}/login`)
  await expect(page).toHaveURL(/\/login$/)

  await page.getByRole('button', { name: 'Continue to Workspace' }).click()
  await expect(page).toHaveURL(/\/workspace$/)

  await expect(page.getByRole('heading', { name: 'No Workspace Available' })).toBeVisible()
  await expect(page.getByText('Ask an administrator to invite you to a workspace.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create Workspace' })).toHaveCount(0)
  await expect(page.getByText('Add Your First Integration')).toHaveCount(0)
})
