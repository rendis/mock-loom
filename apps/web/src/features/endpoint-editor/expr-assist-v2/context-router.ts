import type { RequestParamScope } from './catalog'
import { extractCursorToken } from './tokenizer'

export type ExprCompletionRouteState =
  | 'ROOT'
  | 'REQUEST_PARAM_ALIAS'
  | 'REQUEST_SCOPE'
  | 'SOURCE_ROOT'
  | 'SOURCE_SLUG'
  | 'LEAF_VALUE'
  | 'UNKNOWN'

export interface ExprCompletionRoute {
  state: ExprCompletionRouteState
  token: string
  replaceStartIndex: number
  replaceEndIndex: number
  query: string
  scope?: RequestParamScope
  slug?: string
  targetPath?: string
  hasTrailingDot: boolean
}

export interface ExprCompletionRouteInput {
  prefix: string
  invokedManually: boolean
  isKnownLeafPath: (path: string) => boolean
  canonicalizePath: (path: string) => string
}

const REQUEST_SCOPE_REGEX = /^request\.params\.(path|query|headers|body)\.([A-Za-z0-9_-]*)$/
const REQUEST_LEGACY_SCOPE_REGEX = /^request\.(header|query|body)\.([A-Za-z0-9_-]*)$/
const REQUEST_SCOPE_INVOKE_REGEX = /^request\.params\.(path|query|headers|body)$/
const REQUEST_LEGACY_SCOPE_INVOKE_REGEX = /^request\.(header|query|body)$/
const SOURCE_ROOT_REGEX = /^source\.([A-Za-z0-9_-]*)$/
const SOURCE_SLUG_REGEX = /^source\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/
const SOURCE_SLUG_INVOKE_REGEX = /^source\.([A-Za-z0-9_-]+)$/
const SOURCE_BY_ID_REGEX = /^source\.([A-Za-z0-9_-]+)_by_id\[[^\]]*\]\.([A-Za-z0-9_-]*)$/
const REQUEST_PARAM_ALIAS_REGEX = /^request\.param\.([A-Za-z0-9_-]*)$/

