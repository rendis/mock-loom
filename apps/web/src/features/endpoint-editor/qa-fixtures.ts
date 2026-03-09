import type { ContractState, ScenarioState, TrafficState } from '../../shared/types/ui-state'
import type { IntegrationRoute, TrafficEvent } from '../../types/api'

export interface EndpointContextFixture {
  title: string
  method: string
  path: string
  versionLabel: string
}

export interface HeaderParamFixture {
  key: string
  expectedValue: string
  required: boolean
  scope?: 'PATH' | 'HEADER' | 'QUERY'
}

export interface ContractHealthMetric {
  label: string
  value: string
  progress: number
}

export interface ScenarioFixture {
  id: string
  name: string
  priority: number
  enabled: boolean
  statusLabel: string
  conditionExpr: string
  responseStatusCode: number
  responseLatencyMs: number
  contentType: string
  responseBodyJson: string
  matcherSummary: string
  fallback?: boolean
}

export interface TrafficDetailFixture {
  requestId: string
  requestUrl: string
  method: string
  clientIp: string
  headers: Array<{ key: string; value: string }>
  bodyJson: string
  matchedBy: string[]
}

export interface BundleCFixtureSet {
  endpoint: EndpointContextFixture
  routes: IntegrationRoute[]
  headerParams: HeaderParamFixture[]
  contractJson: string
  contractState: ContractState
  contractHealth: ContractHealthMetric[]
  scenarios: ScenarioFixture[]
  scenarioState: ScenarioState
  selectedScenarioId: string
  trafficEvents: TrafficEvent[]
  trafficState: TrafficState
  trafficErrorMessage: string
  trafficDetail: TrafficDetailFixture
}

export const QA_ENDPOINT_CONTEXT: EndpointContextFixture = {
  title: 'Get User Details',
  method: 'GET',
  path: '/api/v1/users/{id}',
  versionLabel: 'v2.4.0 (Beta)',
}

export const QA_ROUTES: IntegrationRoute[] = [
  { id: 'qa-c-1', packId: 'qa-pack', method: 'GET', path: '/api/v1/users/{id}' },
  { id: 'qa-c-2', packId: 'qa-pack', method: 'POST', path: '/api/v1/users' },
  { id: 'qa-c-3', packId: 'qa-pack', method: 'PUT', path: '/api/v1/users/{id}' },
]

export const QA_HEADER_PARAMS: HeaderParamFixture[] = [
  { key: 'Authorization', expectedValue: 'Bearer {token}', required: true, scope: 'HEADER' },
  { key: 'Accept', expectedValue: 'application/json', required: true, scope: 'HEADER' },
  { key: 'locale', expectedValue: 'es-CL', required: false, scope: 'QUERY' },
]

export const QA_CONTRACT_JSON = `{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid",
      "example": "123e4567-e89b-12d3-a456-426614174000"
    },
    "username": {
      "type": "string",
      "minLength": 3,
      "example": "jdoe_designer"
    },
    "email": {
      "type": "string",
      "format": "email",
      "example": "john.doe@example.com"
    },
    "role": {
      "type": "string",
      "enum": ["admin", "editor", "viewer"],
      "default": "viewer"
    },
    "last_login": {
      "type": "string",
      "format": "date-time"
    },
    "preferences": {
      "type": "object",
      "properties": {
        "notifications": { "type": "boolean" },
        "theme": { "type": "string" }
      }
    }
  },
  "required": ["id", "username", "email", "role"]
}`

export const QA_CONTRACT_HEALTH: ContractHealthMetric[] = [
  { label: 'Schema validity', value: '100%', progress: 100 },
  { label: 'Mock usage (24h)', value: '1,240 calls', progress: 70 },
]

