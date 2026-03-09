import { useEffect, useMemo, useState } from 'react'
import { useLocation, useParams, useSearchParams } from 'react-router-dom'

import { deriveBundleEViewState } from './state'
import {
  APIError,
  createDebuggerEntity,
  formatAPIError,
  getDataSources,
  getDebuggerEntitiesPage,
  getEntityTimeline,
  rollbackEntity,
} from '../../lib/api'
import type { DataDebuggerEntity, DataSource, EntityTimelineEvent } from '../../types/api'
import { useSessionStore } from '../../app/state/use-session-store'
import { parseBundleEQAState } from '../../shared/lib/qa-state'
import { Alert } from '../../shared/ui/alert'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../shared/ui/card'
import { EmptyState } from '../../shared/ui/empty-state'
import { Input } from '../../shared/ui/input'
import { Select } from '../../shared/ui/select'
import type { CollectionState } from '../../shared/types/ui-state'

const ROLLBACK_MODAL_HISTORY_KEY = '__mockLoomRollbackModal'

const QA_E_SOURCES: DataSource[] = [
  {
    id: 'qa-e-source-1',
    integrationId: 'qa-preview',
    name: 'Wallet Ledger',
    slug: 'wallet-ledger',
    kind: 'JSON',
    status: 'ACTIVE',
    lastSyncAt: '2 mins ago',
    recordCount: 128,
    createdAt: '2026-03-03T00:00:00Z',
    updatedAt: '2026-03-03T00:00:00Z',
  },
]

const QA_E_ENTITIES: DataDebuggerEntity[] = [
  {
    id: 'qa-e-entity-1',
    sourceId: 'qa-e-source-1',
    entityId: 'ENT-9024',
    currentDataJson: '{"type":"User Profile","status":"Active"}',
    updatedAt: '2026-03-03T09:22:00Z',
  },
  {
    id: 'qa-e-entity-2',
    sourceId: 'qa-e-source-1',
    entityId: 'ENT-9021',
    currentDataJson: '{"type":"Transaction","status":"Locked","amount":450}',
    updatedAt: '2026-03-03T09:15:22Z',
  },
  {
    id: 'qa-e-entity-3',
    sourceId: 'qa-e-source-1',
    entityId: 'ENT-8992',
    currentDataJson: '{"type":"Product","status":"Archived"}',
    updatedAt: '2026-03-02T22:30:00Z',
  },
  {
    id: 'qa-e-entity-4',
    sourceId: 'qa-e-source-1',
    entityId: 'ENT-8840',
    currentDataJson: '{"type":"Configuration","status":"Active"}',
    updatedAt: '2026-03-01T14:00:00Z',
  },
]

const QA_E_TIMELINE: EntityTimelineEvent[] = [
  {
    id: 'qa-e-event-1',
    entityId: 'ENT-9021',
    action: 'LOCK',
    diffPayloadJson: '{"rule":"RL-99","result":"locked"}',
    createdAt: '09:15:22',
    triggeredByRequestId: 'req-88f3',
  },
  {
    id: 'qa-e-event-2',
    entityId: 'ENT-9021',
    action: 'UPDATE',
    diffPayloadJson: '{"amount":{"from":120,"to":450}}',
    createdAt: '09:14:55',
    triggeredByRequestId: 'req-8829',
  },
  {
    id: 'qa-e-event-3',
    entityId: 'ENT-9021',
    action: 'RULE_TRIGGERED',
    diffPayloadJson: '{"name":"Validation_Check_v2"}',
    createdAt: '09:14:50',
    triggeredByRequestId: 'req-8810',
  },
  {
    id: 'qa-e-event-4',
    entityId: 'ENT-9021',
    action: 'CREATE',
    diffPayloadJson: '{"source":"webhook"}',
    createdAt: '09:12:00',
    triggeredByRequestId: 'req-8701',
  },
]

function entityStatus(entity: DataDebuggerEntity): 'Synced' | 'Processing' | 'Error' | 'Idle' {
  if (entity.entityId === 'ENT-9021') {
    return 'Processing'
  }
  if (entity.entityId === 'ENT-8992') {
    return 'Error'
  }
  if (entity.entityId === 'ENT-8840') {
    return 'Idle'
  }
  return 'Synced'
}

function entityStatusVariant(status: ReturnType<typeof entityStatus>): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'Synced') {
    return 'success'
  }
  if (status === 'Processing') {
    return 'warning'
  }
  if (status === 'Error') {
    return 'error'
  }
  return 'neutral'
}

