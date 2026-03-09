import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as RadixSwitch from '@radix-ui/react-switch'
import { useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Eye, Filter, Highlighter, Pencil, Search, Trash2, X } from 'lucide-react'

import type { DataInspectorState, DataInspectorViewMode, DataInspectorTreeNode, ParsedEntityRow } from './inspector'
import { buildTreeNodes, collectColumns, formatEntityRawJson, parseEntityRows } from './inspector'
import type { BaselinePreviewData, BaselinePreviewState } from './preview'
import { buildBaselinePreview } from './preview'
import {
  buildSchemaTypeDraft,
  buildSchemaUpdatePayload,
  canUploadBaseline,
  deriveBundleDViewState,
  deriveDataSourcesViewState,
  deriveInspectorPager,
  deriveInspectorState,
  hasSchemaWarnings,
  isSchemaDraftDirty,
} from './state'
import {
  APIError,
  createDataSource,
  deleteDataSource,
  formatAPIError,
  getDataSources,
  getDebuggerEntitiesPage,
  getDataSourceHistory,
  getDataSourceSchema,
  syncDataSource,
  updateDataSourceSchema,
  updateDataSource,
  uploadDataSourceBaseline,
} from '../../lib/api'
import type {
  CSVDelimiter,
  DataDebuggerEntity,
  DataSource,
  DataSourceKind,
  DataSourceSchemaField,
  DataSourceSchemaWarning,
  SourceHistoryEvent,
} from '../../types/api'
import { useSessionStore } from '../../app/state/use-session-store'
import { parseBundleDQAState } from '../../shared/lib/qa-state'
import { finalizeSlugInput, formatSlugInput } from '../../shared/lib/slug'
import { Alert } from '../../shared/ui/alert'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../shared/ui/card'
import { EmptyState } from '../../shared/ui/empty-state'
import { IconActionButton } from '../../shared/ui/icon-action-button'
import { Input } from '../../shared/ui/input'
import { Select } from '../../shared/ui/select'
import type { DataSourceUploadState, DataSourcesViewState } from '../../types/api'

interface SourceDraft {
  name: string
  slug: string
  kind: DataSourceKind
}

interface SourceEditDraft {
  name: string
  slug: string
}

const BUNDLE_D_PAGE_SIZE = 4

const QA_D_READY_SOURCES: DataSource[] = [
  {
    id: 'qa-d-source-1',
    integrationId: 'qa-preview',
    name: 'Customer_Base',
    slug: 'customer-base',
    kind: 'JSON',
    status: 'ACTIVE',
    lastSyncAt: '2 mins ago',
    recordCount: 14205,
    createdAt: '2026-03-03T00:00:00Z',
    updatedAt: '2026-03-03T00:00:00Z',
  },
  {
    id: 'qa-d-source-2',
    integrationId: 'qa-preview',
    name: 'Inventory_Feed_V2',
    slug: 'inventory-feed-v2',
    kind: 'CSV',
    status: 'PENDING',
    lastSyncAt: '1 hr ago',
    recordCount: 8450,
    createdAt: '2026-03-03T00:00:00Z',
    updatedAt: '2026-03-03T00:00:00Z',
  },
  {
    id: 'qa-d-source-3',
    integrationId: 'qa-preview',
    name: 'Legacy_Logs_2023',
    slug: 'legacy-logs-2023',
    kind: 'CSV',
    status: 'ERROR',
    lastSyncAt: '2 days ago',
    recordCount: 0,
    createdAt: '2026-03-03T00:00:00Z',
    updatedAt: '2026-03-03T00:00:00Z',
  },
  {
    id: 'qa-d-source-4',
    integrationId: 'qa-preview',
    name: 'Payment_Gateway_Mock',
    slug: 'payment-gateway-mock',
    kind: 'JSON',
    status: 'ACTIVE',
    lastSyncAt: '5 mins ago',
    recordCount: 2100,
    createdAt: '2026-03-03T00:00:00Z',
    updatedAt: '2026-03-03T00:00:00Z',
  },
  {
    id: 'qa-d-source-5',
    integrationId: 'qa-preview',
    name: 'Archive_2024',
    slug: 'archive-2024',
    kind: 'CSV',
    status: 'PENDING',
    lastSyncAt: '3 days ago',
    recordCount: 1520,
    createdAt: '2026-03-03T00:00:00Z',
    updatedAt: '2026-03-03T00:00:00Z',
  },
]

const QA_KIND_LABELS: Record<string, string> = {
  'qa-d-source-1': 'PostgreSQL',
  'qa-d-source-2': 'REST API',
  'qa-d-source-3': 'CSV Upload',
  'qa-d-source-4': 'GraphQL',
  'qa-d-source-5': 'CSV Upload',
}

const CSV_DELIMITER_OPTIONS: Array<{ label: string; value: CSVDelimiter }> = [
  { label: 'Comma (,)', value: 'comma' },
  { label: 'Semicolon (;)', value: 'semicolon' },
  { label: 'Tab (\\t)', value: 'tab' },
  { label: 'Pipe (|)', value: 'pipe' },
]

const SCHEMA_TYPE_OPTIONS = ['string', 'number', 'boolean', 'object', 'array'] as const

function isSchemaTypeOption(value: string): value is (typeof SCHEMA_TYPE_OPTIONS)[number] {
  return (SCHEMA_TYPE_OPTIONS as readonly string[]).includes(value)
}

const INSPECTOR_PAGE_SIZE = 25
const INSPECTOR_SEARCH_DEBOUNCE_MS = 300

const INSPECTOR_SORT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Updated (newest first)', value: 'updated_at_desc' },
  { label: 'Updated (oldest first)', value: 'updated_at_asc' },
  { label: 'Entity (A-Z)', value: 'entity_asc' },
  { label: 'Entity (Z-A)', value: 'entity_desc' },
]

const INSPECTOR_VIEW_MODE_OPTIONS: Array<{ label: string; value: DataInspectorViewMode }> = [
  { label: 'Table', value: 'table' },
  { label: 'Raw', value: 'raw' },
  { label: 'JSON', value: 'tree' },
]

type InspectorSearchMode = 'filter' | 'highlight'

const QA_INSPECTOR_ENTITIES: DataDebuggerEntity[] = [
  {
    id: 'qa-entity-1',
    sourceId: 'qa-d-source-1',
    entityId: 'ENT-9024',
    currentDataJson: '{"name":"Alice","status":"ACTIVE","country":"CL","score":97}',
    updatedAt: '2026-03-03T09:22:00Z',
  },
  {
    id: 'qa-entity-2',
    sourceId: 'qa-d-source-1',
    entityId: 'ENT-9021',
    currentDataJson: '{"name":"Bob","status":"LOCKED","country":"US","score":64}',
    updatedAt: '2026-03-03T09:15:22Z',
  },
  {
    id: 'qa-entity-3',
    sourceId: 'qa-d-source-2',
    entityId: 'ENT-8810',
    currentDataJson: '{"sku":"PRD-991","stock":80,"price":120.5,"active":true}',
    updatedAt: '2026-03-02T22:30:00Z',
  },
  {
    id: 'qa-entity-4',
    sourceId: 'qa-d-source-2',
    entityId: 'ENT-8802',
    currentDataJson: '{invalid json payload',
    updatedAt: '2026-03-02T20:12:00Z',
  },
  {
    id: 'qa-entity-5',
    sourceId: 'qa-d-source-5',
    entityId: 'ENT-7701',
    currentDataJson: '[{\"date\":\"2026-03-01\",\"amount\":1200},{\"date\":\"2026-03-02\",\"amount\":1340}]',
    updatedAt: '2026-03-01T14:00:00Z',
  },
]

type QuickActionPanel = 'schema' | 'history'

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

function statusBadgeVariant(status: DataSource['status']): 'success' | 'warning' | 'error' {
  if (status === 'ACTIVE') {
    return 'success'
  }
  if (status === 'PENDING') {
    return 'warning'
  }
  return 'error'
}

function sourceKindLabel(source: DataSource): string {
  return QA_KIND_LABELS[source.id] || source.kind
}

function previewBadgeVariant(previewState: BaselinePreviewState): 'success' | 'warning' | 'error' | 'info' {
  if (previewState === 'ready') {
    return 'success'
  }
  if (previewState === 'error') {
    return 'error'
  }
  if (previewState === 'skipped-large') {
    return 'warning'
  }
  return 'info'
}

