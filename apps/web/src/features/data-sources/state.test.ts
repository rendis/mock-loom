import { describe, expect, it } from 'vitest'

import {
  buildSchemaTypeDraft,
  buildSchemaUpdatePayload,
  canUploadBaseline,
  deriveBundleDViewState,
  deriveDataSourcesViewState,
  deriveInspectorPager,
  deriveInspectorState,
  hasSchemaWarnings,
  initialDataSourcesState,
  isSchemaDraftDirty,
} from './state'

describe('data sources state', () => {
  it('builds initial state', () => {
    const state = initialDataSourcesState()
    expect(state.view).toBe('loading')
    expect(state.upload).toBe('idle')
    expect(state.items).toHaveLength(0)
  })

  it('derives loading state', () => {
    expect(deriveDataSourcesViewState({ loading: true, items: [] })).toBe('loading')
  })

  it('derives error state', () => {
    expect(deriveDataSourcesViewState({ loading: false, items: [], error: 'boom' })).toBe('error')
  })

  it('derives empty and ready states', () => {
    expect(deriveDataSourcesViewState({ loading: false, items: [] })).toBe('empty')
    expect(
      deriveDataSourcesViewState({
        loading: false,
        items: [
          {
            id: '1',
            integrationId: 'int-1',
            name: 'Users',
            slug: 'users',
            kind: 'JSON',
            status: 'ACTIVE',
            recordCount: 1,
            createdAt: '2026-03-02T10:00:00Z',
            updatedAt: '2026-03-02T10:00:00Z',
          },
        ],
      })
    ).toBe('ready')
  })

  it('derives bundle D view from qaState override', () => {
    expect(
      deriveBundleDViewState({
        qaState: 'upload-error',
        viewState: 'ready',
        uploadState: 'idle',
        error: '',
      })
    ).toBe('upload-error')
  })

  it('derives bundle D upload-error from upload state', () => {
    expect(
      deriveBundleDViewState({
        qaState: null,
        viewState: 'ready',
        uploadState: 'error',
        error: 'schema invalid',
      })
    ).toBe('upload-error')
  })

  it('derives bundle D error from request state', () => {
    expect(
      deriveBundleDViewState({
        qaState: null,
        viewState: 'error',
        uploadState: 'idle',
        error: 'request failed',
      })
    ).toBe('error')
  })

  it('gates upload action based on preview state', () => {
    expect(
      canUploadBaseline({
        hasFile: false,
        uploadState: 'idle',
        previewState: 'idle',
      })
    ).toBe(false)

    expect(
      canUploadBaseline({
        hasFile: true,
        uploadState: 'idle',
        previewState: 'loading',
      })
    ).toBe(false)

    expect(
      canUploadBaseline({
        hasFile: true,
        uploadState: 'idle',
        previewState: 'error',
      })
    ).toBe(false)

    expect(
      canUploadBaseline({
        hasFile: true,
        uploadState: 'uploading',
        previewState: 'ready',
      })
    ).toBe(false)

    expect(
      canUploadBaseline({
        hasFile: true,
        uploadState: 'idle',
        previewState: 'ready',
      })
    ).toBe(true)

    expect(
      canUploadBaseline({
        hasFile: true,
        uploadState: 'idle',
        previewState: 'skipped-large',
      })
    ).toBe(true)
  })

  it('derives inspector state from loading, rows, and error', () => {
    expect(
      deriveInspectorState({
        loading: true,
        error: '',
        rows: [],
      })
    ).toBe('loading')

    expect(
      deriveInspectorState({
        loading: false,
        error: 'request failed',
        rows: [],
      })
    ).toBe('error')

    expect(
      deriveInspectorState({
        loading: false,
        error: '',
        rows: [],
      })
    ).toBe('empty')

    expect(
      deriveInspectorState({
        loading: false,
        error: '',
        rows: [
          {
            id: 'row-1',
            sourceId: 'source-1',
            entityId: 'ent-1',
            updatedAt: '2026-03-03T09:00:00Z',
            rawJson: '{"name":"A"}',
            parsedValue: { name: 'A' },
            values: { name: 'A' },
            invalidJson: false,
          },
        ],
      })
    ).toBe('ready')
  })

  it('derives inspector pager flags from cursor history and next cursor', () => {
    expect(
      deriveInspectorPager({
        cursorHistory: [],
        nextCursor: 'abc',
        loading: true,
      })
    ).toEqual({
      canPrevious: false,
      canNext: false,
    })

    expect(
      deriveInspectorPager({
        cursorHistory: [],
        nextCursor: 'abc',
        loading: false,
      })
    ).toEqual({
      canPrevious: false,
      canNext: true,
    })

    expect(
      deriveInspectorPager({
        cursorHistory: [''],
        nextCursor: undefined,
        loading: false,
      })
    ).toEqual({
      canPrevious: true,
      canNext: false,
    })
  })

  it('builds schema draft from effective types', () => {
    const draft = buildSchemaTypeDraft([
      {
        key: 'id',
        inferredType: 'string',
        effectiveType: 'string',
        overridden: false,
      },
      {
        key: 'age',
        inferredType: 'string',
        effectiveType: 'number',
        overridden: true,
      },
    ])
    expect(draft).toEqual({
      id: 'string',
      age: 'number',
    })
  })

  it('detects schema draft dirty state', () => {
    const fields = [
      {
        key: 'id',
        inferredType: 'string',
        effectiveType: 'string',
        overridden: false,
      },
      {
        key: 'age',
        inferredType: 'string',
        effectiveType: 'number',
        overridden: true,
      },
    ]
    expect(
      isSchemaDraftDirty({
        fields,
        draft: { id: 'string', age: 'number' },
      })
    ).toBe(false)
    expect(
      isSchemaDraftDirty({
        fields,
        draft: { id: 'string', age: 'string' },
      })
    ).toBe(true)
  })

  it('builds schema update payload in field order', () => {
    const fields = [
      {
        key: 'id',
        inferredType: 'string',
        effectiveType: 'string',
        overridden: false,
      },
      {
        key: 'age',
        inferredType: 'string',
        effectiveType: 'number',
        overridden: true,
      },
    ]
    expect(
      buildSchemaUpdatePayload({
        fields,
        draft: { id: 'string', age: 'boolean' },
      })
    ).toEqual([
      { key: 'id', type: 'string' },
      { key: 'age', type: 'boolean' },
    ])
  })

  it('detects if schema warnings contain mismatches', () => {
    expect(
      hasSchemaWarnings([
        { key: 'age', expectedType: 'number', mismatchCount: 0 },
        { key: 'active', expectedType: 'boolean', mismatchCount: 1 },
      ])
    ).toBe(true)
    expect(hasSchemaWarnings([{ key: 'id', expectedType: 'string', mismatchCount: 0 }])).toBe(false)
  })
})