function timelineTitle(event: EntityTimelineEvent): string {
  if (event.action === 'LOCK') {
    return 'State Locked'
  }
  if (event.action === 'UPDATE') {
    return 'Value Modified'
  }
  if (event.action === 'RULE_TRIGGERED') {
    return 'Rule Triggered'
  }
  if (event.action === 'CREATE') {
    return 'Entity Created'
  }
  return event.action
}

function readQuery(searchParams: URLSearchParams, key: string, fallback = ''): string {
  const value = searchParams.get(key)
  if (!value) {
    return fallback
  }
  return value
}

function updateQuery(searchParams: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(searchParams)
  if (value.trim() === '') {
    next.delete(key)
  } else {
    next.set(key, value.trim())
  }
  return next
}

export function DataDebuggerScreen(): JSX.Element {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { integrationId = '' } = useParams()
  const token = useSessionStore((state) => state.token)

  const qaState = useMemo(() => parseBundleEQAState(location.search), [location.search])

  const querySourceId = readQuery(searchParams, 'source')
  const queryEntityId = readQuery(searchParams, 'entity')
  const querySearch = readQuery(searchParams, 'search')
  const querySort = readQuery(searchParams, 'sort', 'updated_at_desc')
  const queryCursor = readQuery(searchParams, 'cursor')

  const [sources, setSources] = useState<DataSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [entities, setEntities] = useState<DataDebuggerEntity[]>([])
  const [entitiesState, setEntitiesState] = useState<CollectionState>('loading')
  const [selectedEntityId, setSelectedEntityId] = useState('')
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [total, setTotal] = useState(0)
  const [timeline, setTimeline] = useState<EntityTimelineEvent[]>([])
  const [timelineState, setTimelineState] = useState<CollectionState>('empty')
  const [newEntityId, setNewEntityId] = useState('')
  const [newEntityPayload, setNewEntityPayload] = useState('{\n  \"id\": \"\",\n  \"status\": \"ACTIVE\"\n}')
  const [confirmEventId, setConfirmEventId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!qaState) {
      return
    }

    setSources(QA_E_SOURCES)
    setSelectedSourceId(QA_E_SOURCES[0]?.id || '')
    setEntities(QA_E_ENTITIES)
    setEntitiesState('ready')
    setTotal(QA_E_ENTITIES.length)
    setNextCursor(undefined)
    setError('')

    if (qaState === 'ready') {
      setSelectedEntityId('')
      setTimeline([])
      setTimelineState('empty')
      setConfirmEventId('')
      return
    }

    setSelectedEntityId('ENT-9021')
    setTimeline(QA_E_TIMELINE)
    setTimelineState('ready')
    setConfirmEventId(qaState === 'rollback-confirmation' ? QA_E_TIMELINE[0]?.id || '' : '')
  }, [qaState])

  useEffect(() => {
    if (qaState || !token || integrationId === '') {
      return
    }

    let cancelled = false

    const loadSources = async (): Promise<void> => {
      try {
        const items = await getDataSources(token, integrationId)
        if (cancelled) {
          return
        }
        setSources(items)
        const nextSourceId = items.some((item) => item.id === querySourceId) ? querySourceId : (items[0]?.id ?? '')
        setSelectedSourceId(nextSourceId)
        if (nextSourceId !== querySourceId) {
          const next = updateQuery(searchParams, 'source', nextSourceId)
          next.delete('cursor')
          next.delete('entity')
          setSearchParams(next, { replace: true })
        }
        setError('')
      } catch (requestError) {
        if (!cancelled) {
          setError(formatAPIError(requestError))
        }
      }
    }

    void loadSources()

    return () => {
      cancelled = true
    }
  }, [qaState, token, integrationId, querySourceId, searchParams, setSearchParams])

  useEffect(() => {
    if (qaState || !token || integrationId === '' || selectedSourceId === '') {
      return
    }

    let cancelled = false

    const loadEntities = async (): Promise<void> => {
      setEntitiesState('loading')
      setError('')

      try {
        const page = await getDebuggerEntitiesPage(token, integrationId, selectedSourceId, {
          search: querySearch || undefined,
          sort: querySort || undefined,
          cursor: queryCursor || undefined,
          limit: 25,
        })
        if (cancelled) {
          return
        }

        setEntities(page.items)
        setTotal(page.total || page.items.length)
        setNextCursor(page.nextCursor)
        setEntitiesState(page.items.length === 0 ? 'empty' : 'ready')

        const nextEntityID = page.items.some((item) => item.entityId === queryEntityId)
          ? queryEntityId
          : (page.items[0]?.entityId ?? '')
        setSelectedEntityId(nextEntityID)
        if (nextEntityID !== queryEntityId) {
          setSearchParams(updateQuery(searchParams, 'entity', nextEntityID), { replace: true })
        }
      } catch (requestError) {
        if (cancelled) {
          return
        }
        if (requestError instanceof APIError && requestError.status === 404) {
          setError('Data source not found for current integration.')
        } else {
          setError(formatAPIError(requestError))
        }
        setEntities([])
        setEntitiesState('error')
        setTotal(0)
        setNextCursor(undefined)
      }
    }

    void loadEntities()

    return () => {
      cancelled = true
    }
  }, [qaState, token, integrationId, selectedSourceId, querySearch, querySort, queryCursor, queryEntityId, searchParams, setSearchParams])

  useEffect(() => {
    if (qaState || !token || integrationId === '' || selectedSourceId === '' || selectedEntityId === '') {
      return
    }

    let cancelled = false

    const loadTimeline = async (): Promise<void> => {
      setTimelineState('loading')
      setError('')

      try {
        const events = await getEntityTimeline(token, integrationId, selectedSourceId, selectedEntityId)
        if (cancelled) {
          return
        }

        setTimeline(events)
        setTimelineState(events.length === 0 ? 'empty' : 'ready')
      } catch (requestError) {
        if (!cancelled) {
          setTimeline([])
          setTimelineState('error')
          setError(formatAPIError(requestError))
        }
      }
    }

    void loadTimeline()

    return () => {
      cancelled = true
    }
  }, [qaState, token, integrationId, selectedSourceId, selectedEntityId])

  const filteredEntities = useMemo(() => entities, [entities])

  const selectedEntity = useMemo(
    () => entities.find((entity) => entity.entityId === selectedEntityId) ?? null,
    [entities, selectedEntityId]
  )

  const showTimelinePanel = selectedEntityId !== '' && (timelineState === 'ready' || qaState === 'timeline-details' || qaState === 'rollback-confirmation')

  const bundleViewState = deriveBundleEViewState({
    qaState,
    entitiesState,
    timelineState,
    hasSelectedEntity: selectedEntityId !== '',
    rollbackConfirmOpen: confirmEventId !== '',
    backendBlocked: false,
    error,
  })

  useEffect(() => {
    if (qaState || confirmEventId === '') {
      return
    }

    const baseState = isObjectRecord(window.history.state) ? window.history.state : {}
    window.history.pushState(
      {
        ...baseState,
        [ROLLBACK_MODAL_HISTORY_KEY]: true,
      },
      '',
      window.location.href
    )

    const handlePopState = (): void => {
      setConfirmEventId('')
    }

    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [qaState, confirmEventId])

  function closeRollbackModal(): void {
    if (hasRollbackModalHistoryState(window.history.state)) {
      window.history.back()
      return
    }
    setConfirmEventId('')
  }

  async function confirmRollback(targetEventId: string): Promise<void> {
    if (qaState) {
      closeRollbackModal()
      return
    }

    if (!token || integrationId === '' || selectedSourceId === '' || selectedEntityId === '') {
      return
    }

    try {
      setError('')
      await rollbackEntity(token, integrationId, selectedSourceId, selectedEntityId, targetEventId)
      closeRollbackModal()
      const [refreshedEntitiesPage, refreshedTimeline] = await Promise.all([
        getDebuggerEntitiesPage(token, integrationId, selectedSourceId, {
          search: querySearch || undefined,
          sort: querySort || undefined,
          cursor: queryCursor || undefined,
          limit: 25,
        }),
        getEntityTimeline(token, integrationId, selectedSourceId, selectedEntityId),
      ])
      setEntities(refreshedEntitiesPage.items)
      setTotal(refreshedEntitiesPage.total || refreshedEntitiesPage.items.length)
      setNextCursor(refreshedEntitiesPage.nextCursor)
      setTimeline(refreshedTimeline)
      setEntitiesState(refreshedEntitiesPage.items.length === 0 ? 'empty' : 'ready')
      setTimelineState(refreshedTimeline.length === 0 ? 'empty' : 'ready')
    } catch (requestError) {
      setError(formatAPIError(requestError))
    }
  }

  async function createEntityNow(): Promise<void> {
    if (qaState) {
      return
    }
    if (!token || integrationId === '' || selectedSourceId === '') {
      return
    }

    const nextEntityID = window.prompt('Entity ID', newEntityId.trim() || `ent-${Date.now()}`)
    if (!nextEntityID || nextEntityID.trim() === '') {
      return
    }
    const payloadText = window.prompt('Entity JSON payload', newEntityPayload)
    if (!payloadText || payloadText.trim() === '') {
      return
    }

    let parsedPayload: Record<string, unknown>
    try {
      const parsed = JSON.parse(payloadText) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('payload must be a JSON object')
      }
      parsedPayload = parsed as Record<string, unknown>
    } catch {
      setError('New entity payload must be a valid JSON object.')
      return
    }

    try {
      setError('')
      await createDebuggerEntity(token, integrationId, selectedSourceId, {
        entityId: nextEntityID.trim(),
        payload: parsedPayload,
      })
      setNewEntityId(nextEntityID.trim())
      setNewEntityPayload(JSON.stringify(parsedPayload, null, 2))
      const next = updateQuery(searchParams, 'entity', nextEntityID.trim())
      next.delete('cursor')
      setSearchParams(next)
    } catch (requestError) {
      setError(formatAPIError(requestError))
    }
  }

  if (sources.length === 0 && entitiesState !== 'loading' && !qaState) {
    return (
      <EmptyState
        title="Debugger unavailable"
        description="Create data sources first to inspect entities and rollback timeline events."
      />
    )
  }

  return (
    <section className="min-h-screen bg-surface-base">
      <header className="border-b border-border bg-surface-raised px-5 py-3 md:px-6">
        <div className="flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">▦</div>
            <div>
              <h1 className="text-3xl font-semibold text-text">MockEngine System</h1>
              <p className="font-mono text-xs text-muted">v2.4.0 (Beta)</p>
            </div>
          </div>
          <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Badge variant="info">System Operational</Badge>
            <Input
              aria-label="Search entities"
              className="w-full sm:w-[260px]"
              placeholder="Search entities..."
              value={querySearch}
              onChange={(event) => {
                const next = updateQuery(searchParams, 'search', event.target.value)
                next.delete('cursor')
                setSearchParams(next, { replace: true })
              }}
            />
          </div>
        </div>
      </header>

      <div className="flex w-full flex-col lg:flex-row lg:overflow-hidden">
        <main className="min-w-0 flex-1 px-5 py-6 md:px-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Select
                aria-label="Sort entities"
                className="w-[180px]"
                value={querySort}
                onChange={(event) => {
                  const next = updateQuery(searchParams, 'sort', event.target.value)
                  next.delete('cursor')
                  setSearchParams(next, { replace: true })
                }}
              >
                <option value="updated_at_desc">Sort: Updated (desc)</option>
                <option value="updated_at_asc">Sort: Updated (asc)</option>
                <option value="entity_asc">Sort: Entity (A-Z)</option>
                <option value="entity_desc">Sort: Entity (Z-A)</option>
              </Select>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const next = new URLSearchParams(searchParams)
                  next.delete('search')
                  next.delete('cursor')
                  setSearchParams(next, { replace: true })
                }}
              >
                Clear Filters
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <Select
                aria-label="Select data source"
                className="w-[220px] bg-surface-raised"
                value={selectedSourceId}
                onChange={(event) => {
                  const value = event.target.value
                  setSelectedSourceId(value)
                  const next = updateQuery(searchParams, 'source', value)
                  next.delete('cursor')
                  next.delete('entity')
                  setSearchParams(next)
                }}
              >
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </Select>
              <Button onClick={() => void createEntityNow()}>New Entity</Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-full border-collapse text-left text-sm md:min-w-[760px]">
                  <thead>
                    <tr className="border-b border-border bg-surface-soft text-xs uppercase tracking-wide text-muted">
                      <th className="px-6 py-4">Entity ID</th>
                      <th className="px-6 py-4">Type</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Last Event</th>
                      <th className="px-6 py-4">Timestamp</th>
                      <th className="px-6 py-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntities.map((entity) => {
                      const status = entityStatus(entity)
                      const selected = entity.entityId === selectedEntityId
                      return (
                        <tr
                          key={entity.id}
                          className={[
                            'cursor-pointer border-b border-border/60 transition-colors last:border-b-0',
                            selected ? 'bg-primary/10 shadow-[inset_2px_0_0_0_rgba(67,81,176,1)]' : 'hover:bg-surface-soft',
                          ].join(' ')}
                          aria-label={`Open timeline for ${entity.entityId}`}
                          onClick={() => {
                            setSelectedEntityId(entity.entityId)
                            setSearchParams(updateQuery(searchParams, 'entity', entity.entityId))
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setSelectedEntityId(entity.entityId)
                              setSearchParams(updateQuery(searchParams, 'entity', entity.entityId))
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <td className="px-6 py-4 font-mono font-medium text-text">{entity.entityId}</td>
                          <td className="px-6 py-4 text-muted">{entity.currentDataJson.includes('Transaction') ? 'Transaction' : entity.currentDataJson.includes('Configuration') ? 'Configuration' : 'User Profile'}</td>
                          <td className="px-6 py-4">
                            <Badge variant={entityStatusVariant(status)}>{status}</Badge>
                          </td>
                          <td className="px-6 py-4 text-muted">{status === 'Error' ? 'Delete' : status === 'Processing' ? 'State Locked' : 'Update'}</td>
                          <td className="px-6 py-4 text-muted">{entity.updatedAt.includes('T') ? entity.updatedAt.slice(11, 16) : entity.updatedAt}</td>
                          <td className="px-6 py-4 text-right text-muted">⋯</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm text-muted">
                <p>Showing {filteredEntities.length} of {total} results</p>
                <div className="flex items-center gap-2">
                  <Button
                    aria-label="Previous page"
                    size="sm"
                    variant="secondary"
                    disabled={queryCursor === ''}
                    onClick={() => {
                      const current = Number.parseInt(queryCursor || '0', 10)
                      const previous = Math.max(current - 25, 0)
                      const next = new URLSearchParams(searchParams)
                      if (previous <= 0) {
                        next.delete('cursor')
                      } else {
                        next.set('cursor', String(previous))
                      }
                      setSearchParams(next)
                    }}
                  >
                    ◀
                  </Button>
                  <Button
                    aria-label="Next page"
                    size="sm"
                    variant="secondary"
                    disabled={!nextCursor}
                    onClick={() => {
                      if (!nextCursor) {
                        return
                      }
                      setSearchParams(updateQuery(searchParams, 'cursor', nextCursor))
                    }}
                  >
                    ▶
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {error ? (
            <div className="mt-4">
              <Alert tone="error">{error}</Alert>
            </div>
          ) : null}
        </main>

        {showTimelinePanel ? (
          <aside className="w-full border-t border-border bg-surface-raised lg:max-w-[360px] lg:border-l lg:border-t-0">
            <div className="border-b border-border p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-3xl font-semibold text-text">Details</h2>
                  <p className="mt-3 font-mono text-lg font-bold text-primary">{selectedEntity?.entityId || '-'}</p>
                </div>
                <button
                  aria-label="Close timeline panel"
                  className="text-muted"
                  onClick={() => {
                    setSelectedEntityId('')
                    const next = new URLSearchParams(searchParams)
                    next.delete('entity')
                    setSearchParams(next)
                  }}
                  type="button"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="space-y-3 overflow-y-auto p-5">
              {timeline.map((event) => (
                <article key={event.id} className="rounded-xl border border-border bg-surface-soft p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-text break-all">{timelineTitle(event)}</h3>
                    <span className="font-mono text-xs text-muted">{event.createdAt}</span>
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-muted">{event.diffPayloadJson}</pre>
                  <Button className="mt-3" size="sm" variant="destructive" onClick={() => setConfirmEventId(event.id)}>
                    Revert to this state
                  </Button>
                </article>
              ))}
            </div>
          </aside>
        ) : null}
      </div>

      {confirmEventId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]">
          <Card className="w-full max-w-[520px] shadow-xl">
            <CardHeader>
              <CardTitle>Confirm State Rollback</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted">
                This will revert <span className="font-mono">{selectedEntityId}</span> to a previous state and append a compensation event.
              </p>
              <div className="flex gap-3">
                <Button className="flex-1" variant="secondary" onClick={closeRollbackModal}>Cancel</Button>
                <Button className="flex-1" variant="destructive" onClick={() => void confirmRollback(confirmEventId)}>
                  Confirm Rollback
                </Button>
              </div>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>System Status: Operational</span>
                <span className="text-success">Connected</span>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </section>
  )
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasRollbackModalHistoryState(state: unknown): boolean {
  if (!isObjectRecord(state)) {
    return false
  }
  return state[ROLLBACK_MODAL_HISTORY_KEY] === true
}