function inspectorBadgeVariant(state: DataInspectorState): 'success' | 'warning' | 'error' | 'info' {
  if (state === 'ready') {
    return 'success'
  }
  if (state === 'error') {
    return 'error'
  }
  if (state === 'empty') {
    return 'warning'
  }
  return 'info'
}

function renderHighlightedText(content: string, query: string): ReactNode {
  const normalizedQuery = query.trim()
  if (normalizedQuery === '') {
    return content
  }

  const lowerContent = content.toLowerCase()
  const lowerNeedle = normalizedQuery.toLowerCase()
  if (!lowerContent.includes(lowerNeedle)) {
    return content
  }

  const parts: ReactNode[] = []
  let cursor = 0
  let chunkIndex = 0

  while (cursor < content.length) {
    const matchIndex = lowerContent.indexOf(lowerNeedle, cursor)
    if (matchIndex === -1) {
      parts.push(content.slice(cursor))
      break
    }

    if (matchIndex > cursor) {
      parts.push(content.slice(cursor, matchIndex))
    }

    const endIndex = matchIndex + lowerNeedle.length
    parts.push(
      <mark key={`match-${chunkIndex}`} className="rounded bg-warning/30 px-0.5 text-text">
        {content.slice(matchIndex, endIndex)}
      </mark>
    )
    chunkIndex += 1
    cursor = endIndex
  }

  return <>{parts}</>
}

function renderInspectorText(content: string, query: string, mode: InspectorSearchMode): ReactNode {
  if (mode !== 'highlight') {
    return content
  }
  return renderHighlightedText(content, query)
}

function compareInspectorEntities(a: DataDebuggerEntity, b: DataDebuggerEntity, sort: string): number {
  if (sort === 'updated_at_asc') {
    return a.updatedAt.localeCompare(b.updatedAt)
  }
  if (sort === 'entity_asc') {
    return a.entityId.localeCompare(b.entityId)
  }
  if (sort === 'entity_desc') {
    return b.entityId.localeCompare(a.entityId)
  }
  return b.updatedAt.localeCompare(a.updatedAt)
}

function getQAPage(params: {
  sourceId: string
  search: string
  sort: string
  cursor: string
  limit: number
}): { items: DataDebuggerEntity[]; nextCursor?: string; total: number } {
  const searchQuery = params.search.trim().toLowerCase()
  const filtered = QA_INSPECTOR_ENTITIES.filter((entity) => {
    if (entity.sourceId !== params.sourceId) {
      return false
    }
    if (searchQuery === '') {
      return true
    }
    return (
      entity.entityId.toLowerCase().includes(searchQuery) ||
      entity.currentDataJson.toLowerCase().includes(searchQuery) ||
      entity.updatedAt.toLowerCase().includes(searchQuery)
    )
  })

  const sorted = [...filtered].sort((left, right) => compareInspectorEntities(left, right, params.sort))

  const offset = Number.parseInt(params.cursor, 10)
  const pageStart = Number.isNaN(offset) ? 0 : Math.max(offset, 0)
  const pageEnd = pageStart + params.limit
  const items = sorted.slice(pageStart, pageEnd)
  const nextCursor = pageEnd < sorted.length ? String(pageEnd) : undefined

  return {
    items,
    nextCursor,
    total: sorted.length,
  }
}

interface InspectorTreeProps {
  node: DataInspectorTreeNode
  query: string
  mode: InspectorSearchMode
  depth?: number
}

function InspectorTree({ node, query, mode, depth = 0 }: InspectorTreeProps): JSX.Element {
  if (node.kind === 'primitive') {
    return (
      <div className="rounded-md border border-border/60 bg-surface-soft px-3 py-2 text-xs">
        <span className="font-semibold text-text">{renderInspectorText(node.key, query, mode)}</span>
        <span className="px-1 text-muted">:</span>
        <span className="font-mono text-text">{renderInspectorText(node.value ?? '', query, mode)}</span>
      </div>
    )
  }

  const childLabel = node.kind === 'array' ? `[${node.children.length}]` : `{${node.children.length}}`

  return (
    <details open={depth < 2} className="rounded-lg border border-border/70 bg-surface-soft p-2">
      <summary className="cursor-pointer text-xs font-semibold text-text">
        {renderInspectorText(node.key, query, mode)} <span className="font-mono text-muted">{childLabel}</span>
      </summary>
      <div className="mt-2 space-y-2 pl-3">
        {node.children.map((child) => (
          <InspectorTree key={child.path} node={child} query={query} mode={mode} depth={depth + 1} />
        ))}
      </div>
    </details>
  )
}

