import { describe, expect, it } from 'vitest'

import { buildCompletionContext, createCompletionProvider, enrichCompletionContextTypes } from './completion-provider'

describe('completion provider v2', () => {
  it('builds canonical fallback request roots when runtime context is missing', () => {
    const context = buildCompletionContext(null)
    const provider = createCompletionProvider(context)

    const roots = provider.rootSuggestions('', 20).map((item) => item.label)
    expect(roots).toContain('request.param.')
    expect(roots).toContain('source.')
    const sourceRoot = provider.rootSuggestions('', 20).find((item) => item.label === 'source.')
    expect(sourceRoot?.detail).toContain('none active')
    expect(provider.requestChildren('request')).toEqual(expect.arrayContaining(['method', 'path', 'params']))
  })

  it('provides unified request.param entries with duplicate keys across scopes', () => {
    const provider = createCompletionProvider(
      buildCompletionContext({
        requestPaths: ['request.params.path.id', 'request.params.query.id', 'request.params.headers.authorization'],
        sourcePaths: [],
        functions: [],
        templatePaths: [],
      })
    )

    const values = provider.requestParamSuggestions('id', 10)
    expect(values).toEqual(
      expect.arrayContaining([
        { key: 'id', scope: 'PATH', canonicalPath: 'request.params.path.id', valueType: 'unknown' },
        { key: 'id', scope: 'QUERY', canonicalPath: 'request.params.query.id', valueType: 'unknown' },
      ])
    )
  })

  it('returns scope-specific request params without cross-scope pollution', () => {
    const provider = createCompletionProvider(
      buildCompletionContext({
        requestPaths: ['request.params.path.id', 'request.params.query.name', 'request.params.query.page'],
        sourcePaths: [],
        functions: [],
        templatePaths: [],
      })
    )

    expect(provider.requestScopeSuggestions('path', '', 20).map((item) => item.key)).toEqual(['id'])
    expect(provider.requestScopeSuggestions('query', '', 20).map((item) => item.key)).toEqual(['name', 'page'])
  })

  it('returns runtime-driven source slug and field suggestions', () => {
    const provider = createCompletionProvider(
      buildCompletionContext({
        requestPaths: [],
        sourcePaths: ['source.wallets', 'source.wallets.id', 'source.wallets.balance', 'source.users.id'],
        functions: [],
        templatePaths: [],
      })
    )

    expect(provider.sourceSlugSuggestions('wal', 10)).toEqual(['wallets'])
    expect(provider.sourceFieldSuggestions('wallets', 'ba', 10)).toEqual(['balance'])
    const sourceRoot = provider.rootSuggestions('', 20).find((item) => item.label === 'source.')
    expect(sourceRoot?.detail).toContain('(2)')
  })

  it('uses enriched type maps for leaf operator selection', () => {
    const context = enrichCompletionContextTypes(
      buildCompletionContext({
        requestPaths: ['request.params.body.active'],
        sourcePaths: ['source.users.active'],
        functions: [],
        templatePaths: [],
      }),
      {
        requestFieldTypes: {
          'request.params.body.active': 'boolean',
        },
        sourceFieldTypes: {
          'source.users.active': 'boolean',
        },
      }
    )

    const provider = createCompletionProvider(context)
    const operators = provider.leafOperatorSuggestions('request.params.body.active', true).map((item) => item.label)
    expect(operators).toEqual(expect.arrayContaining(['==', '!=']))
  })

  it('canonicalizes request aliases and source by-id paths', () => {
    const provider = createCompletionProvider(buildCompletionContext(null))

    expect(provider.canonicalizePath('request.header.authorization')).toBe('request.params.headers.authorization')
    expect(provider.canonicalizePath('source.users_by_id[request.params.path.id].email')).toBe('source.users.email')
  })
})
