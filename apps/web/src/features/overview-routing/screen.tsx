import { useEffect, useMemo, useState } from 'react'
import { Pencil, X } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import {
  formatAPIError,
  getIntegrationOverview,
  getIntegrationRoutes,
  importIntegrationRoutes,
  updateIntegrationAuth,
} from '../../lib/api'
import type {
  ImportRoutesResult,
  ImportSourceType,
  IntegrationOverview,
  IntegrationRoute,
} from '../../types/api'
import { dataSourcesRoute, packEndpointRoute, packsRoute, sessionLogsRoute } from '../../app/routes/paths'
import { useSessionStore } from '../../app/state/use-session-store'
import { parseBundleBQAState } from '../../shared/lib/qa-state'
import { Alert } from '../../shared/ui/alert'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { IconActionButton } from '../../shared/ui/icon-action-button'
import { Input } from '../../shared/ui/input'
import { Select } from '../../shared/ui/select'
import { Textarea } from '../../shared/ui/textarea'
import type { CollectionState, ImportState, OverviewState } from '../../shared/types/ui-state'
import {
  buildRouteTreeGroups,
  deriveBundleBViewState,
  extractRouteMethods,
  filterRoutes,
} from './state'

type MethodFilter = 'ALL' | string

interface InterceptionItem {
  id: string
  method: string
  path: string
  status: string
  latency: string
  state: 'ok' | 'warn'
  timestamp: string
}

const QA_READY_ROUTES: IntegrationRoute[] = [
  { id: 'qa-rt-1', packId: 'qa-pack', method: 'GET', path: '/users' },
  { id: 'qa-rt-2', packId: 'qa-pack', method: 'GET', path: '/users/{id}' },
  { id: 'qa-rt-3', packId: 'qa-pack', method: 'POST', path: '/users' },
  { id: 'qa-rt-4', packId: 'qa-pack', method: 'GET', path: '/orders' },
  { id: 'qa-rt-5', packId: 'qa-pack', method: 'DELETE', path: '/orders/{id}' },
  { id: 'qa-rt-6', packId: 'qa-pack', method: 'GET', path: '/products' },
  { id: 'qa-rt-7', packId: 'qa-pack', method: 'POST', path: '/products/batch' },
]

const QA_IMPORT_ERROR_ROUTES: IntegrationRoute[] = [
  { id: 'qa-err-1', packId: 'qa-pack', method: 'GET', path: '/api/v1/users' },
  { id: 'qa-err-2', packId: 'qa-pack', method: 'POST', path: '/api/auth' },
  { id: 'qa-err-3', packId: 'qa-pack', method: 'POST', path: '/auth/login' },
]

const INTERCEPTIONS_FIXTURE: InterceptionItem[] = [
  {
    id: 'int-1',
    method: 'GET',
    path: '/api/v1/users/u-1293',
    status: '200 OK',
    latency: '45ms',
    state: 'ok',
    timestamp: 'Just now',
  },
  {
    id: 'int-2',
    method: 'POST',
    path: '/api/v1/orders',
    status: '201 Created',
    latency: '120ms',
    state: 'ok',
    timestamp: '1m ago',
  },
  {
    id: 'int-3',
    method: 'DELETE',
    path: '/api/v1/sessions/current',
    status: '401 Unauth',
    latency: '22ms',
    state: 'warn',
    timestamp: '4m ago',
  },
]

function buildPreviewOverview(integrationId: string, routeCount: number): IntegrationOverview {
  return {
    integration: {
      id: integrationId,
      workspaceId: 'qa-workspace',
      name: 'QA Preview Integration',
      slug: 'qa-preview',
      baseUrl: 'https://api.mockengine.dev/v1/',
      authMode: 'BEARER',
      status: 'ACTIVE',
    },
    routeCount,
    last24hRequests: routeCount === 0 ? 0 : 1428,
    errorRate: routeCount === 0 ? 0 : 0.2,
  }
}

const QA_READY_OVERVIEW = buildPreviewOverview('qa-preview', QA_READY_ROUTES.length)
const QA_EMPTY_OVERVIEW = buildPreviewOverview('qa-preview', 0)
const QA_IMPORT_ERROR_OVERVIEW = buildPreviewOverview('qa-preview', QA_IMPORT_ERROR_ROUTES.length)

