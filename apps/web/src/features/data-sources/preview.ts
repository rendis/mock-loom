import type { CSVDelimiter, DataSourceKind } from '../../types/api'

export const PREVIEW_MAX_FILE_BYTES = 2 * 1024 * 1024
export const PREVIEW_MAX_ROWS = 20
export const PREVIEW_MAX_COLUMNS = 20
export const PREVIEW_MAX_RAW_CHARS = 12000

export type BaselinePreviewState = 'idle' | 'loading' | 'ready' | 'error' | 'skipped-large'
export type BaselinePreviewFormat = 'CSV' | 'JSON'

export interface BaselinePreviewData {
  format: BaselinePreviewFormat
  columns: string[]
  rows: Array<Record<string, string>>
  rawJsonSnippet?: string
  truncated: boolean
  messages: string[]
}

export type BaselinePreviewResult =
  | { state: 'ready'; data: BaselinePreviewData }
  | { state: 'error'; errors: string[] }
  | { state: 'skipped-large'; messages: string[] }

export interface BuildBaselinePreviewInput {
  file: File
  sourceKind: DataSourceKind
  csvDelimiter: CSVDelimiter
}

function csvDelimiterToChar(delimiter: CSVDelimiter): string {
  switch (delimiter) {
    case 'semicolon':
      return ';'
    case 'tab':
      return '\t'
    case 'pipe':
      return '|'
    case 'comma':
    default:
      return ','
  }
}

function trimBOM(payload: string): string {
  if (payload.charCodeAt(0) === 0xfeff) {
    return payload.slice(1)
  }
  return payload
}

function parseCSVRecords(payload: string, delimiter: string): { records: string[][]; parseError?: string } {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false
  let quoteClosed = false

  const pushField = (): void => {
    currentRow.push(currentField)
    currentField = ''
    quoteClosed = false
  }

  const pushRow = (): void => {
    rows.push(currentRow)
    currentRow = []
  }

  for (let index = 0; index < payload.length; index += 1) {
    const char = payload[index]
    const next = payload[index + 1]

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          currentField += '"'
          index += 1
        } else {
          inQuotes = false
          quoteClosed = true
        }
      } else {
        currentField += char
      }
      continue
    }

    if (quoteClosed) {
      if (char === delimiter) {
        pushField()
        continue
      }
      if (char === '\n') {
        pushField()
        pushRow()
        continue
      }
      if (char === '\r') {
        pushField()
        pushRow()
        if (next === '\n') {
          index += 1
        }
        continue
      }
      return { records: [], parseError: `unexpected character "${char}" after closing quote` }
    }

    if (char === '"') {
      if (currentField !== '') {
        return { records: [], parseError: 'unexpected quote in non-quoted field' }
      }
      inQuotes = true
      continue
    }

    if (char === delimiter) {
      pushField()
      continue
    }

    if (char === '\n') {
      pushField()
      pushRow()
      continue
    }

    if (char === '\r') {
      pushField()
      pushRow()
      if (next === '\n') {
        index += 1
      }
      continue
    }

    currentField += char
  }

  if (inQuotes) {
    return { records: [], parseError: 'unterminated quoted field' }
  }

  if (quoteClosed || currentField !== '' || currentRow.length > 0) {
    pushField()
    pushRow()
  }

  return { records: rows }
}

export function parseCSVPreview(payloadRaw: string, delimiter: CSVDelimiter): BaselinePreviewResult {
  const payload = trimBOM(payloadRaw)
  const parsed = parseCSVRecords(payload, csvDelimiterToChar(delimiter))
  if (parsed.parseError) {
    return {
      state: 'error',
      errors: ['failed to parse csv row', parsed.parseError],
    }
  }

  if (parsed.records.length === 0) {
    return { state: 'error', errors: ['csv payload is empty'] }
  }

  const headers = parsed.records[0] ?? []
  if (headers.length === 0) {
    return { state: 'error', errors: ['csv payload must include header row'] }
  }

  const normalizedHeaders: string[] = []
  const seenHeaders = new Set<string>()
  for (const header of headers) {
    const value = header.trim()
    if (value === '') {
      return { state: 'error', errors: ['csv header contains empty column name'] }
    }
    if (seenHeaders.has(value)) {
      return { state: 'error', errors: [`csv header contains duplicated column: ${value}`] }
    }
    seenHeaders.add(value)
    normalizedHeaders.push(value)
  }

  const dataRows = parsed.records.slice(1)
  if (dataRows.length === 0) {
    return { state: 'error', errors: ['csv payload does not include data rows'] }
  }

  const rows: Array<Record<string, string>> = []
  const rowLimit = Math.min(dataRows.length, PREVIEW_MAX_ROWS)
  const visibleHeaders = normalizedHeaders.slice(0, PREVIEW_MAX_COLUMNS)

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index] ?? []
    const rowNumber = index + 1
    if (row.length !== normalizedHeaders.length) {
      return {
        state: 'error',
        errors: [`csv row ${rowNumber} has ${row.length} fields but header has ${normalizedHeaders.length}`],
      }
    }

    if (index < rowLimit) {
      const previewRow: Record<string, string> = {}
      for (let columnIndex = 0; columnIndex < visibleHeaders.length; columnIndex += 1) {
        const header = visibleHeaders[columnIndex]
        if (!header) {
          continue
        }
        previewRow[header] = (row[columnIndex] ?? '').trim()
      }
      rows.push(previewRow)
    }
  }

  const messages: string[] = []
  let truncated = false
  if (normalizedHeaders.length > PREVIEW_MAX_COLUMNS) {
    truncated = true
    messages.push(`Showing first ${PREVIEW_MAX_COLUMNS} columns of ${normalizedHeaders.length}.`)
  }
  if (dataRows.length > PREVIEW_MAX_ROWS) {
    truncated = true
    messages.push(`Showing first ${PREVIEW_MAX_ROWS} rows of ${dataRows.length}.`)
  }

  return {
    state: 'ready',
    data: {
      format: 'CSV',
      columns: visibleHeaders,
      rows,
      truncated,
      messages,
    },
  }
}

