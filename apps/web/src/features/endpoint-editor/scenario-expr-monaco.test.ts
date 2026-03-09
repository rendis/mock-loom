import { describe, expect, it } from 'vitest'

import { buildCompletionContext, createCompletionProvider } from './completion-provider'
import { scenarioExprMonacoInternals } from './scenario-expr-monaco'

describe('scenario expr monaco routing', () => {
  const provider = createCompletionProvider(
    buildCompletionContext({
      requestPaths: [
        'request.path',
        'request.method',
        'request.params.path.id',
        'request.params.query.name',
        'request.params.headers.authorization',
      ],
      sourcePaths: ['source.users', 'source.users.id', 'source.users.email'],
      functions: [],
      templatePaths: [],
    })
  )

  it('routes request.param alias context', () => {
    const route = scenarioExprMonacoInternals.routeExprCompletion({
      prefix: 'request.param.i',
      invokedManually: true,
      isKnownLeafPath: provider.isKnownLeafPath,
      canonicalizePath: provider.canonicalizePath,
    })

    expect(route.state).toBe('REQUEST_PARAM_ALIAS')
    expect(route.query).toBe('i')
  })

  it('routes request scope context and maps scope correctly', () => {
    const route = scenarioExprMonacoInternals.routeExprCompletion({
      prefix: 'request.params.path.',
      invokedManually: false,
      isKnownLeafPath: provider.isKnownLeafPath,
      canonicalizePath: provider.canonicalizePath,
    })

    expect(route.state).toBe('REQUEST_SCOPE')
    expect(route.scope).toBe('path')
  })

  it('routes source root and source slug contexts', () => {
    const sourceRootRoute = scenarioExprMonacoInternals.routeExprCompletion({
      prefix: 'source.',
      invokedManually: false,
      isKnownLeafPath: provider.isKnownLeafPath,
      canonicalizePath: provider.canonicalizePath,
    })

    const sourceSlugRoute = scenarioExprMonacoInternals.routeExprCompletion({
      prefix: 'source.users.',
      invokedManually: false,
      isKnownLeafPath: provider.isKnownLeafPath,
      canonicalizePath: provider.canonicalizePath,
    })

    expect(sourceRootRoute.state).toBe('SOURCE_ROOT')
    expect(sourceSlugRoute.state).toBe('SOURCE_SLUG')
    expect(sourceSlugRoute.slug).toBe('users')
  })

  it('routes leaf operator context for trailing-dot and manual invoke', () => {
    const trailingDotRoute = scenarioExprMonacoInternals.routeExprCompletion({
      prefix: 'request.params.path.id.',
      invokedManually: false,
      isKnownLeafPath: provider.isKnownLeafPath,
      canonicalizePath: provider.canonicalizePath,
    })

    const manualInvokeRoute = scenarioExprMonacoInternals.routeExprCompletion({
      prefix: 'request.path',
      invokedManually: true,
      isKnownLeafPath: provider.isKnownLeafPath,
      canonicalizePath: provider.canonicalizePath,
    })

    expect(trailingDotRoute.state).toBe('LEAF_VALUE')
    expect(trailingDotRoute.targetPath).toBe('request.params.path.id')
    expect(manualInvokeRoute.state).toBe('LEAF_VALUE')
    expect(manualInvokeRoute.targetPath).toBe('request.path')
  })

  it('routes root context on empty line invoke', () => {
    const route = scenarioExprMonacoInternals.routeExprCompletion({
      prefix: '',
      invokedManually: true,
      isKnownLeafPath: provider.isKnownLeafPath,
      canonicalizePath: provider.canonicalizePath,
    })

    expect(route.state).toBe('ROOT')
  })

  it('does not fallback to root for scope-specific contexts with empty results', () => {
    expect(scenarioExprMonacoInternals.shouldFallbackToRoot('REQUEST_SCOPE', true)).toBe(false)
    expect(scenarioExprMonacoInternals.shouldFallbackToRoot('REQUEST_SCOPE', false)).toBe(false)
    expect(scenarioExprMonacoInternals.shouldFallbackToRoot('ROOT', false)).toBe(true)
    expect(scenarioExprMonacoInternals.shouldFallbackToRoot('UNKNOWN', true)).toBe(true)
    expect(scenarioExprMonacoInternals.shouldFallbackToRoot('UNKNOWN', false)).toBe(false)
  })
})
