import { describe, expect, it } from 'vitest'

import { inferRequestBodySchemaFromExample } from './request-body-schema'

describe('request body schema inference', () => {
  it('infers recursive object schemas with required keys', () => {
    const schema = inferRequestBodySchemaFromExample({
      user: {
        id: 10,
        active: true,
      },
      tags: ['vip'],
    })

    expect(schema).toEqual({
      type: 'object',
      additionalProperties: true,
      properties: {
        tags: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
        user: {
          type: 'object',
          additionalProperties: true,
          properties: {
            active: {
              type: 'boolean',
            },
            id: {
              type: 'integer',
            },
          },
          required: ['active', 'id'],
        },
      },
      required: ['tags', 'user'],
    })
  })

  it('infers empty arrays as open items', () => {
    const schema = inferRequestBodySchemaFromExample([])
    expect(schema).toEqual({
      type: 'array',
      items: {},
    })
  })

  it('infers mixed arrays as oneOf variants', () => {
    const schema = inferRequestBodySchemaFromExample([1, 'x', null, { id: 1 }, []]) as {
      type: string
      items: { oneOf: Array<Record<string, unknown>> }
    }

    expect(schema.type).toBe('array')
    expect(Array.isArray(schema.items.oneOf)).toBe(true)
    expect(schema.items.oneOf).toEqual(
      expect.arrayContaining([
        { type: 'integer' },
        { type: 'string' },
        { type: 'null' },
        {
          type: 'array',
          items: {},
        },
        {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: {
              type: 'integer',
            },
          },
          required: ['id'],
        },
      ])
    )
  })

  it('distinguishes integer and number', () => {
    expect(inferRequestBodySchemaFromExample(2)).toEqual({ type: 'integer' })
    expect(inferRequestBodySchemaFromExample(2.5)).toEqual({ type: 'number' })
  })

  it('keeps deterministic ordering for equivalent input objects', () => {
    const left = inferRequestBodySchemaFromExample({
      z: 'last',
      a: 'first',
      m: 1,
    })
    const right = inferRequestBodySchemaFromExample({
      m: 1,
      z: 'last',
      a: 'first',
    })

    expect(JSON.stringify(left)).toBe(JSON.stringify(right))
  })
})
