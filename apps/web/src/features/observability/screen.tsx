import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import {
  formatAPIError,
  getAuditEvents,
  getEndpointTraffic,
  getEntityMap,
} from '../../lib/api'
import { useSessionStore } from '../../app/state/use-session-store'
import { Alert } from '../../shared/ui/alert'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../shared/ui/card'
import { Input } from '../../shared/ui/input'
import { Select } from '../../shared/ui/select'
import type { AuditEvent, EntityMapNode, TrafficEvent } from '../../types/api'

function getSearchParam(searchParams: URLSearchParams, key: string, fallback = ''): string {
  const value = searchParams.get(key)
  if (!value) {
    return fallback
  }
  return value
}

function setParam(searchParams: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(searchParams)
  if (value.trim() === '') {
    next.delete(key)
  } else {
    next.set(key, value.trim())
  }
  return next
}

export function SessionLogsScreen(): JSX.Element {
  const { integrationId = '' } = useParams()
  const token = useSessionStore((state) => state.token)
  const [searchParams, setSearchParams] = useSearchParams()

  const [items, setItems] = useState<TrafficEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const query = getSearchParam(searchParams, 'q')

  useEffect(() => {
    if (!token || integrationId === '') {
      return
    }

    let active = true
    const load = async (): Promise<void> => {
      setLoading(true)
      setError('')
      try {
        const response = await getEndpointTraffic(token, integrationId, 'all')
        if (!active) {
          return
        }
        setItems(response)
      } catch (requestError) {
        if (!active) {
          return
        }
        setError(formatAPIError(requestError))
        setItems([])
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [token, integrationId])

  const filtered = useMemo(() => {
    if (query.trim() === '') {
      return items
    }
    const lowered = query.toLowerCase()
    return items.filter((item) => item.requestSummaryJson.toLowerCase().includes(lowered) || (item.matchedScenario || '').toLowerCase().includes(lowered))
  }, [items, query])

  return (
    <section className="min-h-screen bg-surface-base px-5 py-6 md:px-6">
      <div className="w-full space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-text">Session Logs</h1>
            <p className="text-sm text-muted">Runtime request interception events for this integration.</p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Captured Requests</CardTitle>
              <Input
                className="w-full sm:max-w-[300px]"
                placeholder="Filter logs..."
                value={query}
                onChange={(event) => setSearchParams(setParam(searchParams, 'q', event.target.value), { replace: true })}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? <p className="text-sm text-muted">Loading runtime traffic...</p> : null}
            {error ? <Alert tone="error">{error}</Alert> : null}
            {!loading && !error && filtered.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface-soft p-4 text-sm text-muted">No session logs match current filters.</p>
            ) : null}
            {!loading && !error && filtered.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border/70 bg-surface-soft text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">Endpoint</th>
                      <th className="px-4 py-3">Scenario</th>
                      <th className="px-4 py-3">Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => (
                      <tr key={item.id} className="border-b border-border/60 align-top last:border-b-0">
                        <td className="px-4 py-3 font-mono text-xs text-muted">{item.createdAt}</td>
                        <td className="px-4 py-3 text-muted">{item.endpointId || 'integration'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={item.matchedScenario ? 'success' : 'neutral'}>{item.matchedScenario || 'unmatched'}</Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-text break-all">{item.requestSummaryJson}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

export function EntityMapScreen(): JSX.Element {
  const { integrationId = '' } = useParams()
  const token = useSessionStore((state) => state.token)
  const [searchParams, setSearchParams] = useSearchParams()

  const [items, setItems] = useState<EntityMapNode[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const search = getSearchParam(searchParams, 'search')
  const cursor = getSearchParam(searchParams, 'cursor')

  useEffect(() => {
    if (!token || integrationId === '') {
      return
    }

    let active = true
    const load = async (): Promise<void> => {
      setLoading(true)
      setError('')
      try {
        const response = await getEntityMap(token, integrationId, {
          search,
          cursor: cursor || undefined,
          limit: 50,
        })
        if (!active) {
          return
        }
        setItems(response.items)
        setNextCursor(response.nextCursor)
      } catch (requestError) {
        if (!active) {
          return
        }
        setError(formatAPIError(requestError))
        setItems([])
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [token, integrationId, search, cursor])

  return (
    <section className="min-h-screen bg-surface-base px-5 py-6 md:px-6">
      <div className="w-full space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-text">Entity Map</h1>
            <p className="text-sm text-muted">Cross-source entity projection map for this integration.</p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Entities</CardTitle>
              <Input
                className="w-full sm:max-w-[300px]"
                placeholder="Search entity map..."
                value={search}
                onChange={(event) => {
                  const next = setParam(searchParams, 'search', event.target.value)
                  next.delete('cursor')
                  setSearchParams(next, { replace: true })
                }}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? <p className="text-sm text-muted">Loading entity map...</p> : null}
            {error ? <Alert tone="error">{error}</Alert> : null}
            {!loading && !error && items.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface-soft p-4 text-sm text-muted">No entity-map rows available.</p>
            ) : null}
            {!loading && !error && items.length > 0 ? (
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={`${item.sourceId}-${item.entityId}`} className="rounded-xl border border-border bg-surface-soft px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-mono text-sm font-semibold text-text">{item.entityId}</p>
                        <p className="text-xs text-muted">{item.sourceName} • {item.sourceId}</p>
                      </div>
                      <span className="font-mono text-xs text-muted">{item.updatedAt}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={cursor === ''}
                onClick={() => {
                  const next = new URLSearchParams(searchParams)
                  next.delete('cursor')
                  setSearchParams(next)
                }}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!nextCursor}
                onClick={() => {
                  if (!nextCursor) {
                    return
                  }
                  setSearchParams(setParam(searchParams, 'cursor', nextCursor))
                }}
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

export function AuditHistoryScreen(): JSX.Element {
  const { integrationId = '' } = useParams()
  const token = useSessionStore((state) => state.token)
  const [searchParams, setSearchParams] = useSearchParams()

  const [items, setItems] = useState<AuditEvent[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const actor = getSearchParam(searchParams, 'actor')
  const resourceType = getSearchParam(searchParams, 'resourceType')
  const cursor = getSearchParam(searchParams, 'cursor')

  useEffect(() => {
    if (!token || integrationId === '') {
      return
    }

    let active = true
    const load = async (): Promise<void> => {
      setLoading(true)
      setError('')
      try {
        const response = await getAuditEvents(token, integrationId, {
          actor,
          resourceType,
          cursor: cursor || undefined,
          limit: 50,
        })
        if (!active) {
          return
        }
        setItems(response.items)
        setNextCursor(response.nextCursor)
      } catch (requestError) {
        if (!active) {
          return
        }
        setItems([])
        setError(formatAPIError(requestError))
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [token, integrationId, actor, resourceType, cursor])

  return (
    <section className="min-h-screen bg-surface-base px-5 py-6 md:px-6">
      <div className="w-full space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-text">Audit History</h1>
            <p className="text-sm text-muted">Integration-level audit stream for data and runtime operations.</p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <div className="grid gap-3 md:grid-cols-3">
              <Select
                value={resourceType}
                onChange={(event) => {
                  const next = setParam(searchParams, 'resourceType', event.target.value)
                  next.delete('cursor')
                  setSearchParams(next, { replace: true })
                }}
              >
                <option value="">All resources</option>
                <option value="TRAFFIC">TRAFFIC</option>
                <option value="DATA_SOURCE">DATA_SOURCE</option>
              </Select>
              <Input
                placeholder="Filter actor..."
                value={actor}
                onChange={(event) => {
                  const next = setParam(searchParams, 'actor', event.target.value)
                  next.delete('cursor')
                  setSearchParams(next, { replace: true })
                }}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? <p className="text-sm text-muted">Loading audit events...</p> : null}
            {error ? <Alert tone="error">{error}</Alert> : null}
            {!loading && !error && items.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface-soft p-4 text-sm text-muted">No audit events available for current filters.</p>
            ) : null}
            {!loading && !error && items.length > 0 ? (
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border bg-surface-soft px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-text">{item.action}</p>
                        <p className="text-xs text-muted">{item.resourceType} • {item.resourceId} • {item.actor}</p>
                        <p className="text-xs text-muted">{item.summary}</p>
                      </div>
                      <span className="font-mono text-xs text-muted">{item.createdAt}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={cursor === ''}
                onClick={() => {
                  const next = new URLSearchParams(searchParams)
                  next.delete('cursor')
                  setSearchParams(next)
                }}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!nextCursor}
                onClick={() => {
                  if (!nextCursor) {
                    return
                  }
                  setSearchParams(setParam(searchParams, 'cursor', nextCursor))
                }}
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
