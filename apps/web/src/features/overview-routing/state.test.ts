import { describe, expect, it } from 'vitest'

import {
  buildRouteTreeGroups,
  deriveBundleBViewState,
  extractRouteMethods,
  filterRoutes,
} from './state'
import type { IntegrationRoute } from '../../types/api'

const ROUTES_FIXTURE: IntegrationRoute[] = [
  { id: 'rt-1', packId: 'pack-1', method: 'GET', path: '/users' },
  { id: 'rt-2', packId: 'pack-1', method: 'POST', path: '/users' },
  { id: 'rt-3', packId: 'pack-1', method: 'GET', path: '/orders/{id}' },
  { id: 'rt-4', packId: 'pack-1', method: 'DELETE', path: '/orders/{id}' },
]

describe('deriveBundleBViewState', () => {
  it('returns qa state override when provided', () => {
    expect(
      deriveBundleBViewState({
        qaState: 'import-error',
        overviewState: 'ready',
        routesState: 'ready',
        importState: 'idle',
        importError: '',
        routeCount: 10,
      })
    ).toBe('import-error')
  })

  it('derives loading state while overview/routes are loading', () => {
    expect(
      deriveBundleBViewState({
        qaState: null,
        overviewState: 'loading',
        routesState: 'ready',
        importState: 'idle',
        importError: '',
        routeCount: 1,
      })
    ).toBe('loading')
  })

  it('derives import-error when import fails', () => {
    expect(
      deriveBundleBViewState({
        qaState: null,
        overviewState: 'ready',
        routesState: 'ready',
        importState: 'error',
        importError: 'conflict',
        routeCount: 1,
      })
    ).toBe('import-error')
  })

  it('derives empty and ready states', () => {
    expect(
      deriveBundleBViewState({
        qaState: null,
        overviewState: 'ready',
        routesState: 'empty',
        importState: 'idle',
        importError: '',
        routeCount: 0,
      })
    ).toBe('empty')

    expect(
      deriveBundleBViewState({
        qaState: null,
        overviewState: 'ready',
        routesState: 'ready',
        importState: 'idle',
        importError: '',
        routeCount: 2,
      })
    ).toBe('ready')
  })

  it('derives error when API state fails', () => {
    expect(
      deriveBundleBViewState({
        qaState: null,
        overviewState: 'error',
        routesState: 'error',
        importState: 'idle',
        importError: '',
        routeCount: 0,
      })
    ).toBe('error')
  })
})

describe('route filtering and grouping', () => {
  it('extracts methods in stable priority order', () => {
    expect(extractRouteMethods(ROUTES_FIXTURE)).toEqual(['GET', 'POST', 'DELETE'])
  })

  it('filters by method and contains query over method+path', () => {
    expect(filterRoutes(ROUTES_FIXTURE, '', 'POST')).toHaveLength(1)
    expect(filterRoutes(ROUTES_FIXTURE, 'orders', 'ALL')).toHaveLength(2)
    expect(filterRoutes(ROUTES_FIXTURE, 'DELETE /orders', 'ALL')).toHaveLength(1)
    expect(filterRoutes(ROUTES_FIXTURE, 'users', 'GET')).toHaveLength(1)
  })

  it('groups by first route segment and keeps deterministic labels', () => {
    const groups = buildRouteTreeGroups(ROUTES_FIXTURE)
    expect(groups.map((group) => group.label)).toEqual(['Orders', 'Users'])
    expect(groups[0]?.routes).toHaveLength(2)
    expect(groups[1]?.routes).toHaveLength(2)
  })
})
