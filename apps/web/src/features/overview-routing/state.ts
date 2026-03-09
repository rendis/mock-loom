import type { BundleBQAState } from '../../shared/lib/qa-state'
import type { CollectionState, ImportState, OverviewState } from '../../shared/types/ui-state'
import type { IntegrationRoute } from '../../types/api'

export type BundleBViewState = 'loading' | 'ready' | 'empty' | 'import-error' | 'error'

export interface BundleBViewStateInput {
  qaState: BundleBQAState | null
  overviewState: OverviewState
  routesState: CollectionState
  importState: ImportState
  importError: string
  routeCount: number
}

export interface RouteTreeGroup {
  key: string
  label: string
  routes: IntegrationRoute[]
}

const METHOD_PRIORITY = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const

export function deriveBundleBViewState({
  qaState,
  overviewState,
  routesState,
  importState,
  importError,
  routeCount,
}: BundleBViewStateInput): BundleBViewState {
  if (qaState) {
    return qaState
  }

  if (overviewState === 'loading' || routesState === 'loading') {
    return 'loading'
  }

  if (importState === 'error' && importError.trim() !== '') {
    return 'import-error'
  }

  if (overviewState === 'error' || routesState === 'error') {
    return 'error'
  }

  if (routeCount === 0 || routesState === 'empty') {
    return 'empty'
  }

  return 'ready'
}

export function extractRouteMethods(routes: IntegrationRoute[]): string[] {
  const methodSet = new Set<string>()
  for (const route of routes) {
    methodSet.add(route.method.toUpperCase())
  }

  const methods = [...methodSet]
  methods.sort((left, right) => methodRank(left) - methodRank(right) || left.localeCompare(right))
  return methods
}

export function filterRoutes(routes: IntegrationRoute[], query: string, methodFilter: string): IntegrationRoute[] {
  const normalizedQuery = query.trim().toLowerCase()
  const normalizedMethodFilter = methodFilter.trim().toUpperCase()

  return routes.filter((route) => {
    const method = route.method.toUpperCase()
    if (normalizedMethodFilter !== '' && normalizedMethodFilter !== 'ALL' && method !== normalizedMethodFilter) {
      return false
    }

    if (normalizedQuery === '') {
      return true
    }

    const searchable = `${method} ${route.path}`.toLowerCase()
    return searchable.includes(normalizedQuery)
  })
}

export function buildRouteTreeGroups(routes: IntegrationRoute[]): RouteTreeGroup[] {
  const grouped = new Map<string, IntegrationRoute[]>()

  for (const route of routes) {
    const key = toGroupKey(route.path)
    const items = grouped.get(key)
    if (items) {
      items.push(route)
    } else {
      grouped.set(key, [route])
    }
  }

  return [...grouped.entries()]
    .map(([key, items]) => ({
      key,
      label: toGroupLabel(key),
      routes: [...items].sort((left, right) => left.path.localeCompare(right.path) || methodRank(left.method) - methodRank(right.method)),
    }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

function methodRank(method: string): number {
  const normalizedMethod = method.toUpperCase()
  const knownIndex = METHOD_PRIORITY.indexOf(normalizedMethod as (typeof METHOD_PRIORITY)[number])
  return knownIndex === -1 ? METHOD_PRIORITY.length + 1 : knownIndex
}

function toGroupKey(path: string): string {
  const normalizedPath = path.trim().replace(/^\/+/, '')
  if (normalizedPath === '') {
    return 'root'
  }
  const firstSegment = normalizedPath.split('/')[0] || 'root'
  return firstSegment.toLowerCase()
}

function toGroupLabel(groupKey: string): string {
  if (groupKey === 'root') {
    return 'Root'
  }

  const spaced = groupKey.replace(/[-_]+/g, ' ')
  return spaced
    .split(' ')
    .filter((part) => part !== '')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}