export function routeExprCompletion(input: ExprCompletionRouteInput): ExprCompletionRoute {
  const tokenData = extractCursorToken(input.prefix)
  const token = tokenData.token

  if (token === '') {
    return {
      state: 'ROOT',
      token,
      replaceStartIndex: tokenData.startIndex,
      replaceEndIndex: tokenData.endIndex,
      query: '',
      hasTrailingDot: false,
    }
  }

  const aliasMatch = token.match(REQUEST_PARAM_ALIAS_REGEX)
  if (aliasMatch) {
    return {
      state: 'REQUEST_PARAM_ALIAS',
      token,
      replaceStartIndex: tokenData.startIndex,
      replaceEndIndex: tokenData.endIndex,
      query: aliasMatch[1] ?? '',
      hasTrailingDot: tokenData.hasTrailingDot,
    }
  }

  if (token === 'request.param' && input.invokedManually) {
    return {
      state: 'REQUEST_PARAM_ALIAS',
      token,
      replaceStartIndex: tokenData.startIndex,
      replaceEndIndex: tokenData.endIndex,
      query: '',
      hasTrailingDot: tokenData.hasTrailingDot,
    }
  }

  const normalizedTarget = tokenData.hasTrailingDot ? token.slice(0, -1) : token
  const canonicalTarget = input.canonicalizePath(normalizedTarget)

  if (normalizedTarget !== '' && tokenData.hasTrailingDot && input.isKnownLeafPath(canonicalTarget)) {
    return {
      state: 'LEAF_VALUE',
      token,
      replaceStartIndex: tokenData.endIndex,
      replaceEndIndex: tokenData.endIndex,
      query: '',
      targetPath: canonicalTarget,
      hasTrailingDot: true,
    }
  }

  if (normalizedTarget !== '' && input.invokedManually && input.isKnownLeafPath(canonicalTarget)) {
    return {
      state: 'LEAF_VALUE',
      token,
      replaceStartIndex: tokenData.endIndex,
      replaceEndIndex: tokenData.endIndex,
      query: '',
      targetPath: canonicalTarget,
      hasTrailingDot: false,
    }
  }

  const scopeMatch = token.match(REQUEST_SCOPE_REGEX)
  if (scopeMatch && scopeMatch[1]) {
    const scope = scopeMatch[1] as RequestParamScope
    const query = scopeMatch[2] ?? ''
    return {
      state: 'REQUEST_SCOPE',
      token,
      replaceStartIndex: tokenData.endIndex - query.length,
      replaceEndIndex: tokenData.endIndex,
      query,
      scope,
      hasTrailingDot: tokenData.hasTrailingDot,
    }
  }

  const legacyScopeMatch = token.match(REQUEST_LEGACY_SCOPE_REGEX)
  if (legacyScopeMatch && legacyScopeMatch[1]) {
    const scope = legacyToCanonicalScope(legacyScopeMatch[1])
    const query = legacyScopeMatch[2] ?? ''
    return {
      state: 'REQUEST_SCOPE',
      token,
      replaceStartIndex: tokenData.endIndex - query.length,
      replaceEndIndex: tokenData.endIndex,
      query,
      scope,
      hasTrailingDot: tokenData.hasTrailingDot,
    }
  }

  if (input.invokedManually) {
    const requestScopeInvokeMatch = token.match(REQUEST_SCOPE_INVOKE_REGEX)
    if (requestScopeInvokeMatch && requestScopeInvokeMatch[1]) {
      return buildScopeFromInvocation(tokenData, token, requestScopeInvokeMatch[1] as RequestParamScope)
    }

    const requestLegacyScopeInvokeMatch = token.match(REQUEST_LEGACY_SCOPE_INVOKE_REGEX)
    if (requestLegacyScopeInvokeMatch && requestLegacyScopeInvokeMatch[1]) {
      return buildScopeFromInvocation(tokenData, token, legacyToCanonicalScope(requestLegacyScopeInvokeMatch[1]))
    }
  }

  if (token === 'request.' || token === 'request' || token === 'request.params.' || token === 'request.params') {
    return {
      state: 'ROOT',
      token,
      replaceStartIndex: tokenData.startIndex,
      replaceEndIndex: tokenData.endIndex,
      query: token,
      hasTrailingDot: tokenData.hasTrailingDot,
    }
  }

  if (token === 'source' && input.invokedManually) {
    return {
      state: 'SOURCE_ROOT',
      token,
      replaceStartIndex: tokenData.startIndex,
      replaceEndIndex: tokenData.endIndex,
      query: '',
      hasTrailingDot: tokenData.hasTrailingDot,
    }
  }

  const sourceRootMatch = token.match(SOURCE_ROOT_REGEX)
  if (sourceRootMatch) {
    const sourceSlugInvokeMatch = token.match(SOURCE_SLUG_INVOKE_REGEX)
    if (input.invokedManually && sourceSlugInvokeMatch && sourceSlugInvokeMatch[1]) {
      return {
        state: 'SOURCE_SLUG',
        token,
        replaceStartIndex: tokenData.endIndex,
        replaceEndIndex: tokenData.endIndex,
        query: '',
        slug: sourceSlugInvokeMatch[1],
        hasTrailingDot: tokenData.hasTrailingDot,
      }
    }

    const query = sourceRootMatch[1] ?? ''
    return {
      state: 'SOURCE_ROOT',
      token,
      replaceStartIndex: tokenData.endIndex - query.length,
      replaceEndIndex: tokenData.endIndex,
      query,
      hasTrailingDot: tokenData.hasTrailingDot,
    }
  }

  const sourceSlugMatch = token.match(SOURCE_SLUG_REGEX)
  if (sourceSlugMatch && sourceSlugMatch[1]) {
    const slug = sourceSlugMatch[1]
    const query = sourceSlugMatch[2] ?? ''
    return {
      state: 'SOURCE_SLUG',
      token,
      replaceStartIndex: tokenData.endIndex - query.length,
      replaceEndIndex: tokenData.endIndex,
      query,
      slug,
      hasTrailingDot: tokenData.hasTrailingDot,
    }
  }

  const sourceByIDMatch = token.match(SOURCE_BY_ID_REGEX)
  if (sourceByIDMatch && sourceByIDMatch[1]) {
    const slug = sourceByIDMatch[1]
    const query = sourceByIDMatch[2] ?? ''
    return {
      state: 'SOURCE_SLUG',
      token,
      replaceStartIndex: tokenData.endIndex - query.length,
      replaceEndIndex: tokenData.endIndex,
      query,
      slug,
      hasTrailingDot: tokenData.hasTrailingDot,
    }
  }

  if (input.invokedManually) {
    return {
      state: 'ROOT',
      token,
      replaceStartIndex: tokenData.startIndex,
      replaceEndIndex: tokenData.endIndex,
      query: token,
      hasTrailingDot: tokenData.hasTrailingDot,
    }
  }

  return {
    state: 'UNKNOWN',
    token,
    replaceStartIndex: tokenData.startIndex,
    replaceEndIndex: tokenData.endIndex,
    query: '',
    hasTrailingDot: tokenData.hasTrailingDot,
  }
}

function legacyToCanonicalScope(scope: string): RequestParamScope {
  switch (scope) {
    case 'header':
      return 'headers'
    case 'query':
      return 'query'
    case 'body':
      return 'body'
    default:
      return 'body'
  }
}

function buildScopeFromInvocation(
  tokenData: ReturnType<typeof extractCursorToken>,
  token: string,
  scope: RequestParamScope
): ExprCompletionRoute {
  return {
    state: 'REQUEST_SCOPE',
    token,
    replaceStartIndex: tokenData.endIndex,
    replaceEndIndex: tokenData.endIndex,
    query: '',
    scope,
    hasTrailingDot: tokenData.hasTrailingDot,
  }
}
