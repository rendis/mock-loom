import { describe, expect, it } from 'vitest'

import { parseScenarioDraftsFromJSON } from './scenario-parse'

describe('scenario parse', () => {
  it('parses legacy scenarios json into drafts', () => {
    const load = parseScenarioDraftsFromJSON(
      JSON.stringify([
        {
          name: 'Admin',
          priority: 10,
          conditionExpr: 'request.params.path.userId != nil',
          response: {
            statusCode: 200,
            delayMs: 100,
            headers: {
              'Content-Type': 'application/json',
            },
            body: {
              ok: true,
            },
          },
          mutations: [
            {
              type: 'UPSERT',
              sourceSlug: 'users',
              entityIdExpr: 'request.params.path.userId',
              payloadExpr: 'request.params.body',
            },
          ],
        },
      ])
    )

    expect(load.drafts).toHaveLength(1)
    expect(load.diagnostics).toHaveLength(0)
    expect(load.drafts[0]?.name).toBe('Admin')
    expect(load.drafts[0]?.response.statusCode).toBe('200')
    expect(load.drafts[0]?.mutations[0]?.type).toBe('update')
  })

  it('reports unknown legacy fields as blocking diagnostics', () => {
    const load = parseScenarioDraftsFromJSON(
      JSON.stringify([
        {
          name: 'A',
          priority: 10,
          conditionExpr: 'true',
          response: {
            statusCode: 200,
            body: {
              ok: true,
            },
            extra: true,
          },
          unknownField: true,
        },
      ])
    )

    expect(load.diagnostics.some((item) => item.code === 'scenario.parse.unknown-field')).toBe(true)
    expect(load.diagnostics.some((item) => item.code === 'scenario.parse.unknown-response-field')).toBe(true)
  })

  it('preserves empty scenario arrays', () => {
    const load = parseScenarioDraftsFromJSON('[]')

    expect(load.diagnostics).toHaveLength(0)
    expect(load.drafts).toEqual([])
  })
})
