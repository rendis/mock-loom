import {
  canonicalizeLookupPath,
  canonicalizeRequestPath,
  normalizeExprValueType,
  normalizeSuggestions,
  scopeLabel,
  type ExprAssistContextV2,
  type ExprValueType,
  type RequestParamCatalogItem,
  type RequestParamScope as CatalogRequestParamScope,
} from './expr-assist-v2/catalog'
import { createExprCompletionEngine, type ExprCompletionRootItem, type LeafOperatorItem } from './expr-assist-v2/provider'
import type { AutocompleteContext } from '../../types/api'

export interface EndpointCompletionContext extends ExprAssistContextV2 {}

export type RequestParamScope = 'PATH' | 'QUERY' | 'HEADER' | 'BODY'

export interface RequestParamSuggestion {
  key: string
  scope: RequestParamScope
  canonicalPath: string
  valueType: ExprValueType
}

export interface EndpointCompletionProvider {
  fieldSuggestions: (query: string, limit?: number) => string[]
  rootSuggestions: (query?: string, limit?: number) => ExprCompletionRootItem[]
  requestParamSuggestions: (query: string, limit?: number) => RequestParamSuggestion[]
  requestScopeSuggestions: (scope: string, query?: string, limit?: number) => RequestParamSuggestion[]
  sourceSlugSuggestions: (query: string, limit?: number) => string[]
  sourceFieldSuggestions: (slug: string, query?: string, limit?: number) => string[]
  sourceSlugs: () => string[]
  sourceChildren: (path: string) => string[]
  requestChildren: (path: string) => string[]
  valueTypeOf: (path: string) => ExprValueType
  canonicalizePath: (path: string) => string
  isKnownLeafPath: (path: string) => boolean
  leafOperatorSuggestions: (path: string, useChainPrefix: boolean) => LeafOperatorItem[]
}

const FALLBACK_CONTEXT: EndpointCompletionContext = {
  requestPaths: [
    'request.method',
    'request.path',
    'request.params',
    'request.params.path',
    'request.params.query',
    'request.params.headers',
    'request.params.body',
  ],
  sourcePaths: [],
  functions: [],
  templatePaths: [],
  requestFieldTypes: {
    'request.method': 'string',
    'request.path': 'string',
  },
  sourceFieldTypes: {},
}

export function buildCompletionContext(runtimeContext: AutocompleteContext | null | undefined): EndpointCompletionContext {
  if (!runtimeContext) {
    return FALLBACK_CONTEXT
  }

  const requestPaths = normalizeSuggestions([...FALLBACK_CONTEXT.requestPaths, ...runtimeContext.requestPaths].map(canonicalizeRequestPath))

  return {
    requestPaths,
    sourcePaths: normalizeSuggestions(runtimeContext.sourcePaths),
    functions: normalizeSuggestions(runtimeContext.functions),
    templatePaths: normalizeSuggestions(runtimeContext.templatePaths),
    requestFieldTypes: FALLBACK_CONTEXT.requestFieldTypes,
    sourceFieldTypes: {},
  }
}

export function createCompletionProvider(context: EndpointCompletionContext): EndpointCompletionProvider {
  const engine = createExprCompletionEngine(context)

  return {
    fieldSuggestions: engine.fieldSuggestions,
    rootSuggestions: engine.rootSuggestions,
    requestParamSuggestions: (query, limit = 40) =>
      engine.requestParamSuggestions(query, limit).map(toPublicRequestParamSuggestion),
    requestScopeSuggestions: (scope, query = '', limit = 40) => {
      const canonicalScope = parseRequestParamScope(scope)
      if (!canonicalScope) {
        return []
      }
      return engine.requestScopeSuggestions(canonicalScope, query, limit).map(toPublicRequestParamSuggestion)
    },
    sourceSlugSuggestions: engine.sourceSlugSuggestions,
    sourceFieldSuggestions: engine.sourceFieldSuggestions,
    sourceSlugs: engine.sourceSlugs,
    sourceChildren: engine.sourceChildren,
    requestChildren: engine.requestChildren,
    valueTypeOf: engine.valueTypeOf,
    canonicalizePath: (path) => canonicalizeLookupPath(path),
    isKnownLeafPath: engine.isKnownLeafPath,
    leafOperatorSuggestions: engine.leafOperatorSuggestions,
  }
}

export function enrichCompletionContextTypes(
  context: EndpointCompletionContext,
  additions: {
    requestFieldTypes?: Record<string, string>
    sourceFieldTypes?: Record<string, string>
  }
): EndpointCompletionContext {
  const requestFieldTypes = {
    ...(context.requestFieldTypes ?? {}),
    ...normalizeTypeMap(additions.requestFieldTypes),
  }

  const sourceFieldTypes = {
    ...(context.sourceFieldTypes ?? {}),
    ...normalizeTypeMap(additions.sourceFieldTypes),
  }

  return {
    ...context,
    requestFieldTypes,
    sourceFieldTypes,
  }
}

function normalizeTypeMap(source: Record<string, string> | undefined): Record<string, ExprValueType> {
  const entries = Object.entries(source ?? {})
  return entries.reduce<Record<string, ExprValueType>>((acc, [path, rawType]) => {
    const canonicalPath = path.startsWith('request.') ? canonicalizeRequestPath(path) : canonicalizeLookupPath(path)
    acc[canonicalPath] = normalizeExprValueType(rawType)
    return acc
  }, {})
}

function toPublicRequestParamSuggestion(item: RequestParamCatalogItem): RequestParamSuggestion {
  return {
    key: item.key,
    scope: toPublicScope(item.scope),
    canonicalPath: item.canonicalPath,
    valueType: item.valueType,
  }
}

function toPublicScope(scope: CatalogRequestParamScope): RequestParamScope {
  const label = scopeLabel(scope)
  switch (label) {
    case 'PATH':
      return 'PATH'
    case 'QUERY':
      return 'QUERY'
    case 'HEADER':
      return 'HEADER'
    case 'BODY':
      return 'BODY'
    default:
      return 'BODY'
  }
}

function parseRequestParamScope(scope: string): CatalogRequestParamScope | null {
  const normalized = scope.trim().toLowerCase()
  if (normalized === 'path') {
    return 'path'
  }
  if (normalized === 'query') {
    return 'query'
  }
  if (normalized === 'headers' || normalized === 'header') {
    return 'headers'
  }
  if (normalized === 'body') {
    return 'body'
  }
  return null
}
