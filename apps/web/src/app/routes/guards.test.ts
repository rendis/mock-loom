import { describe, expect, it } from 'vitest'

import { resolveFallbackRedirect, resolveLoginRedirect, resolveRootRedirect } from './guards'
import { APP_ROUTES } from './paths'

describe('route guards', () => {
  it('redirects unauthenticated root to login', () => {
    expect(resolveRootRedirect(null)).toBe(APP_ROUTES.login)
  })

  it('redirects authenticated root to workspace', () => {
    expect(resolveRootRedirect('token')).toBe(APP_ROUTES.workspace)
  })

  it('redirects authenticated login route to workspace', () => {
    expect(resolveLoginRedirect('token')).toBe(APP_ROUTES.workspace)
  })

  it('keeps unauthenticated login route on login', () => {
    expect(resolveLoginRedirect(null)).toBe(APP_ROUTES.login)
  })

  it('redirects unauthenticated private wildcard to login', () => {
    expect(resolveFallbackRedirect(null)).toBe(APP_ROUTES.login)
  })
})
