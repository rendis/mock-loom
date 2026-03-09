import type { DataSource, DataSourceUploadState, DataSourcesViewState } from '../../types/api'
import type { BundleDQAState } from '../../shared/lib/qa-state'
import type { BaselinePreviewState } from './preview'
import type { DataInspectorState, ParsedEntityRow } from './inspector'
import type { DataSourceSchemaField, DataSourceSchemaWarning } from '../../types/api'

export interface DataSourcesState {
  view: DataSourcesViewState
  upload: DataSourceUploadState
  items: DataSource[]
  error?: string
}

export type BundleDViewState = 'loading' | 'ready' | 'empty' | 'upload-error' | 'error'

export interface DeriveBundleDViewStateInput {
  qaState: BundleDQAState | null
  viewState: DataSourcesViewState
  uploadState: DataSourceUploadState
  error: string
}

export function deriveDataSourcesViewState(params: {
  loading: boolean
  items: DataSource[]
  error?: string
}): DataSourcesViewState {
  if (params.loading) {
    return 'loading'
  }
  if (params.error && params.error.trim() !== '') {
    return 'error'
  }
  if (params.items.length === 0) {
    return 'empty'
  }
  return 'ready'
}

export function initialDataSourcesState(): DataSourcesState {
  return {
    view: 'loading',
    upload: 'idle',
    items: [],
  }
}

export function deriveBundleDViewState({
  qaState,
  viewState,
  uploadState,
  error,
}: DeriveBundleDViewStateInput): BundleDViewState {
  if (qaState) {
    return qaState
  }

  if (uploadState === 'error') {
    return 'upload-error'
  }

  if (error.trim() !== '' && viewState !== 'ready') {
    return 'error'
  }

  return viewState
}

export function canUploadBaseline(params: {
  hasFile: boolean
  uploadState: DataSourceUploadState
  previewState: BaselinePreviewState
}): boolean {
  if (!params.hasFile) {
    return false
  }
  if (params.uploadState === 'uploading') {
    return false
  }
  if (params.previewState === 'ready' || params.previewState === 'skipped-large') {
    return true
  }
  return false
}

export function deriveInspectorState(params: {
  loading: boolean
  error: string
  rows: ParsedEntityRow[]
}): DataInspectorState {
  if (params.loading) {
    return 'loading'
  }
  if (params.error.trim() !== '') {
    return 'error'
  }
  if (params.rows.length === 0) {
    return 'empty'
  }
  return 'ready'
}

export function deriveInspectorPager(params: {
  cursorHistory: string[]
  nextCursor?: string
  loading: boolean
}): { canPrevious: boolean; canNext: boolean } {
  if (params.loading) {
    return {
      canPrevious: false,
      canNext: false,
    }
  }
  return {
    canPrevious: params.cursorHistory.length > 0,
    canNext: Boolean(params.nextCursor),
  }
}

export function buildSchemaTypeDraft(fields: DataSourceSchemaField[]): Record<string, string> {
  const draft: Record<string, string> = {}
  for (const field of fields) {
    const key = field.key.trim()
    if (key === '') {
      continue
    }
    draft[key] = field.effectiveType
  }
  return draft
}

export function isSchemaDraftDirty(params: {
  fields: DataSourceSchemaField[]
  draft: Record<string, string>
}): boolean {
  for (const field of params.fields) {
    const key = field.key.trim()
    if (key === '') {
      continue
    }
    if ((params.draft[key] ?? '').trim() !== field.effectiveType) {
      return true
    }
  }
  return false
}

export function buildSchemaUpdatePayload(params: {
  fields: DataSourceSchemaField[]
  draft: Record<string, string>
}): Array<{ key: string; type: string }> {
  return params.fields
    .map((field) => ({
      key: field.key.trim(),
      type: (params.draft[field.key] ?? field.effectiveType).trim(),
    }))
    .filter((field) => field.key !== '' && field.type !== '')
}

export function hasSchemaWarnings(warnings: DataSourceSchemaWarning[]): boolean {
  return warnings.some((warning) => warning.mismatchCount > 0)
}