export const QA_SCENARIOS: ScenarioFixture[] = [
  {
    id: 'qa-s-1',
    name: 'Admin Access',
    priority: 10,
    enabled: true,
    statusLabel: '200 OK',
    conditionExpr: 'request.header.X_Role == "Admin"',
    responseStatusCode: 200,
    responseLatencyMs: 150,
    contentType: 'application/json',
    responseBodyJson: `{
  "user": {
    "id": "usr_12345",
    "role": "admin",
    "permissions": ["read", "write", "delete"],
    "meta": {
      "last_login": "2026-03-03T10:00:00Z"
    }
  }
}`,
    matcherSummary: 'Header: X-Role = Admin',
  },
  {
    id: 'qa-s-2',
    name: 'Standard User',
    priority: 20,
    enabled: false,
    statusLabel: '200 OK',
    conditionExpr: 'request.header.X_Role == "User"',
    responseStatusCode: 200,
    responseLatencyMs: 120,
    contentType: 'application/json',
    responseBodyJson: '{\n  "role": "user"\n}',
    matcherSummary: 'Header: X-Role = User',
  },
  {
    id: 'qa-s-3',
    name: 'Rate Limited',
    priority: 30,
    enabled: true,
    statusLabel: '429 Too Many Requests',
    conditionExpr: 'startsWith(request.path, "/api/v1/private")',
    responseStatusCode: 429,
    responseLatencyMs: 200,
    contentType: 'application/json',
    responseBodyJson: '{\n  "error": "rate_limit"\n}',
    matcherSummary: 'Path startsWith /api/v1/private',
  },
  {
    id: 'qa-s-fallback',
    name: 'Fallback Response',
    priority: 40,
    enabled: true,
    statusLabel: '404 Not Found',
    conditionExpr: 'true',
    responseStatusCode: 404,
    responseLatencyMs: 60,
    contentType: 'application/json',
    responseBodyJson: '{\n  "error": "not_found"\n}',
    matcherSummary: 'Catch-all',
    fallback: true,
  },
]

export const QA_TRAFFIC_EVENTS: TrafficEvent[] = [
  {
    id: 'qa-t-1',
    integrationId: 'qa-int',
    endpointId: 'qa-c-1',
    requestSummaryJson: '{"method":"GET","path":"/api/v1/users/u_9921","status":"200 OK","scenario":"Standard User Profile"}',
    matchedScenario: 'Standard User Profile',
    createdAt: '10:42:05.230',
  },
  {
    id: 'qa-t-2',
    integrationId: 'qa-int',
    endpointId: 'qa-c-1',
    requestSummaryJson: '{"method":"POST","path":"/api/v1/auth/login","status":"401 Unauth","scenario":"Invalid Credentials"}',
    matchedScenario: 'Invalid Credentials',
    createdAt: '10:42:04.890',
  },
  {
    id: 'qa-t-3',
    integrationId: 'qa-int',
    endpointId: 'qa-c-1',
    requestSummaryJson: '{"method":"GET","path":"/api/v1/products?limit=50","status":"200 OK","scenario":"All Products List"}',
    matchedScenario: 'All Products List',
    createdAt: '10:41:58.112',
  },
  {
    id: 'qa-t-4',
    integrationId: 'qa-int',
    endpointId: 'qa-c-1',
    requestSummaryJson: '{"method":"PUT","path":"/api/v1/settings/notifications","status":"202 Pending","scenario":"Async Update"}',
    matchedScenario: 'Async Update',
    createdAt: '10:41:55.402',
  },
  {
    id: 'qa-t-5',
    integrationId: 'qa-int',
    endpointId: 'qa-c-1',
    requestSummaryJson: '{"method":"PATCH","path":"/api/v1/inventory/sku-1029","status":"404 Not Found","scenario":"Fallback (Default)"}',
    matchedScenario: 'Fallback (Default)',
    createdAt: '10:41:52.001',
  },
]

export const QA_TRAFFIC_DETAIL: TrafficDetailFixture = {
  requestId: 'req_882910aa-b2',
  requestUrl: 'https://api.mockengine.io/api/v1/users/u_9921',
  method: 'GET',
  clientIp: '203.0.113.42',
  headers: [
    { key: 'Authorization', value: 'Bearer eyJhbGciOiJIUzI1NiIsIn...' },
    { key: 'Content-Type', value: 'application/json' },
    { key: 'User-Agent', value: 'PostmanRuntime/7.29.2' },
    { key: 'Accept', value: '*/*' },
  ],
  bodyJson: `{
  "filters": {
    "include_archived": false,
    "role": "admin"
  },
  "context": "dashboard_view"
}`,
  matchedBy: ['Method == GET', 'Path ~= /users/*'],
}

export function buildBundleCFixtureSet(): BundleCFixtureSet {
  return {
    endpoint: QA_ENDPOINT_CONTEXT,
    routes: QA_ROUTES,
    headerParams: QA_HEADER_PARAMS,
    contractJson: QA_CONTRACT_JSON,
    contractState: 'valid',
    contractHealth: QA_CONTRACT_HEALTH,
    scenarios: QA_SCENARIOS,
    scenarioState: 'ready',
    selectedScenarioId: 'qa-s-1',
    trafficEvents: QA_TRAFFIC_EVENTS,
    trafficState: 'streaming',
    trafficErrorMessage: 'Traffic stream connection interrupted. Please retry.',
    trafficDetail: QA_TRAFFIC_DETAIL,
  }
}