export function DataSourcesScreen(): JSX.Element {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { integrationId = '' } = useParams()
  const token = useSessionStore((state) => state.token)

  const qaState = useMemo(() => parseBundleDQAState(location.search), [location.search])
  const querySearch = readQuery(searchParams, 'search')
  const querySourceId = readQuery(searchParams, 'source')
  const queryPage = Number.parseInt(readQuery(searchParams, 'page', '1'), 10)

  const [dataSources, setDataSources] = useState<DataSource[]>([])
  const [viewState, setViewState] = useState<DataSourcesViewState>('loading')
  const [uploadState, setUploadState] = useState<DataSourceUploadState>('idle')
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [editingSourceId, setEditingSourceId] = useState('')
  const [draft, setDraft] = useState<SourceDraft>({ name: '', slug: '', kind: 'JSON' })
  const [editDraft, setEditDraft] = useState<SourceEditDraft>({ name: '', slug: '' })
  const [busyAction, setBusyAction] = useState('')
  const [notice, setNotice] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [baselineFile, setBaselineFile] = useState<File | null>(null)
  const [csvDelimiter, setCsvDelimiter] = useState<CSVDelimiter>('comma')
  const baselineFileInputRef = useRef<HTMLInputElement | null>(null)
  const [quickActionPanel, setQuickActionPanel] = useState<QuickActionPanel>('schema')
  const [schemaJson, setSchemaJson] = useState('')
  const [schemaFields, setSchemaFields] = useState<DataSourceSchemaField[]>([])
  const [schemaWarnings, setSchemaWarnings] = useState<DataSourceSchemaWarning[]>([])
  const [schemaTypeDraft, setSchemaTypeDraft] = useState<Record<string, string>>({})
  const [sourceHistory, setSourceHistory] = useState<SourceHistoryEvent[]>([])
  const [error, setError] = useState('')
  const [pageIndex, setPageIndex] = useState(Number.isNaN(queryPage) ? 0 : Math.max(queryPage - 1, 0))
  const [uploadErrorModalOpen, setUploadErrorModalOpen] = useState(false)
  const [uploadErrorSummary, setUploadErrorSummary] = useState('')
  const [uploadErrorDetails, setUploadErrorDetails] = useState<string[]>([])
  const [previewState, setPreviewState] = useState<BaselinePreviewState>('idle')
  const [previewData, setPreviewData] = useState<BaselinePreviewData | null>(null)
  const [previewErrors, setPreviewErrors] = useState<string[]>([])
  const [previewMessages, setPreviewMessages] = useState<string[]>([])
  const [previewSourceFingerprint, setPreviewSourceFingerprint] = useState('')
  const previewRunRef = useRef(0)
  const inspectorRunRef = useRef(0)

  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorSourceId, setInspectorSourceId] = useState('')
  const [inspectorViewMode, setInspectorViewMode] = useState<DataInspectorViewMode>('table')
  const [inspectorState, setInspectorState] = useState<DataInspectorState>('idle')
  const [inspectorRows, setInspectorRows] = useState<ParsedEntityRow[]>([])
  const [inspectorColumns, setInspectorColumns] = useState<string[]>([])
  const [inspectorHiddenColumns, setInspectorHiddenColumns] = useState(0)
  const [inspectorSearchMode, setInspectorSearchMode] = useState<InspectorSearchMode>('filter')
  const [inspectorSearchInput, setInspectorSearchInput] = useState('')
  const [inspectorSearch, setInspectorSearch] = useState('')
  const [inspectorSort, setInspectorSort] = useState('updated_at_desc')
  const [inspectorCursor, setInspectorCursor] = useState('')
  const [inspectorCursorHistory, setInspectorCursorHistory] = useState<string[]>([])
  const [inspectorNextCursor, setInspectorNextCursor] = useState<string | undefined>()
  const [inspectorPage, setInspectorPage] = useState(1)
  const [inspectorTotal, setInspectorTotal] = useState(0)
  const [inspectorSelectedEntityId, setInspectorSelectedEntityId] = useState('')
  const [inspectorError, setInspectorError] = useState('')
  const [inspectorLoading, setInspectorLoading] = useState(false)

  useEffect(() => {
    const nextPage = Number.isNaN(queryPage) ? 0 : Math.max(queryPage - 1, 0)
    setPageIndex(nextPage)
  }, [queryPage])

  async function loadDataSourcesList(): Promise<void> {
    if (!token || integrationId === '' || qaState) {
      return
    }

    try {
      setViewState('loading')
      setError('')
      const items = await getDataSources(token, integrationId)
      setDataSources(items)
      setViewState(deriveDataSourcesViewState({ loading: false, items }))

      const nextSourceId = items.some((item) => item.id === querySourceId)
        ? querySourceId
        : (items[0]?.id ?? '')
      setSelectedSourceId(nextSourceId)
      if (nextSourceId !== querySourceId) {
        setSearchParams(updateQuery(searchParams, 'source', nextSourceId), { replace: true })
      }
    } catch (requestError) {
      const message = formatAPIError(requestError)
      setError(message)
      setDataSources([])
      setViewState('error')
    }
  }

  useEffect(() => {
    if (!qaState) {
      void loadDataSourcesList()
      return
    }

    if (qaState === 'empty') {
      setDataSources([])
      setViewState('empty')
      setUploadState('idle')
      setSelectedSourceId('')
      setSchemaJson('')
      setSchemaFields([])
      setSchemaWarnings([])
      setSchemaTypeDraft({})
      setBaselineFile(null)
      setPreviewState('idle')
      setPreviewData(null)
      setPreviewErrors([])
      setPreviewMessages([])
      setPreviewSourceFingerprint('')
      setNotice('')
      setError('')
      setPageIndex(0)
      if (baselineFileInputRef.current) {
        baselineFileInputRef.current.value = ''
      }
      return
    }

    setDataSources(QA_D_READY_SOURCES)
    setSelectedSourceId(QA_D_READY_SOURCES[0]?.id ?? '')
    setViewState('ready')
    setUploadState(qaState === 'upload-error' ? 'error' : 'idle')
    setSchemaJson('')
    setSchemaFields([])
    setSchemaWarnings([])
    setSchemaTypeDraft({})
    setBaselineFile(null)
    setPreviewState('idle')
    setPreviewData(null)
    setPreviewErrors([])
    setPreviewMessages([])
    setPreviewSourceFingerprint('')
    setNotice('')
    setError('')
    setPageIndex(0)
    if (baselineFileInputRef.current) {
      baselineFileInputRef.current.value = ''
    }
  }, [qaState, token, integrationId, querySourceId, searchParams, setSearchParams])

  const selectedSource = useMemo(
    () => dataSources.find((source) => source.id === selectedSourceId) ?? null,
    [dataSources, selectedSourceId]
  )

  const inspectorSource = useMemo(
    () => dataSources.find((source) => source.id === inspectorSourceId) ?? null,
    [dataSources, inspectorSourceId]
  )

  const inspectorSelectedRow = useMemo(
    () => inspectorRows.find((row) => row.entityId === inspectorSelectedEntityId) ?? inspectorRows[0] ?? null,
    [inspectorRows, inspectorSelectedEntityId]
  )

  const inspectorTree = useMemo(() => {
    if (!inspectorSelectedRow || inspectorSelectedRow.invalidJson) {
      return null
    }
    return buildTreeNodes(inspectorSelectedRow.parsedValue)
  }, [inspectorSelectedRow])

  const inspectorPager = useMemo(
    () =>
      deriveInspectorPager({
        cursorHistory: inspectorCursorHistory,
        nextCursor: inspectorNextCursor,
        loading: inspectorLoading,
      }),
    [inspectorCursorHistory, inspectorNextCursor, inspectorLoading]
  )

  const inspectorRequestSearch = useMemo(
    () => (inspectorSearchMode === 'filter' ? inspectorSearch : ''),
    [inspectorSearchMode, inspectorSearch]
  )

  const inspectorHighlightQuery = useMemo(
    () => (inspectorSearchMode === 'highlight' ? inspectorSearch : ''),
    [inspectorSearchMode, inspectorSearch]
  )

  const inspectorViewModeIndex = useMemo(() => {
    const index = INSPECTOR_VIEW_MODE_OPTIONS.findIndex((option) => option.value === inspectorViewMode)
    return index >= 0 ? index : 0
  }, [inspectorViewMode])

  const inspectorRange = useMemo(() => {
    if (inspectorTotal === 0 || inspectorRows.length === 0) {
      return {
        start: 0,
        end: 0,
      }
    }

    const start = Math.min(inspectorTotal, Math.max(1, (inspectorPage - 1) * INSPECTOR_PAGE_SIZE + 1))
    const end = Math.min(inspectorTotal, start + inspectorRows.length - 1)

    return {
      start,
      end,
    }
  }, [inspectorPage, inspectorRows.length, inspectorTotal])

  useEffect(() => {
    const kind = selectedSource?.kind ?? ''
    const delimiterFingerprint = kind === 'CSV' ? csvDelimiter : '-'
    const fileFingerprint =
      baselineFile === null ? '' : `${baselineFile.name}:${baselineFile.size}:${baselineFile.lastModified}`
    const nextFingerprint = `${selectedSourceId}|${kind}|${delimiterFingerprint}|${fileFingerprint}`
    setPreviewSourceFingerprint(nextFingerprint)

    if (qaState || baselineFile === null || selectedSource === null || selectedSourceId === '') {
      previewRunRef.current += 1
      setPreviewState('idle')
      setPreviewData(null)
      setPreviewErrors([])
      setPreviewMessages([])
      return
    }

    const runID = previewRunRef.current + 1
    previewRunRef.current = runID
    setPreviewState('loading')
    setPreviewData(null)
    setPreviewErrors([])
    setPreviewMessages([])

    void (async () => {
      const result = await buildBaselinePreview({
        file: baselineFile,
        sourceKind: selectedSource.kind,
        csvDelimiter,
      })
      if (previewRunRef.current !== runID) {
        return
      }
      if (result.state === 'ready') {
        setPreviewState('ready')
        setPreviewData(result.data)
        setPreviewErrors([])
        setPreviewMessages(result.data.messages)
        return
      }
      if (result.state === 'skipped-large') {
        setPreviewState('skipped-large')
        setPreviewData(null)
        setPreviewErrors([])
        setPreviewMessages(result.messages)
        return
      }
      setPreviewState('error')
      setPreviewData(null)
      setPreviewErrors(result.errors)
      setPreviewMessages([])
    })()
  }, [qaState, baselineFile, selectedSourceId, selectedSource, csvDelimiter])

  useEffect(() => {
    if (editingSourceId === '') {
      return
    }
    if (!dataSources.some((source) => source.id === editingSourceId)) {
      setEditingSourceId('')
      setEditDraft({ name: '', slug: '' })
    }
  }, [dataSources, editingSourceId])

  const bundleViewState = deriveBundleDViewState({
    qaState,
    viewState,
    uploadState,
    error,
  })

  const canSubmitUpload = canUploadBaseline({
    hasFile: baselineFile !== null && selectedSourceId !== '',
    uploadState,
    previewState,
  })
  const schemaDraftDirty = useMemo(
    () =>
      isSchemaDraftDirty({
        fields: schemaFields,
        draft: schemaTypeDraft,
      }),
    [schemaFields, schemaTypeDraft]
  )
  const schemaHasWarnings = useMemo(() => hasSchemaWarnings(schemaWarnings), [schemaWarnings])

  const filteredSources = useMemo(() => {
    if (querySearch.trim() === '') {
      return dataSources
    }
    const lowered = querySearch.toLowerCase()
    return dataSources.filter(
      (source) =>
        source.name.toLowerCase().includes(lowered) ||
        source.slug.toLowerCase().includes(lowered) ||
        source.kind.toLowerCase().includes(lowered)
    )
  }, [dataSources, querySearch])

  const totalPages = Math.max(1, Math.ceil(filteredSources.length / BUNDLE_D_PAGE_SIZE))
  const pagedSources = useMemo(
    () => filteredSources.slice(pageIndex * BUNDLE_D_PAGE_SIZE, (pageIndex + 1) * BUNDLE_D_PAGE_SIZE),
    [filteredSources, pageIndex]
  )

  useEffect(() => {
    if (pageIndex > totalPages - 1) {
      setPageIndex(Math.max(totalPages - 1, 0))
    }
  }, [pageIndex, totalPages])

  useEffect(() => {
    const expected = String(pageIndex + 1)
    if (readQuery(searchParams, 'page', '1') === expected) {
      return
    }
    const next = updateQuery(searchParams, 'page', expected)
    setSearchParams(next, { replace: true })
  }, [pageIndex, searchParams, setSearchParams])

  async function submitCreateSource(): Promise<void> {
    if (!token || integrationId === '' || qaState || busyAction !== '') {
      return
    }

    const cleanedSlug = finalizeSlugInput(draft.slug)

    if (draft.name.trim() === '' || cleanedSlug === '') {
      setError('Data source name and slug are required.')
      return
    }

    try {
      setBusyAction('create-source')
      setError('')
      setNotice('')
      await createDataSource(token, integrationId, {
        name: draft.name.trim(),
        slug: cleanedSlug,
        kind: draft.kind,
      })
      setDraft({ name: '', slug: '', kind: 'JSON' })
      await loadDataSourcesList()
      setNotice('Data source created.')
    } catch (requestError) {
      setError(formatAPIError(requestError))
    } finally {
      setBusyAction('')
    }
  }

  async function submitUpdateSource(sourceId: string): Promise<void> {
    if (!token || integrationId === '' || qaState || busyAction !== '') {
      return
    }
    const targetSource = dataSources.find((source) => source.id === sourceId)
    if (!targetSource) {
      return
    }

    const cleanedSlug = finalizeSlugInput(editDraft.slug)

    if (editDraft.name.trim() === '' || cleanedSlug === '') {
      setError('Data source name and slug are required.')
      return
    }

    try {
      setBusyAction('update-source')
      setError('')
      setNotice('')
      await updateDataSource(token, integrationId, targetSource.id, {
        name: editDraft.name.trim(),
        slug: cleanedSlug,
      })
      await loadDataSourcesList()
      setEditingSourceId('')
      setNotice('Data source updated.')
    } catch (requestError) {
      setError(formatAPIError(requestError))
    } finally {
      setBusyAction('')
    }
  }

  async function submitDeleteSource(): Promise<void> {
    if (!token || integrationId === '' || qaState || busyAction !== '' || !selectedSource) {
      return
    }

    try {
      setBusyAction('delete-source')
      setError('')
      setNotice('')
      await deleteDataSource(token, integrationId, selectedSource.id)
      setDeleteDialogOpen(false)
      await loadDataSourcesList()
      setNotice('Data source deleted.')
    } catch (requestError) {
      setError(formatAPIError(requestError))
    } finally {
      setBusyAction('')
    }
  }

  async function submitUploadBaseline(): Promise<void> {
    if (!token || integrationId === '' || selectedSourceId === '' || qaState) {
      return
    }

    if (!canSubmitUpload || !baselineFile) {
      setUploadState('error')
      setError('Preview must be ready before uploading the baseline file.')
      return
    }

    try {
      setUploadErrorModalOpen(false)
      setUploadErrorSummary('')
      setUploadErrorDetails([])
      setUploadState('uploading')
      setError('')
      await uploadDataSourceBaseline(token, integrationId, selectedSourceId, baselineFile, {
        csvDelimiter: selectedSource?.kind === 'CSV' ? csvDelimiter : undefined,
      })
      setUploadState('validating')
      await loadDataSourcesList()
      setUploadState('success')
      setBaselineFile(null)
      setPreviewState('idle')
      setPreviewData(null)
      setPreviewErrors([])
      setPreviewMessages([])
      setPreviewSourceFingerprint('')
      if (baselineFileInputRef.current) {
        baselineFileInputRef.current.value = ''
      }
    } catch (requestError) {
      setUploadState('error')
      setError('')
      if (requestError instanceof APIError) {
        setUploadErrorSummary(requestError.message || 'Upload failed.')
        setUploadErrorDetails(
          requestError.details.length > 0
            ? requestError.details
            : [requestError.message || 'The upload failed without additional details.']
        )
      } else {
        setUploadErrorSummary('Upload failed.')
        setUploadErrorDetails([formatAPIError(requestError)])
      }
      setUploadErrorModalOpen(true)
      await loadDataSourcesList()
    }
  }

  async function runSyncNow(): Promise<void> {
    if (!token || integrationId === '' || selectedSourceId === '' || qaState) {
      return
    }
    try {
      setError('')
      await syncDataSource(token, integrationId, selectedSourceId)
      await loadDataSourcesList()
      if (quickActionPanel === 'history') {
        const history = await getDataSourceHistory(token, integrationId, selectedSourceId, { limit: 20 })
        setSourceHistory(history.items)
      }
    } catch (requestError) {
      setError(formatAPIError(requestError))
    }
  }

  async function submitSchemaChanges(): Promise<void> {
    if (!token || integrationId === '' || selectedSourceId === '' || qaState || busyAction !== '') {
      return
    }
    if (!schemaDraftDirty) {
      return
    }

    const fields = buildSchemaUpdatePayload({
      fields: schemaFields,
      draft: schemaTypeDraft,
    })
    if (fields.length === 0) {
      setError('Schema fields are unavailable for the selected source.')
      return
    }

    try {
      setBusyAction('save-schema')
      setError('')
      setNotice('')
      const schema = await updateDataSourceSchema(token, integrationId, selectedSourceId, { fields })
      setSchemaJson(schema.schemaJson)
      setSchemaFields(schema.fields)
      setSchemaWarnings(schema.warnings)
      setSchemaTypeDraft(buildSchemaTypeDraft(schema.fields))
      setNotice('Schema updated.')
    } catch (requestError) {
      setError(formatAPIError(requestError))
    } finally {
      setBusyAction('')
    }
  }

  function resetSchemaDraft(): void {
    setSchemaTypeDraft(buildSchemaTypeDraft(schemaFields))
  }

  async function loadQuickActionPanel(panel: QuickActionPanel): Promise<void> {
    if (!token || integrationId === '' || selectedSourceId === '' || qaState) {
      return
    }
    setQuickActionPanel(panel)
    try {
      setError('')
      if (panel === 'schema') {
        const schema = await getDataSourceSchema(token, integrationId, selectedSourceId)
        setSchemaJson(schema.schemaJson)
        setSchemaFields(schema.fields)
        setSchemaWarnings(schema.warnings)
        setSchemaTypeDraft(buildSchemaTypeDraft(schema.fields))
        return
      }
      const history = await getDataSourceHistory(token, integrationId, selectedSourceId, { limit: 20 })
      setSourceHistory(history.items)
    } catch (requestError) {
      setError(formatAPIError(requestError))
    }
  }

  function clearInspectorEphemeralState(): void {
    inspectorRunRef.current += 1
    setInspectorOpen(false)
    setInspectorSourceId('')
    setInspectorViewMode('table')
    setInspectorState('idle')
    setInspectorRows([])
    setInspectorColumns([])
    setInspectorHiddenColumns(0)
    setInspectorSearchMode('filter')
    setInspectorSearchInput('')
    setInspectorSearch('')
    setInspectorSort('updated_at_desc')
    setInspectorCursor('')
    setInspectorCursorHistory([])
    setInspectorNextCursor(undefined)
    setInspectorPage(1)
    setInspectorTotal(0)
    setInspectorSelectedEntityId('')
    setInspectorError('')
    setInspectorLoading(false)
  }

  function openInspectorModal(source: DataSource): void {
    inspectorRunRef.current += 1
    setInspectorOpen(true)
    setInspectorSourceId(source.id)
    setInspectorViewMode('table')
    setInspectorState('loading')
    setInspectorRows([])
    setInspectorColumns([])
    setInspectorHiddenColumns(0)
    setInspectorSearchMode('filter')
    setInspectorSearchInput('')
    setInspectorSearch('')
    setInspectorSort('updated_at_desc')
    setInspectorCursor('')
    setInspectorCursorHistory([])
    setInspectorNextCursor(undefined)
    setInspectorPage(1)
    setInspectorTotal(0)
    setInspectorSelectedEntityId('')
    setInspectorError('')
    setInspectorLoading(true)
  }

  function clearInspectorFilters(): void {
    setInspectorSearchInput('')
    setInspectorSearch('')
    setInspectorSort('updated_at_desc')
    setInspectorCursor('')
    setInspectorCursorHistory([])
    setInspectorPage(1)
  }

  function goInspectorNextPage(): void {
    if (!inspectorNextCursor || !inspectorPager.canNext) {
      return
    }
    setInspectorCursorHistory((current) => [...current, inspectorCursor])
    setInspectorCursor(inspectorNextCursor)
    setInspectorPage((current) => current + 1)
  }

  function goInspectorPreviousPage(): void {
    if (!inspectorPager.canPrevious) {
      return
    }
    const previousCursor = inspectorCursorHistory[inspectorCursorHistory.length - 1]
    setInspectorCursorHistory((current) => current.slice(0, -1))
    setInspectorCursor(previousCursor ?? '')
    setInspectorPage((current) => Math.max(1, current - 1))
  }

  function beginInlineEdit(source: DataSource): void {
    setSelectedSourceId(source.id)
    setEditDraft({ name: source.name, slug: source.slug })
    setEditingSourceId(source.id)
    setSearchParams(updateQuery(searchParams, 'source', source.id))
  }

  function cancelInlineEdit(): void {
    setEditingSourceId('')
    setEditDraft({ name: '', slug: '' })
  }

  useEffect(() => {
    if (qaState) {
      return
    }
    if (selectedSourceId === '') {
      setSchemaJson('')
      setSchemaFields([])
      setSchemaWarnings([])
      setSchemaTypeDraft({})
      setSourceHistory([])
      return
    }
    void loadQuickActionPanel(quickActionPanel)
  }, [qaState, selectedSourceId])

  useEffect(() => {
    if (!inspectorOpen) {
      return
    }

    const timeoutID = window.setTimeout(() => {
      const normalizedSearch = inspectorSearchInput.trim()
      setInspectorCursor('')
      setInspectorCursorHistory([])
      setInspectorPage(1)
      setInspectorSearch(normalizedSearch)
    }, INSPECTOR_SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeoutID)
    }
  }, [inspectorOpen, inspectorSearchInput])

  useEffect(() => {
    if (!inspectorOpen) {
      return
    }
    setInspectorCursor('')
    setInspectorCursorHistory([])
    setInspectorPage(1)
  }, [inspectorOpen, inspectorSearchMode])

  useEffect(() => {
    if (!inspectorOpen || inspectorSourceId === '') {
      return
    }
    if (dataSources.some((source) => source.id === inspectorSourceId)) {
      return
    }
    clearInspectorEphemeralState()
  }, [inspectorOpen, inspectorSourceId, dataSources])

  useEffect(() => {
    if (!inspectorOpen || inspectorSourceId === '') {
      return
    }
    if (!qaState && (!token || integrationId === '')) {
      return
    }

    let cancelled = false
    const runID = inspectorRunRef.current + 1
    inspectorRunRef.current = runID
    const requestToken = token ?? ''

    setInspectorLoading(true)
    setInspectorState('loading')
    setInspectorError('')

    void (async () => {
      try {
        const page = qaState
          ? getQAPage({
              sourceId: inspectorSourceId,
              search: inspectorRequestSearch,
              sort: inspectorSort,
              cursor: inspectorCursor,
              limit: INSPECTOR_PAGE_SIZE,
            })
          : await getDebuggerEntitiesPage(requestToken, integrationId, inspectorSourceId, {
              search: inspectorRequestSearch || undefined,
              sort: inspectorSort || undefined,
              cursor: inspectorCursor || undefined,
              limit: INSPECTOR_PAGE_SIZE,
            })

        if (cancelled || inspectorRunRef.current !== runID) {
          return
        }

        const parsedRows = parseEntityRows(page.items)
        const columnResult = collectColumns(parsedRows)

        setInspectorRows(parsedRows)
        setInspectorColumns(columnResult.columns)
        setInspectorHiddenColumns(columnResult.hiddenColumns)
        setInspectorNextCursor(page.nextCursor)
        setInspectorTotal(page.total ?? parsedRows.length)
        setInspectorSelectedEntityId((current) =>
          parsedRows.some((row) => row.entityId === current) ? current : (parsedRows[0]?.entityId ?? '')
        )
        setInspectorState(
          deriveInspectorState({
            loading: false,
            error: '',
            rows: parsedRows,
          })
        )
      } catch (requestError) {
        if (cancelled || inspectorRunRef.current !== runID) {
          return
        }
        setInspectorRows([])
        setInspectorColumns([])
        setInspectorHiddenColumns(0)
        setInspectorNextCursor(undefined)
        setInspectorTotal(0)
        setInspectorSelectedEntityId('')
        setInspectorError(formatAPIError(requestError))
        setInspectorState('error')
      } finally {
        if (!cancelled && inspectorRunRef.current === runID) {
          setInspectorLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [inspectorOpen, inspectorSourceId, inspectorRequestSearch, inspectorSort, inspectorCursor, qaState, token, integrationId])

  if (bundleViewState === 'loading') {
    return <EmptyState title="Loading data sources" description="Initializing Data Sources Manager state..." />
  }

  if (bundleViewState === 'empty' && qaState === 'empty') {
    return (
      <section className="min-h-screen bg-surface-base pb-10">
        <header className="border-b border-border bg-surface-raised px-6 py-4 md:px-8">
          <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">▦</div>
              <div>
                <h1 className="text-4xl font-semibold leading-tight text-text sm:text-xl sm:leading-normal">Data Sources Manager</h1>
              </div>
            </div>
            <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:flex-nowrap">
              <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success-dark">System Operational</span>
              <Button onClick={() => document.getElementById('create-data-source-form')?.scrollIntoView({ behavior: 'smooth' })}>
                New Data Source
              </Button>
            </div>
          </div>
        </header>

        <div className="grid w-full gap-6 px-6 pt-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:px-8">
          <Card className="border-border">
            <CardHeader>
              <CardTitle>Connected Sources</CardTitle>
              <p className="text-sm text-muted">Manage your database connections and file uploads used for mock data generation.</p>
            </CardHeader>
            <CardContent>
              <div className="rounded-2xl border border-border bg-surface-soft px-6 py-16 text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-raised text-3xl text-muted">⊘</div>
                <h3 className="text-3xl font-semibold text-text">No Data Sources Connected</h3>
                <p className="mx-auto mt-3 max-w-xl text-lg text-muted">
                  Link your databases or upload JSON/CSV files to fuel your mock rules. Once connected, your mock APIs can serve dynamic data instantly.
                </p>
                <Button className="mt-8" onClick={() => document.getElementById('create-data-source-form')?.scrollIntoView({ behavior: 'smooth' })}>
                  Connect First Source
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4 opacity-60">
            <Card>
              <CardHeader>
                <CardTitle>Quick Upload</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl border-2 border-dashed border-border bg-surface-soft p-10 text-center text-sm text-muted">Drag & drop files here</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Source Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted">
                <p>Total Records: --</p>
                <p>Last Sync: --</p>
                <p>Status: --</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="min-h-screen bg-surface-base pb-10">
      <header className="border-b border-border bg-surface-raised px-6 py-4 md:px-8">
        <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">▦</div>
              <h1 className="text-4xl font-semibold leading-tight text-text sm:leading-normal">Data Sources</h1>
            </div>
            <p className="mt-1 text-base text-muted">Manage inputs for your rule-based mocking engine.</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:flex-nowrap">
            <Button variant="secondary" onClick={() => void runSyncNow()} disabled={selectedSourceId === '' || Boolean(qaState)}>
              Sync Now
            </Button>
            <Button onClick={() => document.getElementById('create-data-source-form')?.scrollIntoView({ behavior: 'smooth' })}>
              New Data Source
            </Button>
          </div>
        </div>
      </header>

      <div className="grid w-full gap-6 px-6 pt-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:px-8">
        <div className="space-y-6">
          {notice ? <Alert tone="success">{notice}</Alert> : null}

          <Card className="overflow-hidden border-border">
            <CardHeader className="border-b border-border/70">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Connected Sources</CardTitle>
                <Input
                  className="w-full sm:max-w-[260px]"
                  placeholder="Search sources..."
                  value={querySearch}
                  onChange={(event) => {
                    const next = updateQuery(searchParams, 'search', event.target.value)
                    next.delete('page')
                    setSearchParams(next, { replace: true })
                  }}
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-full border-collapse text-center text-sm md:min-w-[980px]">
                  <thead>
                    <tr className="border-b border-border/70 bg-surface-soft text-xs uppercase tracking-wide text-muted">
                      <th className="px-6 py-3">Name</th>
                      <th className="px-6 py-3">Slug</th>
                      <th className="px-6 py-3">Kind</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Records</th>
                      <th className="px-6 py-3">Last sync</th>
                      <th className="px-6 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedSources.map((source) => {
                      const isSelected = source.id === selectedSourceId
                      const isEditing = source.id === editingSourceId
                      return (
                        <tr
                          key={source.id}
                          className={[
                            'cursor-pointer border-b border-border/50 transition-colors',
                            isSelected ? 'bg-primary/10 shadow-[inset_2px_0_0_0_rgba(67,81,176,1)]' : 'hover:bg-surface-soft',
                          ].join(' ')}
                          onClick={() => {
                            setSelectedSourceId(source.id)
                            const next = updateQuery(searchParams, 'source', source.id)
                            setSearchParams(next)
                          }}
                        >
                          <td className="px-6 py-4 font-semibold text-text">
                            {isEditing ? (
                              <Input
                                placeholder="Source name"
                                value={editDraft.name}
                                onChange={(event) => setEditDraft((current) => ({ ...current, name: event.target.value }))}
                                onClick={(event) => event.stopPropagation()}
                              />
                            ) : (
                              source.name
                            )}
                          </td>
                          <td className="px-6 py-4 text-muted">
                            {isEditing ? (
                              <Input
                                placeholder="Source slug"
                                value={editDraft.slug}
                                onChange={(event) => setEditDraft((current) => ({ ...current, slug: formatSlugInput(event.target.value) }))}
                                onBlur={(event) =>
                                  setEditDraft((current) => ({ ...current, slug: finalizeSlugInput(event.target.value) }))
                                }
                                onClick={(event) => event.stopPropagation()}
                              />
                            ) : (
                              <span className="font-mono text-xs text-muted">{source.slug}</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-muted">{sourceKindLabel(source)}</td>
                          <td className="px-6 py-4">
                            <Badge variant={statusBadgeVariant(source.status)}>{source.status}</Badge>
                          </td>
                          <td className="px-6 py-4 font-mono text-text">{source.recordCount.toLocaleString('en-US')}</td>
                          <td className="px-6 py-4 text-muted">{source.lastSyncAt || '-'}</td>
                          <td className="px-6 py-4">
                            <div className="flex justify-center gap-2">
                              <IconActionButton
                                label={`Open data inspector for ${source.name}`}
                                icon={<Eye className="h-4 w-4" aria-hidden="true" />}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  openInspectorModal(source)
                                }}
                              />
                              {isEditing ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      void submitUpdateSource(source.id)
                                    }}
                                    disabled={Boolean(qaState) || busyAction !== ''}
                                  >
                                    {busyAction === 'update-source' ? 'Saving...' : 'Save'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      cancelInlineEdit()
                                    }}
                                    disabled={busyAction !== ''}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <IconActionButton
                                  label={`Edit data source ${source.name}`}
                                  icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    beginInlineEdit(source)
                                  }}
                                  disabled={Boolean(qaState) || busyAction !== ''}
                                  disabledReason="Action unavailable while another data source operation is running."
                                />
                              )}
                              <IconActionButton
                                label={`Delete data source ${source.name}`}
                                icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                                destructive
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setSelectedSourceId(source.id)
                                  setDeleteDialogOpen(true)
                                }}
                                disabled={Boolean(qaState) || busyAction !== ''}
                                disabledReason="Action unavailable while another data source operation is running."
                              />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-border/60 bg-surface-soft px-4 py-3 text-xs text-muted">
                <span>
                  Showing {filteredSources.length === 0 ? 0 : pageIndex * BUNDLE_D_PAGE_SIZE + 1}-{Math.min((pageIndex + 1) * BUNDLE_D_PAGE_SIZE, filteredSources.length)} of {filteredSources.length} data sources
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pageIndex === 0}
                    onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pageIndex >= totalPages - 1}
                    onClick={() => setPageIndex((current) => Math.min(totalPages - 1, current + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card id="create-data-source-form">
            <CardHeader>
              <CardTitle>Create Data Source</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <Input
                  placeholder="Source name"
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                />
                <Input
                  placeholder="Source slug"
                  value={draft.slug}
                  onChange={(event) => setDraft((current) => ({ ...current, slug: formatSlugInput(event.target.value) }))}
                  onBlur={(event) => setDraft((current) => ({ ...current, slug: finalizeSlugInput(event.target.value) }))}
                />
                <Select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as DataSourceKind }))}>
                  <option value="JSON">JSON</option>
                  <option value="CSV">CSV</option>
                </Select>
              </div>
              <Button variant="secondary" onClick={() => void submitCreateSource()} disabled={Boolean(qaState)}>
                Create source
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Distribution</p>
                <p className="mt-2 text-4xl font-semibold text-text">98.2%</p>
                <p className="text-xs text-success">Valid Records</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Latency</p>
                <p className="mt-2 text-4xl font-semibold text-text">45ms</p>
                <p className="text-xs text-muted">Average query time</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Storage</p>
                <p className="mt-2 text-4xl font-semibold text-text">2.4 GB</p>
                <p className="text-xs text-warning">Approaching limit (80%)</p>
              </CardContent>
            </Card>
          </div>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs text-muted">
                <button
                  className={`rounded-xl p-3 ${quickActionPanel === 'schema' ? 'bg-primary/10 text-primary-dark' : 'bg-surface-soft'}`}
                  onClick={() => void loadQuickActionPanel('schema')}
                  type="button"
                >
                  Schema
                </button>
                <button
                  className={`rounded-xl p-3 ${quickActionPanel === 'history' ? 'bg-primary/10 text-primary-dark' : 'bg-surface-soft'}`}
                  onClick={() => void loadQuickActionPanel('history')}
                  type="button"
                >
                  History
                </button>
              </div>
              {quickActionPanel === 'schema' ? (
                <div className="space-y-3">
                  {schemaFields.length === 0 ? (
                    <p className="rounded-xl border border-border bg-surface-soft p-3 text-xs text-muted">
                      Schema unavailable for selected source.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <div className="hidden rounded-lg border border-border/70 bg-surface-soft px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted sm:grid sm:grid-cols-[minmax(0,1fr)_140px] sm:gap-3">
                        <span>Field</span>
                        <span>Type</span>
                      </div>
                      <div className="max-h-[220px] space-y-2 overflow-y-auto overflow-x-hidden pr-1">
                        {schemaFields.map((field) => {
                          const selectedType = schemaTypeDraft[field.key] ?? field.effectiveType
                          const hasLegacyType = !isSchemaTypeOption(selectedType)

                          return (
                            <div
                              key={field.key}
                              className="grid gap-2 rounded-lg border border-border/70 bg-surface-soft px-3 py-2 sm:grid-cols-[minmax(0,1fr)_140px] sm:items-center sm:gap-3"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-mono text-xs text-text">{field.key}</p>
                                <p className="text-[11px] text-muted">
                                  Inferred: <span className="font-mono">{field.inferredType}</span>
                                </p>
                              </div>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted sm:hidden">Type</p>
                              <Select
                                value={selectedType}
                                onChange={(event) =>
                                  setSchemaTypeDraft((current) => ({
                                    ...current,
                                    [field.key]: event.target.value,
                                  }))
                                }
                                disabled={Boolean(qaState) || busyAction !== ''}
                                aria-label={`Schema type for ${field.key}`}
                                className="h-9 w-full"
                              >
                                {hasLegacyType ? (
                                  <option value={selectedType} disabled>
                                    {selectedType} (legacy)
                                  </option>
                                ) : null}
                                {SCHEMA_TYPE_OPTIONS.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </Select>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {schemaHasWarnings ? (
                    <Alert tone="warning">
                      <p className="text-xs font-semibold">Type mismatches detected in current records.</p>
                      <div className="mt-2 space-y-1 text-xs">
                        {schemaWarnings.map((warning) => (
                          <p key={warning.key} className="font-mono">
                            {warning.key}: expected {warning.expectedType}, mismatches {warning.mismatchCount}
                          </p>
                        ))}
                      </div>
                    </Alert>
                  ) : null}

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!schemaDraftDirty || busyAction !== '' || Boolean(qaState)}
                      onClick={resetSchemaDraft}
                    >
                      Reset
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!schemaDraftDirty || busyAction !== '' || Boolean(qaState)}
                      onClick={() => void submitSchemaChanges()}
                    >
                      {busyAction === 'save-schema' ? 'Saving...' : 'Save schema'}
                    </Button>
                  </div>

                  <details className="rounded-xl border border-border bg-surface-soft p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-text">View raw schema JSON</summary>
                    <pre className="mt-2 max-h-[180px] overflow-auto text-xs text-muted">{schemaJson || '{}'}</pre>
                  </details>
                </div>
              ) : null}
              {quickActionPanel === 'history' ? (
                <div className="max-h-[220px] space-y-2 overflow-auto">
                  {sourceHistory.length === 0 ? (
                    <p className="rounded-xl border border-border bg-surface-soft p-3 text-xs text-muted">No history events available.</p>
                  ) : (
                    sourceHistory.map((item) => (
                      <div key={item.id} className="rounded-xl border border-border bg-surface-soft p-3">
                        <p className="text-xs font-semibold text-text">{item.action} • {item.entityId}</p>
                        <p className="text-[11px] text-muted">{item.createdAt}</p>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className={bundleViewState === 'upload-error' ? 'border-error/40 ring-1 ring-error/30' : ''}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Baseline Upload</CardTitle>
                <Badge
                  className="ml-1 shrink-0"
                  variant={uploadState === 'error' ? 'error' : uploadState === 'success' ? 'success' : 'info'}
                >
                  {uploadState}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select
                value={selectedSourceId}
                onChange={(event) => {
                  const value = event.target.value
                  setSelectedSourceId(value)
                  setSearchParams(updateQuery(searchParams, 'source', value))
                }}
              >
                {dataSources.length === 0 ? <option value="">No sources</option> : null}
                {dataSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </Select>
              <Select
                value={csvDelimiter}
                onChange={(event) => setCsvDelimiter(event.target.value as CSVDelimiter)}
                disabled={selectedSource?.kind !== 'CSV'}
                aria-label="Select CSV delimiter"
              >
                {CSV_DELIMITER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted">CSV delimiter (used only when the selected source kind is CSV).</p>
              <input
                ref={baselineFileInputRef}
                className="hidden"
                type="file"
                accept=".json,.csv,application/json,text/csv"
                onChange={(event) => {
                  setUploadState('idle')
                  setBaselineFile(event.target.files?.[0] ?? null)
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => baselineFileInputRef.current?.click()}
                  disabled={uploadState === 'uploading'}
                >
                  Select File
                </Button>
                <div className="min-w-0 flex-1 truncate rounded-xl border border-border bg-surface-soft px-3 py-2 text-sm text-muted">
                  {baselineFile ? baselineFile.name : 'No file selected'}
                </div>
              </div>
              <div className="space-y-3 rounded-xl border border-border/70 bg-surface-soft p-3" data-preview-fingerprint={previewSourceFingerprint}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-text">Preview</p>
                  <Badge variant={previewBadgeVariant(previewState)}>{previewState}</Badge>
                </div>

                {previewState === 'idle' ? (
                  <p className="text-xs text-muted">Select a file to generate preview before upload.</p>
                ) : null}

                {previewState === 'loading' ? (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                    <span>Generating preview...</span>
                  </div>
                ) : null}

                {previewState === 'error' ? (
                  <Alert tone="error">
                    <p className="font-medium">Preview failed.</p>
                    {previewErrors.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
                        {previewErrors.map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </Alert>
                ) : null}

                {previewState === 'skipped-large' ? (
                  <Alert tone="warning">
                    {previewMessages[0] || 'Preview skipped due file size; upload is still allowed.'}
                  </Alert>
                ) : null}

                {previewState === 'ready' && previewData ? (
                  <div className="space-y-3">
                    <p className="text-xs text-muted">
                      Format: {previewData.format} • Columns shown: {previewData.columns.length} • Rows shown: {previewData.rows.length}
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-border bg-surface-raised">
                      <table className="min-w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b border-border/70 bg-surface-soft text-muted">
                            {previewData.columns.map((column) => (
                              <th key={column} className="px-3 py-2 font-semibold">
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.rows.map((row, index) => (
                            <tr key={`preview-row-${index}`} className="border-b border-border/40 last:border-b-0">
                              {previewData.columns.map((column) => (
                                <td key={`${column}-${index}`} className="max-w-[220px] truncate px-3 py-2 text-text">
                                  {row[column] ?? ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {previewData.rawJsonSnippet ? (
                      <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-surface-raised p-3 text-[11px] text-muted">
                        {previewData.rawJsonSnippet}
                      </pre>
                    ) : null}
                    {previewData.messages.length > 0 ? (
                      <ul className="list-disc space-y-1 pl-4 text-[11px] text-muted">
                        {previewData.messages.map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <Button onClick={() => void submitUploadBaseline()} disabled={!canSubmitUpload}>
                {uploadState === 'uploading' ? 'Uploading...' : 'Upload File'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-muted">Last Sync</span>
                <span className="font-mono text-text">{selectedSource?.lastSyncAt || '-'}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-muted">Success Rate</span>
                <span className="font-semibold text-success">99.9%</span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-muted">Owner</span>
                <span className="text-text">John D.</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">SLA Status</span>
                <Badge variant="success">COMPLIANT</Badge>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      {inspectorOpen && inspectorSource ? (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
          <Card className="flex h-[85vh] w-full max-w-[1200px] flex-col overflow-hidden">
            <CardHeader className="relative border-b border-border/70 pr-14">
              <div className="flex items-start gap-3">
                <div>
                  <CardTitle>Data Inspector</CardTitle>
                  <p className="mt-1 text-sm text-muted">
                    {inspectorSource.name} ({inspectorSource.kind})
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant="info">{inspectorSource.kind}</Badge>
                    <Badge variant={statusBadgeVariant(inspectorSource.status)}>{inspectorSource.status}</Badge>
                    <Badge variant={inspectorBadgeVariant(inspectorState)}>{inspectorState}</Badge>
                  </div>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="absolute right-3 top-3 px-2"
                aria-label="Close data inspector"
                onClick={() => clearInspectorEphemeralState()}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_220px_auto] lg:items-end">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Search</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                    <Input
                      className="pl-9"
                      placeholder="Search entity or payload..."
                      value={inspectorSearchInput}
                      onChange={(event) => setInspectorSearchInput(event.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Sort</label>
                  <Select
                    value={inspectorSort}
                    onChange={(event) => {
                      setInspectorSort(event.target.value)
                      setInspectorCursor('')
                      setInspectorCursorHistory([])
                      setInspectorPage(1)
                    }}
                  >
                    {INSPECTOR_SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Search Mode</label>
                  <RadixSwitch.Root
                    checked={inspectorSearchMode === 'highlight'}
                    onCheckedChange={(checked) => setInspectorSearchMode(checked ? 'highlight' : 'filter')}
                    aria-label="Toggle search mode between filter and highlight"
                    className="relative isolate inline-flex h-10 w-full items-center overflow-hidden rounded-xl border border-border/90 bg-surface-inset p-1 shadow-inset outline-none focus-visible:ring-2 focus-visible:ring-focus/25"
                  >
                    <RadixSwitch.Thumb className="pointer-events-none absolute inset-y-1 left-1 z-0 w-[calc(50%-6px)] rounded-lg bg-surface-raised shadow-card transition-transform duration-200 will-change-transform data-[state=checked]:translate-x-[calc(100%+4px)]" />
                    <span
                      className={[
                        'relative z-10 inline-flex w-1/2 items-center justify-center gap-1 text-xs font-semibold transition-colors',
                        inspectorSearchMode === 'filter' ? 'text-text' : 'text-muted',
                      ].join(' ')}
                    >
                      <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Filter</span>
                    </span>
                    <span
                      className={[
                        'relative z-10 inline-flex w-1/2 items-center justify-center gap-1 text-xs font-semibold transition-colors',
                        inspectorSearchMode === 'highlight' ? 'text-text' : 'text-muted',
                      ].join(' ')}
                    >
                      <Highlighter className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Highlight</span>
                    </span>
                  </RadixSwitch.Root>
                </div>
                <Button variant="secondary" onClick={() => clearInspectorFilters()}>
                  Clear filters
                </Button>
              </div>

              <div
                role="tablist"
                aria-label="Inspector view mode"
                className="relative isolate inline-grid h-10 w-full max-w-[340px] grid-cols-3 items-center overflow-hidden rounded-xl border border-border/90 bg-surface-inset p-1 shadow-inset"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-1 left-1 z-0 rounded-lg bg-surface-raised shadow-card transition-transform duration-200 will-change-transform"
                  style={{
                    width: 'calc((100% - 8px) / 3)',
                    transform: `translateX(${inspectorViewModeIndex * 100}%)`,
                  }}
                />
                {INSPECTOR_VIEW_MODE_OPTIONS.map((option) => {
                  const isActive = inspectorViewMode === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={[
                        'relative z-10 inline-flex h-full items-center justify-center rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/25',
                        isActive ? 'text-text' : 'text-muted hover:text-text',
                      ].join(' ')}
                      onClick={() => setInspectorViewMode(option.value)}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>

              <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/80 bg-surface-raised">
                {inspectorState === 'loading' ? (
                  <div className="flex h-full items-center justify-center px-6 py-8 text-sm text-muted">Loading entities…</div>
                ) : null}

                {inspectorState === 'error' ? (
                  <div className="p-4">
                    <Alert tone="error">{inspectorError || 'Failed to load entities for inspector.'}</Alert>
                  </div>
                ) : null}

                {inspectorState === 'empty' ? (
                  <div className="flex h-full items-center justify-center px-6 py-8 text-sm text-muted">
                    No entities found for this source.
                  </div>
                ) : null}

                {inspectorState === 'ready' && inspectorViewMode === 'table' ? (
                  <div className="h-full overflow-auto">
                    {inspectorHiddenColumns > 0 ? (
                      <p className="border-b border-border/60 bg-warning/10 px-3 py-2 text-xs text-warning-dark">
                        Showing first {inspectorColumns.length} columns. {inspectorHiddenColumns} additional columns are hidden.
                      </p>
                    ) : null}
                    <table className="w-full min-w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-border/70 bg-surface-soft text-muted">
                          <th className="px-3 py-2 font-semibold">Entity ID</th>
                          <th className="px-3 py-2 font-semibold">Updated At</th>
                          <th className="px-3 py-2 font-semibold">Status</th>
                          {inspectorColumns.map((column) => (
                            <th key={column} className="px-3 py-2 font-semibold">
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {inspectorRows.map((row) => {
                          const isCurrentRow = inspectorSelectedRow?.entityId === row.entityId
                          return (
                            <tr
                              key={row.id}
                              className={[
                                'cursor-pointer border-b border-border/40 align-top last:border-b-0',
                                isCurrentRow ? 'bg-primary/10' : 'hover:bg-surface-soft/60',
                              ].join(' ')}
                              onClick={() => setInspectorSelectedEntityId(row.entityId)}
                            >
                              <td className="px-3 py-2 font-mono text-text">
                                {renderInspectorText(row.entityId, inspectorHighlightQuery, inspectorSearchMode)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-muted">
                                {renderInspectorText(row.updatedAt, inspectorHighlightQuery, inspectorSearchMode)}
                              </td>
                              <td className="px-3 py-2">
                                <Badge variant={row.invalidJson ? 'error' : 'success'}>
                                  {renderInspectorText(
                                    row.invalidJson ? 'Invalid JSON' : 'Valid',
                                    inspectorHighlightQuery,
                                    inspectorSearchMode
                                  )}
                                </Badge>
                              </td>
                              {inspectorColumns.map((column) => (
                                <td key={`${row.id}-${column}`} className="max-w-[240px] truncate px-3 py-2 text-text">
                                  {renderInspectorText(row.values[column] ?? '', inspectorHighlightQuery, inspectorSearchMode)}
                                </td>
                              ))}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {inspectorState === 'ready' && inspectorViewMode === 'raw' ? (
                  <div className="flex h-full min-h-0 gap-3 p-3">
                    <div className="h-full min-h-0 w-[320px] min-w-[300px] max-w-[65%] shrink-0 resize-x overflow-auto rounded-lg border border-border/70 bg-surface-soft p-2">
                      <div className="space-y-1">
                        {inspectorRows.map((row) => (
                          <button
                            key={`${row.id}-raw`}
                            type="button"
                            className={[
                              'w-full rounded-md px-2 py-2 text-left text-xs transition-colors',
                              inspectorSelectedRow?.entityId === row.entityId
                                ? 'bg-primary/15 text-primary-dark'
                                : 'hover:bg-surface-raised text-text',
                            ].join(' ')}
                            onClick={() => setInspectorSelectedEntityId(row.entityId)}
                          >
                            <p className="font-mono font-semibold">
                              {renderInspectorText(row.entityId, inspectorHighlightQuery, inspectorSearchMode)}
                            </p>
                            <p className="text-[11px] text-muted">
                              {renderInspectorText(row.updatedAt, inspectorHighlightQuery, inspectorSearchMode)}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border border-border/70 bg-surface-soft p-3">
                      {inspectorSelectedRow ? (
                        <div className="space-y-3">
                          {inspectorSelectedRow.invalidJson ? (
                            <Alert tone="warning">
                              Invalid JSON payload for this entity. Showing raw fallback text.
                            </Alert>
                          ) : null}
                          <pre className="whitespace-pre-wrap break-words text-[12px] text-text">
                            {renderInspectorText(
                              formatEntityRawJson(inspectorSelectedRow),
                              inspectorHighlightQuery,
                              inspectorSearchMode
                            )}
                          </pre>
                        </div>
                      ) : (
                        <p className="text-sm text-muted">Select a row to view raw payload.</p>
                      )}
                    </div>
                  </div>
                ) : null}

                {inspectorState === 'ready' && inspectorViewMode === 'tree' ? (
                  <div className="flex h-full min-h-0 gap-3 p-3">
                    <div className="h-full min-h-0 w-[320px] min-w-[300px] max-w-[65%] shrink-0 resize-x overflow-auto rounded-lg border border-border/70 bg-surface-soft p-2">
                      <div className="space-y-1">
                        {inspectorRows.map((row) => (
                          <button
                            key={`${row.id}-tree`}
                            type="button"
                            className={[
                              'w-full rounded-md px-2 py-2 text-left text-xs transition-colors',
                              inspectorSelectedRow?.entityId === row.entityId
                                ? 'bg-primary/15 text-primary-dark'
                                : 'hover:bg-surface-raised text-text',
                            ].join(' ')}
                            onClick={() => setInspectorSelectedEntityId(row.entityId)}
                          >
                            <p className="font-mono font-semibold">
                              {renderInspectorText(row.entityId, inspectorHighlightQuery, inspectorSearchMode)}
                            </p>
                            <p className="text-[11px] text-muted">
                              {renderInspectorText(row.updatedAt, inspectorHighlightQuery, inspectorSearchMode)}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border border-border/70 bg-surface-soft p-3">
                      {!inspectorSelectedRow ? <p className="text-sm text-muted">Select a row to inspect its tree.</p> : null}
                      {inspectorSelectedRow?.invalidJson ? (
                        <Alert tone="warning">This row has invalid JSON and cannot be rendered as a tree.</Alert>
                      ) : null}
                      {inspectorTree && inspectorSelectedRow && !inspectorSelectedRow.invalidJson ? (
                        <InspectorTree node={inspectorTree} query={inspectorHighlightQuery} mode={inspectorSearchMode} />
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between border-t border-border/70 pt-3 text-xs text-muted">
                <span>
                  {inspectorRange.start === 0
                    ? `Showing 0 of ${inspectorTotal} entities`
                    : `Showing ${inspectorRange.start}-${inspectorRange.end} of ${inspectorTotal} entities`}
                  {` · Page ${inspectorPage}`}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" disabled={!inspectorPager.canPrevious} onClick={() => goInspectorPreviousPage()}>
                    Previous
                  </Button>
                  <Button variant="secondary" size="sm" disabled={!inspectorPager.canNext} onClick={() => goInspectorNextPage()}>
                    Next
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {deleteDialogOpen && selectedSource ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
          <Card className="w-full max-w-[420px]">
            <CardHeader className="flex-col items-start space-y-1">
              <CardTitle>Delete Data Source</CardTitle>
              <p className="text-sm text-muted">
                Delete <span className="font-semibold text-text">{selectedSource.name}</span>? This removes baseline snapshots,
                source history, and projected entities.
              </p>
            </CardHeader>
            <CardContent className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteDialogOpen(false)} disabled={busyAction !== ''}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void submitDeleteSource()} disabled={busyAction !== ''}>
                {busyAction === 'delete-source' ? 'Deleting...' : 'Delete'}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {uploadErrorModalOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
          <Card className="w-full max-w-[560px]">
            <CardHeader className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <CardTitle>Upload Error Details</CardTitle>
                <IconActionButton
                  label="Close upload error details"
                  icon={<X className="h-4 w-4" aria-hidden />}
                  onClick={() => setUploadErrorModalOpen(false)}
                />
              </div>
              <p className="text-sm text-muted break-words">{uploadErrorSummary || 'Upload failed.'}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {uploadErrorDetails.length > 0 ? (
                <ul className="max-h-[260px] list-disc space-y-1 overflow-auto rounded-xl border border-error/30 bg-error/10 px-6 py-3 text-sm text-error">
                  {uploadErrorDetails.map((detail, index) => (
                    <li key={`${detail}-${index}`} className="break-words">
                      {detail}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-border bg-surface-soft p-3 text-sm text-muted">
                  The server did not provide additional error details.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 w-full px-6 md:px-8">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
    </section>
  )
}
