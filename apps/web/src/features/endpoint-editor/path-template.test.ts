import { describe, expect, it } from 'vitest'

import {
  extractPathParamNames,
  finalizePathParamName,
  insertEmptyPathParamAtCursor,
  normalizeAdjacentPathParamTokens,
  normalizePathParamName,
  serializePathTemplate,
  tokenizePathTemplate,
  validatePathTemplate,
} from './path-template'

describe('path template tokenization', () => {
  it('tokenizes pasted {value} into a path param chip token', () => {
    const tokens = tokenizePathTemplate('/users/{tenantId}/orders')
    const paramTokens = tokens.filter((token) => token.type === 'param')

    expect(paramTokens).toHaveLength(1)
    expect(paramTokens[0]).toMatchObject({ type: 'param', name: 'tenantid' })
  })

  it('supports mixed {id} and :orderId syntaxes', () => {
    const tokens = tokenizePathTemplate('/users/{id}/orders/:orderId')
    const params = tokens
      .filter((token): token is Extract<(typeof tokens)[number], { type: 'param' }> => token.type === 'param')
      .map((token) => token.name)
    expect(params).toEqual(['id', 'orderid'])
  })

  it('serializes tokens with deterministic braces output', () => {
    const serialized = serializePathTemplate(tokenizePathTemplate('/users/:id/orders/{orderId}'))
    expect(serialized).toBe('/users/:id/orders/:orderid')
  })

  it('inserts slash between adjacent param chips during normalization', () => {
    const normalized = normalizeAdjacentPathParamTokens(tokenizePathTemplate('/{a}{b}'))
    expect(serializePathTemplate(normalized)).toBe('/:a/:b')
  })

  it('normalizes pasted adjacent params with spaces and hyphen to underscored chips', () => {
    const normalized = normalizeAdjacentPathParamTokens(tokenizePathTemplate('/{tenant-id}{order id}'))
    expect(serializePathTemplate(normalized)).toBe('/:tenant_id/:order_id')
  })

  it('normalizes param names to lowercase underscore format', () => {
    const serialized = serializePathTemplate(tokenizePathTemplate('/Users/{Tenant ID}/orders/:Order-Ref'))
    expect(serialized).toBe('/Users/:tenant_id/orders/:order_ref')
  })
})

describe('path template extraction and validation', () => {
  it('extracts ordered and deduped path param names', () => {
    const params = extractPathParamNames('/users/{id}/orders/:orderId/{id}')
    expect(params).toEqual(['id', 'orderid'])
  })

  it('returns errors for invalid or empty param names', () => {
    const invalid = validatePathTemplate('/users/{}/orders/{')
    expect(invalid).toEqual(
      expect.arrayContaining([
        'Path parameter name cannot be empty.',
        'Path parameter braces must be balanced.',
      ])
    )
  })

  it('rejects query string in path templates', () => {
    const invalid = validatePathTemplate('/users/:id?active=true')
    expect(invalid).toContain('Query string is not allowed in path. Define query params in Contract Params.')
  })
})

describe('path template normalization helper', () => {
  it('maps spaces and hyphen to underscore while keeping lowercase', () => {
    expect(normalizePathParamName('  TENANT ID_01-Ref  ')).toBe('_tenant_id_01_ref_')
  })

  it('trims edge underscores on finalize', () => {
    expect(finalizePathParamName('__tenant_id__')).toBe('tenant_id')
    expect(finalizePathParamName('___')).toBe('')
  })
})

describe('path template cursor insertion', () => {
  it('inserts an empty auto-closed path param when user types "{"', () => {
    const next = insertEmptyPathParamAtCursor('/users/', '/users/'.length)
    expect(next).toBe('/users/{}')
    const params = tokenizePathTemplate(next).filter((token) => token.type === 'param')
    expect(params).toHaveLength(1)
    expect(params[0]).toMatchObject({ name: '' })
  })
})
