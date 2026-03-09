import { describe, expect, it } from 'vitest'

import {
  createEditableContractParam,
  injectEditableParamsIntoContract,
  parseEditableParamsFromContract,
  sanitizeEditableParams,
} from './contract-params'

describe('contract params parsing', () => {
  it('parses HEADER and QUERY params from contract schema', () => {
    const contract = `{
      "type": "object",
      "properties": {
        "header": {
          "type": "object",
          "required": ["Authorization"],
          "properties": {
            "Authorization": {
              "type": "string",
              "x-mockloom-expectedValue": "Bearer token"
            },
            "Accept": {
              "type": "string",
              "example": "application/json"
            }
          }
        },
        "query": {
          "type": "object",
          "properties": {
            "limit": {
              "type": "string",
              "x-mockloom-expectedValue": "50"
            }
          }
        }
      }
    }`

    const parsed = parseEditableParamsFromContract(contract)
    expect(parsed).toHaveLength(3)
    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: 'HEADER', key: 'Authorization', required: true, expectedValue: 'Bearer token' }),
        expect.objectContaining({ scope: 'HEADER', key: 'Accept', required: false, expectedValue: 'application/json' }),
        expect.objectContaining({ scope: 'QUERY', key: 'limit', required: false, expectedValue: '50' }),
      ])
    )
  })

  it('returns empty params for invalid contract json', () => {
    expect(parseEditableParamsFromContract('{invalid')).toEqual([])
  })
})

describe('contract params injection', () => {
  it('injects editable params with table-wins behavior and keeps unrelated contract fields', () => {
    const baseContract = `{
      "type": "object",
      "properties": {
        "body": {
          "type": "object",
          "properties": {
            "id": {"type":"string"}
          }
        },
        "headers": {
          "type": "object",
          "properties": {
            "legacy": {"type":"string"}
          }
        },
        "query": {
          "type": "object",
          "properties": {
            "legacyQ": {"type":"string"}
          }
        }
      }
    }`

    const auth = createEditableContractParam('HEADER')
    auth.key = 'Authorization'
    auth.expectedValue = 'Bearer token'
    auth.required = true

    const accept = createEditableContractParam('HEADER')
    accept.key = 'Accept'
    accept.expectedValue = 'application/json'

    const query = createEditableContractParam('QUERY')
    query.key = 'limit'
    query.expectedValue = '25'

    const injected = injectEditableParamsIntoContract(baseContract, [auth, accept, query])
    const parsed = JSON.parse(injected) as {
      properties: {
        body: unknown
        header?: { properties: Record<string, { [key: string]: unknown }>; required?: string[] }
        query?: { properties: Record<string, { [key: string]: unknown }> }
        headers?: unknown
      }
    }

    expect(parsed.properties.body).toBeDefined()
    expect(parsed.properties.headers).toBeUndefined()
    expect(parsed.properties.header?.properties.Authorization?.['x-mockloom-expectedValue']).toBe('Bearer token')
    expect(parsed.properties.header?.required).toEqual(['Authorization'])
    expect(parsed.properties.query?.properties.limit?.['x-mockloom-expectedValue']).toBe('25')
  })

  it('drops empty scopes when there are no params', () => {
    const baseContract = `{"type":"object","properties":{"header":{"type":"object"},"query":{"type":"object"}}}`
    const injected = injectEditableParamsIntoContract(baseContract, [])
    const parsed = JSON.parse(injected) as { properties: Record<string, unknown> }
    expect(parsed.properties.header).toBeUndefined()
    expect(parsed.properties.query).toBeUndefined()
  })
})

describe('contract params sanitization', () => {
  it('removes empty keys and deduplicates by scope+key', () => {
    const first = createEditableContractParam('HEADER')
    first.key = '  Authorization  '
    first.expectedValue = 'Bearer one'

    const duplicate = createEditableContractParam('HEADER')
    duplicate.key = 'authorization'
    duplicate.expectedValue = 'Bearer two'

    const query = createEditableContractParam('QUERY')
    query.key = 'Authorization'
    query.expectedValue = 'ok'

    const empty = createEditableContractParam('HEADER')
    empty.key = '   '

    const sanitized = sanitizeEditableParams([first, duplicate, query, empty])

    expect(sanitized).toHaveLength(2)
    expect(sanitized).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: 'HEADER', key: 'Authorization', expectedValue: 'Bearer one' }),
        expect.objectContaining({ scope: 'QUERY', key: 'Authorization', expectedValue: 'ok' }),
      ])
    )
  })
})
