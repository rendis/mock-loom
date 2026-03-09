import { describe, expect, it } from 'vitest'

import { APP_ROUTES, packEndpointRoute, packRoute, packsRoute, sessionLogsRoute } from './paths'

describe('app route contract', () => {
  it('defines dedicated login route', () => {
    expect(APP_ROUTES.login).toBe('/login')
  })

  it('defines dedicated workspace admin route', () => {
    expect(APP_ROUTES.workspaceAdmin).toBe('/workspace/admin')
  })

  it('defines dedicated global workspace admin route', () => {
    expect(APP_ROUTES.globalWorkspaceAdmin).toBe('/admin/workspaces')
  })

  it('uses mandatory pack route params', () => {
    expect(APP_ROUTES.packs).toBe('/integrations/:integrationId/packs')
    expect(APP_ROUTES.pack).toBe('/integrations/:integrationId/packs/:packId')
    expect(APP_ROUTES.packEndpoint).toBe('/integrations/:integrationId/packs/:packId/endpoints/:endpointId')
  })

  it('builds pack route', () => {
    expect(packsRoute('int-1')).toBe('/integrations/int-1/packs')
    expect(packRoute('int-1', 'pack-9')).toBe('/integrations/int-1/packs/pack-9')
  })

  it('throws when endpoint id is empty', () => {
    expect(() => packEndpointRoute('int-1', 'pack-9', '')).toThrowError('endpointId is required for pack endpoint route')
  })

  it('builds pack endpoint route with explicit endpoint id', () => {
    expect(packEndpointRoute('int-1', 'pack-9', 'ep-42')).toBe('/integrations/int-1/packs/pack-9/endpoints/ep-42')
  })

  it('builds session logs route', () => {
    expect(sessionLogsRoute('int-1')).toBe('/integrations/int-1/session-logs')
  })
})
