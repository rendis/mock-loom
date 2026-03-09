import { describe, expect, it } from 'vitest'

import { compileScenarioDraft } from './scenario-compile'
import { defaultScenarioDraft } from './scenario-model'

describe('scenario compile', () => {
  it('compiles one draft into endpoint scenario contract', () => {
    const draft = defaultScenarioDraft(0, false)
    draft.name = 'User active'
    draft.priority = 10
    draft.whenExpr = 'request.params.path.userId != nil'
    draft.response.statusCode = '200'
    draft.response.delayMs = '120'
    draft.response.bodyJson = '{\n  "ok": true\n}'
    draft.mutations = [
      {
        id: 'm1',
        type: 'update',
        sourceSlug: 'users',
        entityIdExpr: 'request.params.path.userId',
        payloadExpr: 'request.params.body',
      },
    ]

    const result = compileScenarioDraft(draft, {
      sourcePaths: ['source.users', 'source.users.id', 'source.users.email'],
      requestPaths: ['request.params.path.userId', 'request.params.body'],
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.scenario.conditionExpr).toBe('request.params.path.userId != nil')
    expect(result.scenario.response.statusCode).toBe(200)
    expect(result.scenario.mutations?.[0]?.type).toBe('UPSERT')
  })

  it('blocks unknown source slug in when and mutation', () => {
    const draft = defaultScenarioDraft(0, false)
    draft.whenExpr = 'source.wallets_by_id[request.params.path.id] != nil'
    draft.mutations = [
      {
        id: 'm2',
        type: 'delete',
        sourceSlug: 'wallets',
        entityIdExpr: 'request.params.path.id',
        payloadExpr: '',
      },
    ]

    const result = compileScenarioDraft(draft, {
      sourcePaths: ['source.users', 'source.users.id'],
      requestPaths: ['request.params.path.id'],
    })

    expect(result.diagnostics.some((item) => item.code === 'scenario.validation.source-unknown')).toBe(true)
  })

  it('blocks request.param alias paths before save', () => {
    const draft = defaultScenarioDraft(0, false)
    draft.whenExpr = 'request.param.id != nil'
    draft.mutations = [
      {
        id: 'm3',
        type: 'update',
        sourceSlug: 'users',
        entityIdExpr: 'request.param.id',
        payloadExpr: 'request.params.body',
      },
    ]

    const result = compileScenarioDraft(draft, {
      sourcePaths: ['source.users', 'source.users.id'],
      requestPaths: ['request.params.path.id'],
    })

    expect(result.diagnostics.some((item) => item.code === 'scenario.validation.request-param-alias')).toBe(true)
  })

  it('compiles string response body without diagnostics', () => {
    const draft = defaultScenarioDraft(0, false)
    draft.name = 'HTML response'
    draft.priority = 10
    draft.whenExpr = 'true'
    draft.fallback = true
    draft.response.statusCode = '200'
    draft.response.bodyJson = '"<html><body>hello</body></html>"'
    draft.response.headers = [{ id: 'h1', key: 'Content-Type', value: 'text/html; charset=utf-8' }]

    const result = compileScenarioDraft(draft, {
      sourcePaths: [],
      requestPaths: [],
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.scenario.response.body).toBe('<html><body>hello</body></html>')
  })

  it('preserves pure expr as authored without implicit chain rewrites', () => {
    const draft = defaultScenarioDraft(0, false)
    draft.whenExpr = 'request.params.path.userId.startsWith(\"u-\") && source.users_by_id[request.params.path.userId].active.isTrue()'
    draft.mutations = [
      {
        id: 'm4',
        type: 'update',
        sourceSlug: 'users',
        entityIdExpr: 'request.params.path.userId',
        payloadExpr: 'request.params.body',
      },
    ]

    const result = compileScenarioDraft(draft, {
      sourcePaths: ['source.users', 'source.users.id', 'source.users.active'],
      requestPaths: ['request.params.path.userId', 'request.params.body'],
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.scenario.conditionExpr).toBe(
      'request.params.path.userId.startsWith(\"u-\") && source.users_by_id[request.params.path.userId].active.isTrue()'
    )
  })
})
