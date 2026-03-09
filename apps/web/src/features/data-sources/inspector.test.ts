import { describe, expect, it } from 'vitest'

import type { DataDebuggerEntity } from '../../types/api'
import {
  DATA_INSPECTOR_MAX_COLUMNS,
  buildTreeNodes,
  collectColumns,
  formatEntityRawJson,
  parseEntityRows,
} from './inspector'

function makeEntity(params: Partial<DataDebuggerEntity> & { entityId: string; currentDataJson: string }): DataDebuggerEntity {
  return {
    id: params.id ?? `row-${params.entityId}`,
    sourceId: params.sourceId ?? 'source-1',
    entityId: params.entityId,
    currentDataJson: params.currentDataJson,
    updatedAt: params.updatedAt ?? '2026-03-03T09:00:00Z',
  }
}

describe('inspector helpers', () => {
  it('parses valid object rows and keeps invalid JSON rows as fallback', () => {
    const rows = parseEntityRows([
      makeEntity({ entityId: 'ent-1', currentDataJson: '{"name":"Alice","active":true}' }),
      makeEntity({ entityId: 'ent-2', currentDataJson: '{invalid json' }),
    ])
    const firstRow = rows[0]
    const secondRow = rows[1]

    expect(rows).toHaveLength(2)
    expect(firstRow).toBeDefined()
    expect(secondRow).toBeDefined()
    expect(firstRow?.invalidJson).toBe(false)
    expect(firstRow?.values).toEqual({ name: 'Alice', active: 'true' })

    expect(secondRow?.invalidJson).toBe(true)
    expect(secondRow?.values).toEqual({})
    expect(secondRow?.parseError).toBeTypeOf('string')
  })

  it('normalizes array and primitive payloads in value column', () => {
    const rows = parseEntityRows([
      makeEntity({ entityId: 'ent-array', currentDataJson: '[1,2,3]' }),
      makeEntity({ entityId: 'ent-string', currentDataJson: '"hello"' }),
    ])
    const arrayRow = rows[0]
    const stringRow = rows[1]

    expect(arrayRow?.values).toEqual({ value: '[1,2,3]' })
    expect(stringRow?.values).toEqual({ value: 'hello' })
  })

  it('collects dynamic columns and caps them by max limit', () => {
    const keys = Array.from({ length: DATA_INSPECTOR_MAX_COLUMNS + 4 }, (_, index) => `col_${index}`)
    const values = Object.fromEntries(keys.map((key, index) => [key, String(index)])) as Record<string, string>
    const rows = [
      {
        id: 'row-1',
        sourceId: 'source-1',
        entityId: 'ent-1',
        updatedAt: '2026-03-03T09:00:00Z',
        rawJson: '{}',
        parsedValue: {},
        values,
        invalidJson: false,
      },
    ]

    const result = collectColumns(rows)
    expect(result.columns).toHaveLength(DATA_INSPECTOR_MAX_COLUMNS)
    expect(result.hiddenColumns).toBe(4)
  })

  it('builds tree nodes for nested objects and arrays', () => {
    const tree = buildTreeNodes({
      user: { id: 1, name: 'Alice' },
      tags: ['alpha', 'beta'],
    })

    expect(tree.kind).toBe('object')
    expect(tree.children.map((child) => child.key)).toEqual(['user', 'tags'])

    const tagsNode = tree.children.find((child) => child.key === 'tags')
    expect(tagsNode?.kind).toBe('array')
    expect(tagsNode?.children.map((child) => child.key)).toEqual(['[0]', '[1]'])
  })

  it('formats raw JSON for valid and invalid rows', () => {
    const [valid, invalid] = parseEntityRows([
      makeEntity({ entityId: 'ent-1', currentDataJson: '{"a":1}' }),
      makeEntity({ entityId: 'ent-2', currentDataJson: '{oops' }),
    ])

    expect(valid).toBeDefined()
    expect(invalid).toBeDefined()
    expect(formatEntityRawJson(valid!)).toContain('"a": 1')
    expect(formatEntityRawJson(invalid!)).toBe('{oops')
  })
})
