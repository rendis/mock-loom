import {
  buildExprAssistCatalog,
  canonicalizeLookupPath,
  canonicalizeRequestPath,
  type ExprAssistCatalogV2,
  type ExprAssistContextV2,
  type ExprValueType,
  type RequestParamCatalogItem,
  type RequestParamScope,
  normalizeSuggestions,
  requestScopePrefix,
  scopeLabel,
  searchByPrefixThenContains,
} from './catalog'

export interface ExprCompletionRootItem {
  label: string
  detail: string
  insertText: string
}

export interface LeafOperatorItem {
  label: string
  detail: string
  insertText: string
  sortRank: string
}

export interface ExprCompletionEngineV2 {
  fieldSuggestions: (query: string, limit?: number) => string[]
  sourceSlugs: () => string[]
  sourceSlugSuggestions: (query: string, limit?: number) => string[]
  sourceFieldSuggestions: (slug: string, query?: string, limit?: number) => string[]
  requestParamSuggestions: (query: string, limit?: number) => RequestParamCatalogItem[]
  requestScopeSuggestions: (scope: RequestParamScope, query?: string, limit?: number) => RequestParamCatalogItem[]
  requestChildren: (path: string) => string[]
  sourceChildren: (path: string) => string[]
  rootSuggestions: (query?: string, limit?: number) => ExprCompletionRootItem[]
  isKnownLeafPath: (path: string) => boolean
  canonicalizePath: (path: string) => string
  valueTypeOf: (path: string) => ExprValueType
  leafOperatorSuggestions: (path: string, useChainPrefix: boolean) => LeafOperatorItem[]
}

const ROOT_ITEMS_STATIC: Omit<ExprCompletionRootItem, 'detail'>[] = [
  {
    label: 'request.param.',
    insertText: 'request.param.',
  },
  {
    label: 'request.path',
    insertText: 'request.path',
  },
  {
    label: 'request.method',
    insertText: 'request.method',
  },
  {
    label: 'request.params.path.',
    insertText: 'request.params.path.',
  },
  {
    label: 'request.params.query.',
    insertText: 'request.params.query.',
  },
  {
    label: 'request.params.headers.',
    insertText: 'request.params.headers.',
  },
  {
    label: 'request.params.body.',
    insertText: 'request.params.body.',
  },
  {
    label: 'source.',
    insertText: 'source.',
  },
  {
    label: 'auth.',
    insertText: 'auth.',
  },
]

export function createExprCompletionEngine(context: ExprAssistContextV2): ExprCompletionEngineV2 {
  const catalog = buildExprAssistCatalog(context)
  const fieldUniverse = normalizeSuggestions([...catalog.requestPaths, ...catalog.sourcePaths])
  const rootItems = buildRootItems(catalog.sourceSlugs.length)

  return {
    fieldSuggestions: (query, limit = 20) => searchByPrefixThenContains(fieldUniverse, query, limit),
    sourceSlugs: () => catalog.sourceSlugs,
    sourceSlugSuggestions: (query, limit = 20) => searchByPrefixThenContains(catalog.sourceSlugs, query, limit),
    sourceFieldSuggestions: (slug, query = '', limit = 30) => searchByPrefixThenContains(catalog.sourceFieldsBySlug.get(slug) ?? [], query, limit),
    requestParamSuggestions: (query, limit = 40) => searchRequestParamSuggestions(catalog.requestParams, query, limit),
    requestScopeSuggestions: (scope, query = '', limit = 40) => {
      const prefix = requestScopePrefix(scope)
      const scoped = catalog.requestParams.filter((item) => item.canonicalPath.startsWith(prefix))
      return searchRequestParamSuggestions(scoped, query, limit)
    },
    requestChildren: (path) => catalog.requestChildren.get(canonicalizeRequestPath(path.trim())) ?? [],
    sourceChildren: (path) => catalog.sourceChildren.get(path.trim().replaceAll('[]', '')) ?? [],
    rootSuggestions: (query = '', limit = 20) => {
      if (query.trim() === '') {
        return rootItems.slice(0, limit)
      }
      const labels = rootItems.map((item) => item.label)
      const filtered = searchByPrefixThenContains(labels, query, limit)
      return filtered
        .map((label) => rootItems.find((item) => item.label === label) ?? null)
        .filter((item): item is ExprCompletionRootItem => item !== null)
    },
    isKnownLeafPath: (path) => isKnownLeafPath(path, catalog),
    canonicalizePath: (path) => canonicalizeLookupPath(path),
    valueTypeOf: (path) => resolveValueType(path, catalog),
    leafOperatorSuggestions: (path, useChainPrefix) => buildLeafOperators(resolveValueType(path, catalog), useChainPrefix),
  }
}

