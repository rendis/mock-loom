export type ExprValueType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'unknown'

export type RequestParamScope = 'path' | 'query' | 'headers' | 'body'

export interface RequestParamCatalogItem {
  key: string
  scope: RequestParamScope
  canonicalPath: string
  valueType: ExprValueType
}

export interface ExprAssistContextV2 {
  requestPaths: string[]
  sourcePaths: string[]
  functions: string[]
  templatePaths: string[]
  requestFieldTypes?: Record<string, ExprValueType | string>
  sourceFieldTypes?: Record<string, ExprValueType | string>
}

export interface ExprAssistCatalogV2 {
  requestPaths: string[]
  sourcePaths: string[]
  requestParams: RequestParamCatalogItem[]
  requestChildren: Map<string, string[]>
  sourceChildren: Map<string, string[]>
  sourceSlugs: string[]
  sourceFieldsBySlug: Map<string, string[]>
  knownLeafPaths: Set<string>
  valueTypesByPath: Map<string, ExprValueType>
}

const REQUEST_SCOPE_PREFIX: Record<RequestParamScope, string> = {
  path: 'request.params.path.',
  query: 'request.params.query.',
  headers: 'request.params.headers.',
  body: 'request.params.body.',
}

export function buildExprAssistCatalog(context: ExprAssistContextV2): ExprAssistCatalogV2 {
  const requestPaths = normalizeSuggestions(context.requestPaths.map(canonicalizeRequestPath).filter((item) => item !== ''))
  const sourcePaths = normalizeSuggestions(context.sourcePaths)

  const requestChildren = buildChildrenMap(requestPaths)
  const sourceChildren = buildChildrenMap(sourcePaths)
  const sourceSlugs = collectSourceSlugs(sourcePaths)
  const sourceFieldsBySlug = collectSourceFieldsBySlug(sourcePaths)
  const requestParams = buildRequestParamCatalog(requestPaths, context.requestFieldTypes)

  const knownLeafPaths = new Set<string>()
  const valueTypesByPath = new Map<string, ExprValueType>()

  for (const path of requestPaths) {
    if (isRequestLeafPath(path)) {
      knownLeafPaths.add(path)
      valueTypesByPath.set(path, inferDefaultRequestType(path))
    }
  }

  for (const path of sourcePaths) {
    if (isSourceLeafPath(path)) {
      knownLeafPaths.add(path)
    }
  }

  const requestFieldTypes = context.requestFieldTypes ?? {}
  for (const [path, rawType] of Object.entries(requestFieldTypes)) {
    valueTypesByPath.set(canonicalizeRequestPath(path), normalizeExprValueType(rawType))
  }

  const sourceFieldTypes = context.sourceFieldTypes ?? {}
  for (const [path, rawType] of Object.entries(sourceFieldTypes)) {
    valueTypesByPath.set(path.trim(), normalizeExprValueType(rawType))
  }

  return {
    requestPaths,
    sourcePaths,
    requestParams,
    requestChildren,
    sourceChildren,
    sourceSlugs,
    sourceFieldsBySlug,
    knownLeafPaths,
    valueTypesByPath,
  }
}

export function normalizeSuggestions(values: string[]): string[] {
  const deduped = new Set<string>()
  values.forEach((value) => {
    const trimmed = value.trim().replaceAll('[]', '')
    if (trimmed !== '') {
      deduped.add(trimmed)
    }
  })
  return [...deduped].sort((left, right) => left.localeCompare(right))
}

export function searchByPrefixThenContains(values: string[], query: string, limit: number): string[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return values.slice(0, limit)
  }

  const prefix = values.filter((item) => item.toLowerCase().startsWith(needle))
  const contains = values.filter((item) => !item.toLowerCase().startsWith(needle) && item.toLowerCase().includes(needle))

  return [...prefix, ...contains].slice(0, limit)
}

export function canonicalizeRequestPath(path: string): string {
  const normalized = path.trim().replaceAll('[]', '')
  if (normalized === '') {
    return normalized
  }
  if (normalized.startsWith('request.header')) {
    return `request.params.headers${normalized.slice('request.header'.length)}`
  }
  if (normalized.startsWith('request.query')) {
    return `request.params.query${normalized.slice('request.query'.length)}`
  }
  if (normalized.startsWith('request.body')) {
    return `request.params.body${normalized.slice('request.body'.length)}`
  }
  return normalized
}

export function canonicalizeLookupPath(path: string): string {
  let normalized = canonicalizeRequestPath(path)
  normalized = normalized.replace(/\s+/g, '')

  const byIDFieldMatch = normalized.match(/^source\.([A-Za-z0-9_-]+)_by_id\[[^\]]+\]\.(.+)$/)
  if (byIDFieldMatch && byIDFieldMatch[1] && byIDFieldMatch[2]) {
    return `source.${byIDFieldMatch[1]}.${byIDFieldMatch[2]}`
  }

  const byIDRootMatch = normalized.match(/^source\.([A-Za-z0-9_-]+)_by_id\[[^\]]+\]$/)
  if (byIDRootMatch && byIDRootMatch[1]) {
    return `source.${byIDRootMatch[1]}`
  }

  return normalized
}

