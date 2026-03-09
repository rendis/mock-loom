import { describe, expect, it } from 'vitest'

import { routeExprCompletion } from './context-router'

describe('expr context router', () => {
  const isKnownLeafPath = (path: string): boolean =>
    [
      'request.path',
      'request.params.path.id',
      'request.params.headers.authorization',
      'source.users.email',
      'source.users.active',
    ].includes(path)

  const canonicalizePath = (path: string): string =>
    path
      .replace(/^request\.header/, 'request.params.headers')
      .replace(/^request\.query/, 'request.params.query')
      .replace(/^request\.body/, 'request.params.body')

  it('routes request.param alias and request scopes', () => {
    expect(
      routeExprCompletion({
        prefix: 'request.param.',
        invokedManually: false,
        isKnownLeafPath,
        canonicalizePath,
      }).state
    ).toBe('REQUEST_PARAM_ALIAS')

    const route = routeExprCompletion({
      prefix: 'request.params.path.',
      invokedManually: false,
      isKnownLeafPath,
      canonicalizePath,
    })
    expect(route.state).toBe('REQUEST_SCOPE')
    expect(route.scope).toBe('path')
  })

  it('routes source root and slug', () => {
    expect(
      routeExprCompletion({
        prefix: 'source.',
        invokedManually: false,
        isKnownLeafPath,
        canonicalizePath,
      }).state
    ).toBe('SOURCE_ROOT')

    const route = routeExprCompletion({
      prefix: 'source.users.',
      invokedManually: false,
      isKnownLeafPath,
      canonicalizePath,
    })
    expect(route.state).toBe('SOURCE_SLUG')
    expect(route.slug).toBe('users')
  })

  it('routes request legacy scopes on manual invoke without trailing dot', () => {
    const route = routeExprCompletion({
      prefix: 'request.header',
      invokedManually: true,
      isKnownLeafPath,
      canonicalizePath,
    })

    expect(route.state).toBe('REQUEST_SCOPE')
    expect(route.scope).toBe('headers')
  })

  it('routes source.<slug> without trailing dot to slug fields on manual invoke', () => {
    const route = routeExprCompletion({
      prefix: 'source.users',
      invokedManually: true,
      isKnownLeafPath,
      canonicalizePath,
    })

    expect(route.state).toBe('SOURCE_SLUG')
    expect(route.slug).toBe('users')
  })

  it('routes leaf operations for trailing dot and ctrl+space invocation', () => {
    expect(
      routeExprCompletion({
        prefix: 'request.path.',
        invokedManually: false,
        isKnownLeafPath,
        canonicalizePath,
      }).state
    ).toBe('LEAF_VALUE')

    expect(
      routeExprCompletion({
        prefix: 'request.path',
        invokedManually: true,
        isKnownLeafPath,
        canonicalizePath,
      }).state
    ).toBe('LEAF_VALUE')
  })
})
