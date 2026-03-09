export const ENDPOINT_ROUTE_SENTINEL = '__new__'

export const APP_ROUTES = {
  root: '/',
  login: '/login',
  workspace: '/workspace',
  workspaceAdmin: '/workspace/admin',
  globalWorkspaceAdmin: '/admin/workspaces',
  overview: '/integrations/:integrationId/overview',
  packs: '/integrations/:integrationId/packs',
  pack: '/integrations/:integrationId/packs/:packId',
  packEndpoint: '/integrations/:integrationId/packs/:packId/endpoints/:endpointId',
  dataSources: '/integrations/:integrationId/data-sources',
  dataDebugger: '/integrations/:integrationId/data-debugger',
  sessionLogs: '/integrations/:integrationId/session-logs',
  entityMap: '/integrations/:integrationId/entity-map',
  auditHistory: '/integrations/:integrationId/audit-history',
} as const

export function packsRoute(integrationId: string): string {
  return `/integrations/${integrationId}/packs`
}

export function packRoute(integrationId: string, packId: string): string {
  return `/integrations/${integrationId}/packs/${packId}`
}

export function packEndpointRoute(integrationId: string, packId: string, endpointId: string): string {
  const resolvedEndpointId = endpointId.trim()
  if (resolvedEndpointId === '') {
    throw new Error('endpointId is required for pack endpoint route')
  }
  return `/integrations/${integrationId}/packs/${packId}/endpoints/${resolvedEndpointId}`
}

export function overviewRoute(integrationId: string): string {
  return `/integrations/${integrationId}/overview`
}

export function dataSourcesRoute(integrationId: string): string {
  return `/integrations/${integrationId}/data-sources`
}

export function dataDebuggerRoute(integrationId: string): string {
  return `/integrations/${integrationId}/data-debugger`
}

export function sessionLogsRoute(integrationId: string): string {
  return `/integrations/${integrationId}/session-logs`
}

export function entityMapRoute(integrationId: string): string {
  return `/integrations/${integrationId}/entity-map`
}

export function auditHistoryRoute(integrationId: string): string {
  return `/integrations/${integrationId}/audit-history`
}