export function requestScopePrefix(scope: RequestParamScope): string {
  return REQUEST_SCOPE_PREFIX[scope]
}

export function scopeLabel(scope: RequestParamScope): string {
  switch (scope) {
    case 'path':
      return 'PATH'
    case 'query':
      return 'QUERY'
    case 'headers':
      return 'HEADER'
    case 'body':
      return 'BODY'
    default:
      return 'UNKNOWN'
  }
}

export function normalizeExprValueType(raw: unknown): ExprValueType {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (value === 'string') {
    return 'string'
  }
  if (value === 'number' || value === 'integer' || value === 'float' || value === 'double') {
    return 'number'
  }
  if (value === 'boolean' || value === 'bool') {
    return 'boolean'
  }
  if (value === 'object' || value === 'map') {
    return 'object'
  }
  if (value === 'array' || value === 'list') {
    return 'array'
  }
  return 'unknown'
}

function buildChildrenMap(paths: string[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>()

  paths.forEach((path) => {
    const segments = path.split('.')
    if (segments.length < 2) {
      return
    }
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index).join('.')
      const child = segments[index]?.trim()
      if (!child) {
        continue
      }
      if (!map.has(parent)) {
        map.set(parent, new Set<string>())
      }
      map.get(parent)?.add(child)
    }
  })

  return new Map([...map.entries()].map(([key, values]) => [key, [...values].sort((left, right) => left.localeCompare(right))]))
}

function collectSourceSlugs(sourcePaths: string[]): string[] {
  const slugs = new Set<string>()
  sourcePaths.forEach((path) => {
    const match = path.match(/^source\.([A-Za-z0-9_-]+)/)
    if (match?.[1]) {
      slugs.add(match[1])
    }
  })
  return [...slugs].sort((left, right) => left.localeCompare(right))
}

function collectSourceFieldsBySlug(sourcePaths: string[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>()

  sourcePaths.forEach((path) => {
    const match = path.match(/^source\.([A-Za-z0-9_-]+)\.(.+)$/)
    if (!match || !match[1] || !match[2]) {
      return
    }

    const slug = match[1]
    const field = match[2].split('.')[0]?.trim()
    if (!field) {
      return
    }

    if (!map.has(slug)) {
      map.set(slug, new Set<string>())
    }
    map.get(slug)?.add(field)
  })

  return new Map([...map.entries()].map(([slug, values]) => [slug, [...values].sort((left, right) => left.localeCompare(right))]))
}

function buildRequestParamCatalog(
  requestPaths: string[],
  requestFieldTypes?: Record<string, ExprValueType | string>
): RequestParamCatalogItem[] {
  const index = new Map<string, RequestParamCatalogItem>()
  const typeMap = requestFieldTypes ?? {}

  ;(['path', 'query', 'headers', 'body'] as RequestParamScope[]).forEach((scope) => {
    const prefix = requestScopePrefix(scope)
    requestPaths
      .filter((item) => item.startsWith(prefix))
      .forEach((item) => {
        const remainder = item.slice(prefix.length)
        const key = remainder.split('.')[0]?.trim()
        if (!key) {
          return
        }

        const canonicalPath = `${prefix}${key}`
        const token = `${scope}:${canonicalPath}`
        if (index.has(token)) {
          return
        }

        index.set(token, {
          key,
          scope,
          canonicalPath,
          valueType: normalizeExprValueType(typeMap[canonicalPath]),
        })
      })
  })

  return [...index.values()].sort((left, right) => {
    const keyOrder = left.key.localeCompare(right.key)
    if (keyOrder !== 0) {
      return keyOrder
    }
    return scopeSortValue(left.scope) - scopeSortValue(right.scope)
  })
}

function scopeSortValue(scope: RequestParamScope): number {
  switch (scope) {
    case 'path':
      return 0
    case 'query':
      return 1
    case 'headers':
      return 2
    case 'body':
      return 3
    default:
      return 10
  }
}

function isRequestLeafPath(path: string): boolean {
  if (path === 'request.method' || path === 'request.path') {
    return true
  }
  if (path.startsWith('request.params.path.')) {
    return path.split('.').length >= 4
  }
  if (path.startsWith('request.params.query.')) {
    return path.split('.').length >= 4
  }
  if (path.startsWith('request.params.headers.')) {
    return path.split('.').length >= 4
  }
  if (path.startsWith('request.params.body.')) {
    return path.split('.').length >= 4
  }
  return false
}

function isSourceLeafPath(path: string): boolean {
  return path.startsWith('source.') && path.split('.').length >= 3
}

function inferDefaultRequestType(path: string): ExprValueType {
  if (path === 'request.method' || path === 'request.path') {
    return 'string'
  }
  if (path.startsWith('request.params.path.')) {
    return 'string'
  }
  if (path.startsWith('request.params.query.')) {
    return 'string'
  }
  if (path.startsWith('request.params.headers.')) {
    return 'string'
  }
  return 'unknown'
}
