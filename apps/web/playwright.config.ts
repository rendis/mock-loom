import { defineConfig } from '@playwright/test'

const apiPort = process.env.MOCK_LOOM_E2E_API_PORT ?? '18081'
const apiBaseURL = `http://127.0.0.1:${apiPort}`
const webPort = process.env.MOCK_LOOM_E2E_WEB_PORT ?? '15173'
const webBaseURL = `http://127.0.0.1:${webPort}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  reporter: 'list',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: apiBaseURL,
  },
  webServer: [
    {
      command: [
        `MOCK_LOOM_SERVER_PORT=${apiPort}`,
        "MOCK_LOOM_DB_DSN='file:spec-030-e2e.db?_pragma=foreign_keys(1)'",
        'MOCK_LOOM_BOOTSTRAP_ALLOWED_EMAILS=admin@example.com',
        'MOCK_LOOM_DUMMY_AUTH_ENABLED=true',
        'MOCK_LOOM_DUMMY_AUTH_EMAIL=admin@example.com',
        'MOCK_LOOM_DUMMY_AUTH_SUBJECT=sub-admin-e2e',
        'MOCK_LOOM_IMPORT_POSTMAN_CLI_PATH=true',
        'MOCK_LOOM_IMPORT_CURL_CLI_PATH=true',
        'go run ./cmd/server',
      ].join(' '),
      cwd: '../api',
      url: `${apiBaseURL}/health`,
      timeout: 120_000,
      reuseExistingServer: true,
    },
    {
      command: [`VITE_API_BASE_URL=${apiBaseURL}/api/v1`, `pnpm dev --host 127.0.0.1 --port ${webPort}`].join(' '),
      cwd: '.',
      url: `${webBaseURL}/login`,
      timeout: 120_000,
      reuseExistingServer: true,
    },
  ],
})