export function OverviewRoutingScreen(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { integrationId = '' } = useParams()

  const token = useSessionStore((state) => state.token)
  const selectedIntegrationId = useSessionStore((state) => state.selectedIntegrationId)
  const selectIntegration = useSessionStore((state) => state.selectIntegration)

  const [overview, setOverview] = useState<IntegrationOverview | null>(null)
  const [overviewState, setOverviewState] = useState<OverviewState>('loading')
  const [routes, setRoutes] = useState<IntegrationRoute[]>([])
  const [routesState, setRoutesState] = useState<CollectionState>('loading')
  const [importSourceType, setImportSourceType] = useState<ImportSourceType>('OPENAPI')
  const [importPayload, setImportPayload] = useState('')
  const [importState, setImportState] = useState<ImportState>('idle')
  const [importResult, setImportResult] = useState<ImportRoutesResult | null>(null)
  const [error, setError] = useState('')
  const [importError, setImportError] = useState('')
  const [authMode, setAuthMode] = useState('NONE')
  const [routeQuery, setRouteQuery] = useState('')
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('ALL')
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)

  const qaState = useMemo(() => parseBundleBQAState(location.search), [location.search])

  useEffect(() => {
    if (integrationId !== '' && integrationId !== selectedIntegrationId) {
      selectIntegration(integrationId)
    }
  }, [integrationId, selectedIntegrationId, selectIntegration])

  useEffect(() => {
    if (qaState) {
      setOverviewState('ready')
      setRoutesState(qaState === 'empty' ? 'empty' : 'ready')
      setImportState(qaState === 'import-error' ? 'error' : 'idle')
      setImportError(qaState === 'import-error' ? 'Import conflict detected for POST /auth/login.' : '')
      setError('')
      setImportResult(null)
      return
    }

    if (!token || integrationId === '') {
      return
    }

    let cancelled = false

    const load = async (): Promise<void> => {
      setOverviewState('loading')
      setRoutesState('loading')
      setError('')

      try {
        const [overviewPayload, routeItems] = await Promise.all([
          getIntegrationOverview(token, integrationId),
          getIntegrationRoutes(token, integrationId),
        ])

        if (cancelled) {
          return
        }

        setOverview(overviewPayload)
        setAuthMode(overviewPayload.integration.authMode)
        setOverviewState('ready')
        setRoutes(routeItems)
        setRoutesState(routeItems.length === 0 ? 'empty' : 'ready')
      } catch (requestError) {
        if (cancelled) {
          return
        }
        setOverviewState('error')
        setRoutesState('error')
        setError(formatAPIError(requestError))
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [token, integrationId, qaState])

  const displayOverview = useMemo(() => {
    if (qaState === 'ready') {
      return QA_READY_OVERVIEW
    }
    if (qaState === 'empty') {
      return QA_EMPTY_OVERVIEW
    }
    if (qaState === 'import-error') {
      return QA_IMPORT_ERROR_OVERVIEW
    }
    return overview
  }, [overview, qaState])

  const displayRoutes = useMemo(() => {
    if (qaState === 'ready') {
      return QA_READY_ROUTES
    }
    if (qaState === 'empty') {
      return []
    }
    if (qaState === 'import-error') {
      return QA_IMPORT_ERROR_ROUTES
    }
    return routes
  }, [qaState, routes])

  const viewState = deriveBundleBViewState({
    qaState,
    overviewState,
    routesState,
    importState,
    importError,
    routeCount: displayRoutes.length,
  })

  const routeMethods = useMemo(() => ['ALL', ...extractRouteMethods(displayRoutes)], [displayRoutes])

  useEffect(() => {
    if (!routeMethods.includes(methodFilter)) {
      setMethodFilter('ALL')
    }
  }, [methodFilter, routeMethods])

  const filteredRoutes = useMemo(
    () => filterRoutes(displayRoutes, routeQuery, methodFilter),
    [displayRoutes, routeQuery, methodFilter]
  )
  const routeGroups = useMemo(() => buildRouteTreeGroups(filteredRoutes), [filteredRoutes])

  const metrics = useMemo(() => {
    if (!displayOverview) {
      return { routes: 0, requests: 0, errorRate: 0 }
    }
    return {
      routes: displayOverview.routeCount,
      requests: displayOverview.last24hRequests,
      errorRate: displayOverview.errorRate,
    }
  }, [displayOverview])

  async function submitImport(): Promise<void> {
    if (qaState) {
      if (importPayload.trim() === '') {
        setImportState('error')
        setImportError('Import payload is required.')
        return
      }

      if (qaState === 'import-error') {
        setImportState('error')
        setImportError('Import conflict detected for POST /auth/login.')
        return
      }

      setImportState('success')
      setImportError('')
      setImportResult({
        sourceType: importSourceType,
        createdRoutes: 2,
        updatedRoutes: 0,
        skippedRoutes: 0,
        warnings: [],
        errors: [],
      })
      setIsImportDialogOpen(false)
      return
    }

    if (!token || integrationId === '') {
      return
    }

    setImportState('validating')
    setImportResult(null)
    setImportError('')
    if (importPayload.trim() === '') {
      setImportState('error')
      setImportError('Import payload is required.')
      return
    }

    try {
      setImportState('importing')
      setError('')

      const result = await importIntegrationRoutes(token, integrationId, importSourceType, importPayload)
      setImportResult(result)

      if (result.errors.length > 0) {
        setImportState('error')
        setImportError(result.errors.join('; '))
        return
      }

      setImportState('success')
      setImportError('')

      const [overviewPayload, routeItems] = await Promise.all([
        getIntegrationOverview(token, integrationId),
        getIntegrationRoutes(token, integrationId),
      ])
      setOverview(overviewPayload)
      setAuthMode(overviewPayload.integration.authMode)
      setRoutes(routeItems)
      setRoutesState(routeItems.length === 0 ? 'empty' : 'ready')
      setOverviewState('ready')
      setIsImportDialogOpen(false)
    } catch (requestError) {
      const message = formatAPIError(requestError)
      setImportState('error')
      setImportError(message)
    }
  }

  async function changeAuthMode(nextMode: string): Promise<void> {
    if (authMode === nextMode) {
      return
    }

    if (qaState) {
      setAuthMode(nextMode)
      return
    }

    if (!token || integrationId === '') {
      return
    }

    const previousMode = authMode
    setAuthMode(nextMode)
    setOverviewState('updating')
    setError('')

    try {
      await updateIntegrationAuth(token, integrationId, nextMode)
      const refreshed = await getIntegrationOverview(token, integrationId)
      setOverview(refreshed)
      setAuthMode(refreshed.integration.authMode)
      setOverviewState('ready')
    } catch (requestError) {
      setAuthMode(previousMode)
      setOverviewState('error')
      setError(formatAPIError(requestError))
    }
  }

  async function copyBaseURL(baseUrl: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(baseUrl)
    } catch {
      // No-op fallback for environments without clipboard permissions.
    }
  }

  const bannerMessage = importError || (viewState === 'import-error' ? 'Import conflict detected for POST /auth/login.' : '')
  const showImportConflictLayout = qaState === 'import-error'
  const isConflictMessage = bannerMessage.toLowerCase().includes('conflict')

  return (
    <section className="screen-b-font min-h-screen bg-surface-base text-text">
      <div className="w-full px-6 py-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white shadow-tactile">::</div>
              <span className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">MockEngine System</span>
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-text">Integration Overview</h1>
            <p className="mt-2 text-lg text-muted">Manage API routes, monitor latency, and configure mock responses.</p>
          </div>
        </header>

        {bannerMessage ? (
          <div className="mb-6">
            <Alert tone="error" className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{isConflictMessage ? 'Import Conflict Detected' : 'Import Failed'}</p>
                <p className="mt-1 text-sm">{bannerMessage}</p>
              </div>
              <button
                aria-label="Dismiss import conflict"
                className="rounded-md px-2 py-1 text-xs font-semibold hover:bg-error/10"
                onClick={() => {
                  setImportError('')
                  setImportState('idle')
                }}
                type="button"
              >
                Dismiss
              </button>
            </Alert>
          </div>
        ) : null}

        {viewState === 'import-error' && showImportConflictLayout ? (
          <ImportErrorLayout
            authMode={authMode}
            integrationId={integrationId}
            importState={importState}
            methodFilter={methodFilter}
            routeGroups={routeGroups}
            routeQuery={routeQuery}
            routes={displayRoutes}
            onChangeAuthMode={changeAuthMode}
            onFilterMethod={setMethodFilter}
            onFilterQuery={setRouteQuery}
            onOpenImport={() => setIsImportDialogOpen(true)}
            onSelectRoute={(route) => navigate(packEndpointRoute(integrationId, route.packId, route.id))}
          />
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <aside className="space-y-5 lg:col-span-3">
              {viewState === 'ready' ? (
                <>
                  <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-card">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Base URL</p>
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-surface-soft p-3 shadow-inset">
                      <p className="truncate text-sm font-mono text-text">{displayOverview?.integration.baseUrl || '-'}</p>
                      <button
                        aria-label="Copy base URL"
                        className="rounded-md border border-border bg-surface-raised px-2 py-1 text-xs font-semibold text-muted hover:text-text"
                        onClick={() => void copyBaseURL(displayOverview?.integration.baseUrl || '')}
                        type="button"
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-card">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Global Auth Mode</p>
                      <Badge variant={overviewState === 'updating' ? 'warning' : 'neutral'}>
                        {overviewState === 'updating' ? 'Updating' : 'Stable'}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      {['BEARER', 'API_KEY', 'NONE'].map((mode) => {
                        const active = authMode === mode
                        return (
                          <button
                            key={mode}
                            className={`flex w-full items-center justify-start gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                              active
                                ? 'border-primary bg-primary/10 text-primary-dark'
                                : 'border-border bg-surface-soft text-text hover:bg-surface-inset'
                            }`}
                            onClick={() => void changeAuthMode(mode)}
                            type="button"
                          >
                            <span
                              className={`inline-block h-3 w-3 rounded-full border ${
                                active ? 'border-primary bg-primary' : 'border-muted bg-transparent'
                              }`}
                            />
                            {formatAuthMode(mode)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              ) : null}

              <MetricCard
                icon="⇄"
                label="Active Routes"
                value={`${metrics.routes}`}
                detail={metrics.routes === 1 ? 'endpoint' : 'endpoints'}
              />
              <MetricCard icon="◷" label="Avg Latency" value={metrics.routes === 0 ? '0' : '128'} detail="ms" />
              <MetricCard
                icon="✓"
                label="Error Rate"
                value={`${metrics.routes === 0 ? 0 : metrics.errorRate}%`}
                detail={metrics.routes === 0 ? 'System healthy' : 'Stable'}
              />
            </aside>

            <div className="space-y-6 lg:col-span-5">
              <div className="rounded-2xl border border-border bg-surface-raised p-6 shadow-card">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-3xl font-bold text-text">Service Status</h2>
                  <Badge
                    variant={
                      viewState === 'empty' ? 'neutral' : viewState === 'ready' ? 'success' : viewState === 'error' ? 'error' : 'warning'
                    }
                  >
                    {viewState === 'empty' ? 'Idle' : viewState === 'ready' ? 'Service Stable' : 'Attention'}
                  </Badge>
                </div>
                {viewState === 'empty' ? (
                  <div className="flex min-h-[340px] flex-col items-center justify-center rounded-2xl border border-border bg-surface-soft p-6 text-center shadow-inset">
                    <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-surface-raised shadow-card">
                      <span className="text-3xl text-primary">∅</span>
                    </div>
                    <h3 className="text-3xl font-bold text-text">Waiting for Configuration</h3>
                    <p className="mt-3 max-w-md text-lg text-muted">
                      The mock engine is running but has no rules defined. Import an API spec to begin.
                    </p>
                    <div className="mt-8 flex w-full items-center justify-between border-t border-border pt-4 text-xs font-mono text-muted">
                      <span>UPTIME: 00:00:00</span>
                      <span>MEMORY: 12MB</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-base leading-relaxed text-muted">
                      The mocking engine is currently intercepting requests. Routes are automatically synced with your OpenAPI definition.
                    </p>
                    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <Button className="h-14 text-base font-semibold" onClick={() => setIsImportDialogOpen(true)}>
                        Import OpenAPI
                      </Button>
                      <Button
                        className="h-14 text-base font-semibold"
                        variant="secondary"
                        onClick={() => setIsImportDialogOpen(true)}
                      >
                        Load JSON
                      </Button>
                      <Button
                        className="h-14 text-base font-semibold"
                        variant="secondary"
                        onClick={() => navigate(dataSourcesRoute(integrationId))}
                      >
                        Open Data Sources
                      </Button>
                    </div>
                  </>
                )}
              </div>

              {viewState === 'ready' ? (
                <div className="rounded-2xl border border-border bg-surface-raised shadow-card">
                  <div className="flex items-center justify-between border-b border-border px-5 py-4">
                    <h3 className="text-lg font-bold text-text">Recent Interceptions</h3>
                    <button
                      className="text-sm font-semibold text-primary"
                      onClick={() => navigate(sessionLogsRoute(integrationId))}
                      type="button"
                    >
                      View All
                    </button>
                  </div>
                  <div className="space-y-2 p-3">
                    {INTERCEPTIONS_FIXTURE.map((item) => (
                      <button
                        key={item.id}
                        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-soft"
                        onClick={() => navigate(`${sessionLogsRoute(integrationId)}?q=${encodeURIComponent(item.path)}`)}
                        type="button"
                      >
                        <span className={methodBadgeClass(item.method)}>{toMethodLabel(item.method)}</span>
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-sm text-text">{item.path}</span>
                          <span className="mt-1 flex items-center gap-2 text-xs text-muted">
                            <span className={`h-2 w-2 rounded-full ${item.state === 'ok' ? 'bg-success' : 'bg-warning'}`} />
                            {item.status} • {item.latency}
                          </span>
                        </span>
                        <span className="text-xs text-muted">{item.timestamp}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <aside className="min-h-[620px] lg:col-span-4">
              {viewState === 'empty' ? (
                <div className="flex h-full flex-col rounded-2xl border border-border bg-surface-soft p-8 text-center shadow-inset">
                  <div className="mx-auto mt-10 flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-surface-raised text-4xl text-muted shadow-card">
                    ⌂
                  </div>
                  <h3 className="mt-8 text-4xl font-bold text-text">No Routes Defined</h3>
                  <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted">
                    Your routing tree is currently empty. You can define routes manually or import an OpenAPI specification.
                  </p>
                  <div className="mt-10 space-y-3">
                    <Button className="h-12 w-full text-base font-semibold" onClick={() => setIsImportDialogOpen(true)}>
                      Import Your First API
                    </Button>
                    <Button
                      className="h-12 w-full text-base font-semibold"
                      variant="secondary"
                      onClick={() => navigate(packsRoute(integrationId))}
                    >
                      Create Manual Route
                    </Button>
                  </div>
                  <p className="mt-auto font-mono text-xs text-muted">{'{ "routes": [] }'}</p>
                </div>
              ) : (
                <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-card">
                  <div className="border-b border-border bg-surface-soft px-4 py-4">
                    <div className="relative">
                      <Input
                        className="pl-10"
                        placeholder="Filter routes..."
                        value={routeQuery}
                        onChange={(event) => setRouteQuery(event.target.value)}
                      />
                      <span className="pointer-events-none absolute left-3 top-2 text-muted">⌕</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
                        {routeMethods.map((method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ))}
                      </Select>
                      <Button variant="secondary" onClick={() => setIsImportDialogOpen(true)}>
                        Import
                      </Button>
                    </div>
                  </div>

                  <div className="flex-1 space-y-3 overflow-y-auto p-3">
                    {routeGroups.length === 0 ? (
                      <p className="rounded-xl border border-border bg-surface-soft px-3 py-4 text-sm text-muted">No routes match current filters.</p>
                    ) : (
                      routeGroups.map((group) => (
                        <div key={group.key}>
                          <p className="mb-2 px-2 text-xs font-bold uppercase tracking-[0.12em] text-muted">{group.label}</p>
                          <div className="space-y-1">
                            {group.routes.map((route) => (
                              <div
                                key={route.id}
                                className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 hover:border-primary/20 hover:bg-primary/5"
                              >
                                <button
                                  className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 text-left"
                                  onClick={() => navigate(packEndpointRoute(integrationId, route.packId, route.id))}
                                  type="button"
                                >
                                  <span className={methodBadgeClass(route.method)}>{toMethodLabel(route.method)}</span>
                                  <span className="truncate font-mono text-sm text-text">{route.path}</span>
                                </button>
                                <IconActionButton
                                  label={`Edit route ${route.method} ${route.path}`}
                                  icon={<Pencil className="h-4 w-4" aria-hidden />}
                                  onClick={() => navigate(packEndpointRoute(integrationId, route.packId, route.id))}
                                  className="h-8 w-8 rounded-lg"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="border-t border-border bg-surface-soft p-4">
                    <Button className="w-full" variant="secondary" onClick={() => navigate(packsRoute(integrationId))}>
                      Add Manual Route
                    </Button>
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}

        {importResult ? (
          <div className="mt-6">
            <Alert tone={importResult.errors.length > 0 ? 'warning' : 'success'}>
              Created: {importResult.createdRoutes}, Updated: {importResult.updatedRoutes}, Skipped: {importResult.skippedRoutes}
            </Alert>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
      </div>

      {isImportDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-surface-raised p-6 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-text">Import Routes</h3>
                <p className="text-sm text-muted">Paste OpenAPI, Postman, or cURL payload to synchronize routes.</p>
              </div>
              <IconActionButton
                label="Close import routes modal"
                icon={<X className="h-4 w-4" aria-hidden />}
                onClick={() => setIsImportDialogOpen(false)}
              />
            </div>
            <div className="space-y-3">
              <Select value={importSourceType} onChange={(event) => setImportSourceType(event.target.value as ImportSourceType)}>
                <option value="OPENAPI">OPENAPI</option>
                <option value="POSTMAN">POSTMAN</option>
                <option value="CURL">CURL</option>
              </Select>
              <Textarea
                className="min-h-52 font-mono"
                placeholder="Paste import payload..."
                value={importPayload}
                onChange={(event) => setImportPayload(event.target.value)}
              />
              <div className="flex items-center justify-between">
                <Badge variant={importState === 'error' ? 'error' : importState === 'success' ? 'success' : 'info'}>{importState}</Badge>
                <Button onClick={() => void submitImport()}>{importState === 'importing' ? 'Importing...' : 'Run Import'}</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

interface ImportErrorLayoutProps {
  authMode: string
  integrationId: string
  importState: ImportState
  methodFilter: string
  routeGroups: ReturnType<typeof buildRouteTreeGroups>
  routeQuery: string
  routes: IntegrationRoute[]
  onChangeAuthMode: (mode: string) => Promise<void>
  onFilterMethod: (value: string) => void
  onFilterQuery: (value: string) => void
  onOpenImport: () => void
  onSelectRoute: (route: IntegrationRoute) => void
}

function ImportErrorLayout({
  authMode,
  integrationId,
  importState,
  methodFilter,
  routeGroups,
  routeQuery,
  routes,
  onChangeAuthMode,
  onFilterMethod,
  onFilterQuery,
  onOpenImport,
  onSelectRoute,
}: ImportErrorLayoutProps): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
      <aside className="space-y-6 lg:col-span-3">
        <div className="rounded-2xl border border-border bg-surface-raised p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Active Routes</h3>
            <button className="text-sm font-semibold text-primary" onClick={onOpenImport} type="button">
              +
            </button>
          </div>
          <div className="space-y-2">
            {routes.map((route) => {
              const conflict = route.path.toLowerCase() === '/auth/login'
              return (
                <button
                  key={route.id}
                  className={`w-full rounded-xl border px-3 py-2 text-left ${conflict ? 'border-error/40 bg-error/10' : 'border-border bg-surface-soft hover:bg-surface-inset'}`}
                  onClick={() => onSelectRoute(route)}
                  type="button"
                >
                  <p className={`text-xs font-bold ${conflict ? 'text-error-dark' : 'text-muted'}`}>{toMethodLabel(route.method)}</p>
                  <p className="font-mono text-sm text-text">{route.path}</p>
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface-raised p-4 shadow-card">
          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Auth Mode</h3>
          <div className="mt-3 space-y-2">
            {['BEARER', 'API_KEY', 'NONE'].map((mode) => (
              <button
                key={mode}
                className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-semibold ${
                  authMode === mode ? 'border-primary bg-primary/10 text-primary-dark' : 'border-border bg-surface-soft text-text'
                }`}
                onClick={() => void onChangeAuthMode(mode)}
                type="button"
              >
                {formatAuthMode(mode)}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Scope: /integrations/{integrationId}/auth</p>
        </div>
      </aside>

      <div className="space-y-6 lg:col-span-6">
        <div className="rounded-2xl border border-border bg-surface-raised p-6 shadow-card">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-text">Route Configuration</h2>
              <p className="text-sm text-muted">Path conflict detected during import synchronization.</p>
            </div>
            <Badge variant={importState === 'error' ? 'error' : 'warning'}>Conflict</Badge>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-muted">Method</p>
              <Select value={methodFilter} onChange={(event) => onFilterMethod(event.target.value)}>
                <option value="ALL">ALL</option>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="DELETE">DELETE</option>
              </Select>
            </div>
            <div className="md:col-span-2">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-muted">Endpoint Path</p>
              <Input
                className="border-error/40 bg-error/10 text-error-dark"
                value={routeQuery}
                onChange={(event) => onFilterQuery(event.target.value)}
                placeholder="/auth/login"
              />
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-border bg-surface-soft p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-muted">Response Body</p>
            <pre className="overflow-x-auto text-sm text-text">
{`{
  "status": "error",
  "message": "Invalid credentials",
  "code": 401
}`}
            </pre>
          </div>
        </div>
      </div>

      <aside className="space-y-6 lg:col-span-3">
        <div className="rounded-2xl border border-error/40 bg-error/10 p-5 shadow-card">
          <h3 className="text-xl font-bold text-error-dark">Duplicate Conflict</h3>
          <p className="mt-2 text-sm text-text">
            POST /auth/login is already defined in the current integration. Resolve conflict before continuing.
          </p>
          <div className="mt-3 rounded-xl border border-error/30 bg-surface-raised p-3 text-xs text-muted">
            <p>Existing ID: rt_83k92m</p>
            <p>Created: 2 days ago</p>
          </div>
          <div className="mt-4 space-y-2">
            <Button className="w-full" variant="destructive" onClick={onOpenImport}>
              Resolve Conflict
            </Button>
            <Button className="w-full" variant="secondary" onClick={onOpenImport}>
              Discard Import
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-card">
          <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Route Tree Snapshot</h4>
          <div className="mt-3 space-y-2">
            {routeGroups.map((group) => (
              <div key={group.key}>
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-muted">{group.label}</p>
                {group.routes.map((route) => (
                  <button
                    key={route.id}
                    className="mt-1 flex w-full items-center justify-between rounded-lg bg-surface-soft px-2 py-1 text-left text-xs text-text"
                    onClick={() => onSelectRoute(route)}
                    type="button"
                  >
                    <span className={methodBadgeClass(route.method)}>{toMethodLabel(route.method)}</span>
                    <span className="truncate pl-2 font-mono">{route.path}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  )
}

interface MetricCardProps {
  label: string
  value: string
  detail: string
  icon: string
}

function MetricCard({ detail, icon, label, value }: MetricCardProps): JSX.Element {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-card">
      <div className="flex items-start justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">{label}</p>
        <span className="text-sm font-semibold text-muted">{icon}</span>
      </div>
      <p className="mt-3 text-5xl font-bold text-text">{value}</p>
      <p className="mt-2 text-sm text-muted">{detail}</p>
    </div>
  )
}

function toMethodLabel(method: string): string {
  const normalized = method.toUpperCase()
  if (normalized === 'DELETE') {
    return 'DEL'
  }
  return normalized
}

function methodBadgeClass(method: string): string {
  const normalized = method.toUpperCase()
  if (normalized === 'GET') {
    return 'inline-flex min-w-12 items-center justify-center rounded-md border border-info/30 bg-info/10 px-2 py-0.5 text-[10px] font-bold text-info-dark'
  }
  if (normalized === 'POST') {
    return 'inline-flex min-w-12 items-center justify-center rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success-dark'
  }
  if (normalized === 'DELETE') {
    return 'inline-flex min-w-12 items-center justify-center rounded-md border border-error/30 bg-error/10 px-2 py-0.5 text-[10px] font-bold text-error-dark'
  }
  return 'inline-flex min-w-12 items-center justify-center rounded-md border border-border bg-surface-soft px-2 py-0.5 text-[10px] font-bold text-muted'
}

function formatAuthMode(mode: string): string {
  if (mode === 'API_KEY') {
    return 'API Key'
  }
  if (mode === 'BEARER') {
    return 'Bearer Token'
  }
  return 'None'
}
