import { describe, expect, it } from 'vitest'

import { buildManualImportPayload, supportsRequestBody } from './endpoint-openapi-import'

describe('endpoint openapi import payload', () => {
  it('builds payload without requestBody when body example is absent', () => {
    const payload = JSON.parse(buildManualImportPayload('GET', '/users/{id}')) as {
      paths: Record<string, Record<string, Record<string, unknown>>>
    }

    const operation = payload.paths['/users/{id}']?.get ?? {}
    expect(operation.requestBody).toBeUndefined()
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ])
    )
  })

  it('includes requestBody schema/example for POST', () => {
    const payload = JSON.parse(
      buildManualImportPayload('POST', '/orders', {
        example: { id: 'ord-1', amount: 10 },
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            amount: { type: 'integer' },
          },
          required: ['amount', 'id'],
          additionalProperties: true,
        },
      })
    ) as {
      paths: Record<string, Record<string, { requestBody?: unknown }>>
    }

    const operation = payload.paths['/orders']?.post ?? {}
    expect(operation.requestBody).toEqual({
      required: false,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              amount: { type: 'integer' },
            },
            required: ['amount', 'id'],
            additionalProperties: true,
          },
          example: { id: 'ord-1', amount: 10 },
        },
      },
    })
  })

  it('ignores body payload for methods that do not support request body', () => {
    const payload = JSON.parse(
      buildManualImportPayload('GET', '/users', {
        example: { id: 'u-1' },
        schema: { type: 'object' },
      })
    ) as {
      paths: Record<string, Record<string, Record<string, unknown>>>
    }
    expect(payload.paths['/users']?.get?.requestBody).toBeUndefined()
  })

  it('supports request body only for POST/PUT/PATCH', () => {
    expect(supportsRequestBody('POST')).toBe(true)
    expect(supportsRequestBody('PUT')).toBe(true)
    expect(supportsRequestBody('PATCH')).toBe(true)
    expect(supportsRequestBody('GET')).toBe(false)
    expect(supportsRequestBody('DELETE')).toBe(false)
  })
})