function buildRootItems(sourceCount: number): ExprCompletionRootItem[] {
  return ROOT_ITEMS_STATIC.map((item) => {
    if (item.label === 'request.param.') {
      return {
        ...item,
        detail: 'Unified request parameters menu',
      }
    }
    if (item.label === 'request.path') {
      return {
        ...item,
        detail: 'Request path',
      }
    }
    if (item.label === 'request.method') {
      return {
        ...item,
        detail: 'Request method',
      }
    }
    if (item.label === 'request.params.path.') {
      return {
        ...item,
        detail: 'Path parameters',
      }
    }
    if (item.label === 'request.params.query.') {
      return {
        ...item,
        detail: 'Query parameters',
      }
    }
    if (item.label === 'request.params.headers.') {
      return {
        ...item,
        detail: 'Header parameters',
      }
    }
    if (item.label === 'request.params.body.') {
      return {
        ...item,
        detail: 'Body fields',
      }
    }
    if (item.label === 'source.') {
      return {
        ...item,
        detail: sourceCount > 0 ? `Runtime data sources (${sourceCount})` : 'Runtime data sources (none active)',
      }
    }
    return {
      ...item,
      detail: 'Authentication context',
    }
  })
}

function searchRequestParamSuggestions(values: RequestParamCatalogItem[], query: string, limit: number): RequestParamCatalogItem[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return values.slice(0, limit)
  }

  const prefixMatches = values.filter((item) => item.key.toLowerCase().startsWith(needle))
  const containsMatches = values.filter(
    (item) =>
      !item.key.toLowerCase().startsWith(needle) &&
      (`${item.key} ${item.scope} ${item.canonicalPath}`.toLowerCase().includes(needle))
  )

  return [...prefixMatches, ...containsMatches].slice(0, limit)
}

function isKnownLeafPath(path: string, catalog: ExprAssistCatalogV2): boolean {
  const canonical = canonicalizeLookupPath(path)
  if (catalog.knownLeafPaths.has(canonical)) {
    return true
  }

  if (canonical === 'request.path' || canonical === 'request.method') {
    return true
  }

  if (canonical.startsWith('request.params.path.') || canonical.startsWith('request.params.query.') || canonical.startsWith('request.params.headers.')) {
    return canonical.split('.').length >= 4
  }

  return false
}

function resolveValueType(path: string, catalog: ExprAssistCatalogV2): ExprValueType {
  const canonical = canonicalizeLookupPath(path)

  const direct = catalog.valueTypesByPath.get(canonical)
  if (direct) {
    return direct
  }

  if (canonical === 'request.path' || canonical === 'request.method') {
    return 'string'
  }

  if (canonical.startsWith('request.params.path.') || canonical.startsWith('request.params.query.') || canonical.startsWith('request.params.headers.')) {
    return 'string'
  }

  return 'unknown'
}

function buildLeafOperators(type: ExprValueType, useChainPrefix: boolean): LeafOperatorItem[] {
  void useChainPrefix

  if (type === 'boolean') {
    return [
      {
        label: '==',
        detail: 'Equality comparison',
        insertText: ' == ${1:true}',
        sortRank: '0_eq_true',
      },
      {
        label: '!=',
        detail: 'Inequality comparison',
        insertText: ' != ${1:false}',
        sortRank: '1_ne_false',
      },
    ]
  }

  if (type === 'number') {
    return [
      {
        label: '==',
        detail: 'Equality comparison',
        insertText: ' == ${1:0}',
        sortRank: '0_eq',
      },
      {
        label: 'in([...])',
        detail: 'Membership check',
        insertText: ' in [${1:0}]',
        sortRank: '1_in',
      },
    ]
  }

  if (type === 'string') {
    return [
      {
        label: 'contains',
        detail: 'Contains text',
        insertText: ' contains ${1:"value"}',
        sortRank: '0_contains',
      },
      {
        label: 'startsWith',
        detail: 'Starts with prefix',
        insertText: ' startsWith ${1:"prefix"}',
        sortRank: '1_starts_with',
      },
      {
        label: 'endsWith',
        detail: 'Ends with suffix',
        insertText: ' endsWith ${1:"suffix"}',
        sortRank: '2_ends_with',
      },
      {
        label: '==',
        detail: 'Equality comparison',
        insertText: ' == ${1:"value"}',
        sortRank: '3_eq',
      },
      {
        label: 'in([...])',
        detail: 'Membership check',
        insertText: ' in [${1:"value"}]',
        sortRank: '4_in',
      },
    ]
  }

  return [
    {
      label: '==',
      detail: 'Equality comparison',
      insertText: ' == ${1:value}',
      sortRank: '0_eq',
    },
    {
      label: 'in([...])',
      detail: 'Membership check',
      insertText: ' in [${1:value}]',
      sortRank: '1_in',
    },
  ]
}

export function requestScopeTag(scope: RequestParamScope): string {
  return scopeLabel(scope)
}
