import { describe, expect, it } from 'vitest'

import {
  PREVIEW_MAX_FILE_BYTES,
  PREVIEW_MAX_RAW_CHARS,
  buildBaselinePreview,
  parseCSVPreview,
  parseJSONPreview,
} from './preview'

describe('csv preview parser', () => {
  it('parses supported delimiters', () => {
    const comma = parseCSVPreview('id,name\n1,alice\n', 'comma')
    const semicolon = parseCSVPreview('id;name\n1;alice\n', 'semicolon')
    const tab = parseCSVPreview('id\tname\n1\talice\n', 'tab')
    const pipe = parseCSVPreview('id|name\n1|alice\n', 'pipe')

    expect(comma.state).toBe('ready')
    expect(semicolon.state).toBe('ready')
    expect(tab.state).toBe('ready')
    expect(pipe.state).toBe('ready')
  })

  it('parses quoted fields and escaped quotes', () => {
    const result = parseCSVPreview('id,name,note\n1,"Alice, A.","He said ""hello"""\n', 'comma')
    expect(result.state).toBe('ready')
    if (result.state !== 'ready') {
      return
    }
    expect(result.data.rows[0]?.name).toBe('Alice, A.')
    expect(result.data.rows[0]?.note).toBe('He said "hello"')
  })

  it('fails when header is empty', () => {
    const result = parseCSVPreview('\n1,alice\n', 'comma')
    expect(result.state).toBe('error')
  })

  it('fails on duplicated columns', () => {
    const result = parseCSVPreview('id,id\n1,2\n', 'comma')
    expect(result.state).toBe('error')
    if (result.state !== 'error') {
      return
    }
    expect(result.errors[0]).toContain('duplicated column')
  })

  it('fails when row field count mismatches header', () => {
    const result = parseCSVPreview('id,name\n1\n', 'comma')
    expect(result.state).toBe('error')
    if (result.state !== 'error') {
      return
    }
    expect(result.errors[0]).toContain('has 1 fields but header has 2')
  })

  it('fails when payload has no data rows', () => {
    const result = parseCSVPreview('id,name\n', 'comma')
    expect(result.state).toBe('error')
    if (result.state !== 'error') {
      return
    }
    expect(result.errors[0]).toContain('does not include data rows')
  })
})

describe('json preview parser', () => {
  it('parses valid array of objects and returns table + raw snippet', () => {
    const result = parseJSONPreview('[{"id":"1","name":"alice","meta":{"tier":"gold"}}]')
    expect(result.state).toBe('ready')
    if (result.state !== 'ready') {
      return
    }
    expect(result.data.columns).toEqual(['id', 'meta', 'name'])
    expect(result.data.rows[0]?.id).toBe('1')
    expect(result.data.rawJsonSnippet).toContain('"tier": "gold"')
  })

  it('fails when rows have different schema/types', () => {
    const result = parseJSONPreview('[{"id":"1","name":"alice"},{"id":"2","name":22}]')
    expect(result.state).toBe('error')
    if (result.state !== 'error') {
      return
    }
    expect(result.errors[0]).toContain('share the same shape')
  })

  it('fails when key is empty after trim', () => {
    const result = parseJSONPreview('[{"   ":"alice"}]')
    expect(result.state).toBe('error')
    if (result.state !== 'error') {
      return
    }
    expect(result.errors[0]).toContain('contains empty key')
  })

  it('fails when payload is not an array', () => {
    const result = parseJSONPreview('{"id":"1"}')
    expect(result.state).toBe('error')
    if (result.state !== 'error') {
      return
    }
    expect(result.errors[0]).toContain('must be an array')
  })

  it('fails when payload array is empty', () => {
    const result = parseJSONPreview('[]')
    expect(result.state).toBe('error')
    if (result.state !== 'error') {
      return
    }
    expect(result.errors[0]).toContain('at least one row')
  })

  it('truncates raw json snippet when it exceeds limit', () => {
    const longValue = 'x'.repeat(PREVIEW_MAX_RAW_CHARS + 200)
    const result = parseJSONPreview(`[{"id":"1","value":"${longValue}"}]`)
    expect(result.state).toBe('ready')
    if (result.state !== 'ready') {
      return
    }
    expect(result.data.truncated).toBe(true)
    expect(result.data.rawJsonSnippet?.endsWith('\n...')).toBe(true)
  })
})

describe('buildBaselinePreview', () => {
  it('skips preview for files larger than threshold', async () => {
    const file = new File([new Uint8Array(PREVIEW_MAX_FILE_BYTES + 1)], 'baseline.csv', { type: 'text/csv' })
    const result = await buildBaselinePreview({
      file,
      sourceKind: 'CSV',
      csvDelimiter: 'comma',
    })
    expect(result.state).toBe('skipped-large')
  })
})