function resolveJSONType(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return 'string'
  }
  if (typeof value === 'boolean') {
    return 'boolean'
  }
  if (typeof value === 'number') {
    return 'number'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  if (typeof value === 'object') {
    return 'object'
  }
  return 'string'
}

function sameSchema(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) {
    return false
  }
  for (const [key, leftType] of leftEntries) {
    if (right[key] !== leftType) {
      return false
    }
  }
  return true
}

function stringifyCell(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function parseJSONPreview(payloadRaw: string): BaselinePreviewResult {
  const payload = trimBOM(payloadRaw)
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return { state: 'error', errors: ['baseline json payload is invalid'] }
  }

  if (!Array.isArray(parsed)) {
    return { state: 'error', errors: ['baseline json payload must be an array of objects'] }
  }
  if (parsed.length === 0) {
    return { state: 'error', errors: ['baseline json payload must include at least one row'] }
  }

  const normalizedRows: Array<Record<string, unknown>> = []
  let firstSchema: Record<string, string> | null = null

  for (let rowIndex = 0; rowIndex < parsed.length; rowIndex += 1) {
    const item = parsed[rowIndex]
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { state: 'error', errors: [`row ${rowIndex} is not a json object`] }
    }
    const entries = Object.entries(item)
    if (entries.length === 0) {
      return { state: 'error', errors: [`row ${rowIndex} is an empty object`] }
    }

    const normalized: Record<string, unknown> = {}
    const schemaRow: Record<string, string> = {}
    for (const [rawKey, value] of entries) {
      const key = rawKey.trim()
      if (key === '') {
        return { state: 'error', errors: [`row ${rowIndex} contains empty key`] }
      }
      normalized[key] = value
      schemaRow[key] = resolveJSONType(value)
    }

    if (firstSchema === null) {
      firstSchema = schemaRow
    } else if (!sameSchema(firstSchema, schemaRow)) {
      return { state: 'error', errors: ['json payload rows must share the same shape and primitive types'] }
    }

    normalizedRows.push(normalized)
  }

  const firstRowSchema = firstSchema ?? {}
  const columns = Object.keys(firstRowSchema).sort()
  const visibleColumns = columns.slice(0, PREVIEW_MAX_COLUMNS)
  const visibleRows = normalizedRows.slice(0, PREVIEW_MAX_ROWS)

  const rows: Array<Record<string, string>> = visibleRows.map((row) => {
    const previewRow: Record<string, string> = {}
    for (const column of visibleColumns) {
      previewRow[column] = stringifyCell(row[column])
    }
    return previewRow
  })

  let rawJsonSnippet = JSON.stringify(normalizedRows, null, 2) ?? '[]'
  const messages: string[] = []
  let truncated = false
  if (columns.length > PREVIEW_MAX_COLUMNS) {
    truncated = true
    messages.push(`Showing first ${PREVIEW_MAX_COLUMNS} columns of ${columns.length}.`)
  }
  if (normalizedRows.length > PREVIEW_MAX_ROWS) {
    truncated = true
    messages.push(`Showing first ${PREVIEW_MAX_ROWS} rows of ${normalizedRows.length}.`)
  }
  if (rawJsonSnippet.length > PREVIEW_MAX_RAW_CHARS) {
    truncated = true
    rawJsonSnippet = `${rawJsonSnippet.slice(0, PREVIEW_MAX_RAW_CHARS)}\n...`
    messages.push('Raw JSON preview was truncated.')
  }

  return {
    state: 'ready',
    data: {
      format: 'JSON',
      columns: visibleColumns,
      rows,
      rawJsonSnippet,
      truncated,
      messages,
    },
  }
}

export async function buildBaselinePreview(input: BuildBaselinePreviewInput): Promise<BaselinePreviewResult> {
  if (input.file.size > PREVIEW_MAX_FILE_BYTES) {
    return {
      state: 'skipped-large',
      messages: ['Preview skipped due file size; upload is still allowed.'],
    }
  }

  const payload = await input.file.text()
  if (input.sourceKind === 'CSV') {
    return parseCSVPreview(payload, input.csvDelimiter)
  }
  if (input.sourceKind === 'JSON') {
    return parseJSONPreview(payload)
  }

  return {
    state: 'error',
    errors: ['unsupported source kind for baseline preview'],
  }
}
