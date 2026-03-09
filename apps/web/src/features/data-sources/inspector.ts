import type { DataDebuggerEntity } from '../../types/api'

export type DataInspectorViewMode = 'table' | 'raw' | 'tree'

export type DataInspectorState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export const DATA_INSPECTOR_MAX_COLUMNS = 30

export interface ParsedEntityRow {
  id: string
  sourceId: string
  entityId: string
  updatedAt: string
  rawJson: string
  parsedValue: unknown
  values: Record<string, string>
  invalidJson: boolean
  parseError?: string
}

export type DataInspectorTreeNodeKind = 'object' | 'array' | 'primitive'

export interface DataInspectorTreeNode {
  key: string
  path: string
  kind: DataInspectorTreeNodeKind
  value?: string
  children: DataInspectorTreeNode[]
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toCellValue(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (typeof value === 'undefined') {
    return ''
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return '[unserializable]'
    }
  }
  return String(value)
}

function normalizeValues(value: unknown): Record<string, string> {
  if (isRecordValue(value)) {
    const next: Record<string, string> = {}
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = key.trim()
      if (normalizedKey === '') {
        continue
      }
      next[normalizedKey] = toCellValue(item)
    }
    return next
  }
  return {
    value: toCellValue(value),
  }
}

export function parseEntityRows(entities: DataDebuggerEntity[]): ParsedEntityRow[] {
  return entities.map((entity) => {
    try {
      const parsedValue = JSON.parse(entity.currentDataJson) as unknown
      return {
        id: entity.id,
        sourceId: entity.sourceId,
        entityId: entity.entityId,
        updatedAt: entity.updatedAt,
        rawJson: entity.currentDataJson,
        parsedValue,
        values: normalizeValues(parsedValue),
        invalidJson: false,
      }
    } catch (error) {
      const parseError = error instanceof Error ? error.message : 'Invalid JSON payload.'
      return {
        id: entity.id,
        sourceId: entity.sourceId,
        entityId: entity.entityId,
        updatedAt: entity.updatedAt,
        rawJson: entity.currentDataJson,
        parsedValue: null,
        values: {},
        invalidJson: true,
        parseError,
      }
    }
  })
}

export function collectColumns(rows: ParsedEntityRow[], maxColumns = DATA_INSPECTOR_MAX_COLUMNS): {
  columns: string[]
  hiddenColumns: number
} {
  const keys = new Set<string>()
  for (const row of rows) {
    for (const column of Object.keys(row.values)) {
      keys.add(column)
    }
  }

  const allColumns = Array.from(keys)
  if (allColumns.length <= maxColumns) {
    return {
      columns: allColumns,
      hiddenColumns: 0,
    }
  }

  return {
    columns: allColumns.slice(0, maxColumns),
    hiddenColumns: allColumns.length - maxColumns,
  }
}

export function buildTreeNodes(value: unknown, key = 'root', path = 'root'): DataInspectorTreeNode {
  if (Array.isArray(value)) {
    return {
      key,
      path,
      kind: 'array',
      children: value.map((item, index) => buildTreeNodes(item, `[${index}]`, `${path}[${index}]`)),
    }
  }

  if (isRecordValue(value)) {
    return {
      key,
      path,
      kind: 'object',
      children: Object.entries(value).map(([childKey, childValue]) =>
        buildTreeNodes(childValue, childKey, `${path}.${childKey}`)
      ),
    }
  }

  return {
    key,
    path,
    kind: 'primitive',
    value: toCellValue(value),
    children: [],
  }
}

export function formatEntityRawJson(row: ParsedEntityRow): string {
  if (row.invalidJson) {
    return row.rawJson
  }

  try {
    return JSON.stringify(row.parsedValue, null, 2)
  } catch {
    return row.rawJson
  }
}
