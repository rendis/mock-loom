import { describe, expect, it } from 'vitest'

import { defaultScenarioDraft } from './scenario-model'
import { validateScenarioDraftsStrict } from './scenario-validation'

describe('scenario validation', () => {
  it('allows zero fallback scenarios', () => {
    const first = defaultScenarioDraft(0, false)
    first.id = 'a'
    first.fallback = false
    first.whenExpr = 'request.method == "GET"'

    const second = defaultScenarioDraft(1, false)
    second.id = 'b'
    second.fallback = false
    second.whenExpr = 'request.method == "POST"'

    const result = validateScenarioDraftsStrict([first, second], {
      sourcePaths: ['source.users', 'source.users.id'],
    })

    expect(result.diagnostics.some((item) => item.code === 'scenario.validation.fallback-count')).toBe(false)
  })

  it('rejects more than one fallback scenario', () => {
    const first = defaultScenarioDraft(0, true)
    first.id = 'a'
    first.whenExpr = 'true'

    const second = defaultScenarioDraft(1, true)
    second.id = 'b'
    second.whenExpr = 'true'

    const result = validateScenarioDraftsStrict([first, second], {
      sourcePaths: ['source.users', 'source.users.id'],
    })

    expect(result.diagnostics.some((item) => item.code === 'scenario.validation.fallback-count')).toBe(true)
  })

  it('blocks duplicate priorities', () => {
    const first = defaultScenarioDraft(0, true)
    first.id = 'a'
    first.priority = 10

    const second = defaultScenarioDraft(1, false)
    second.id = 'b'
    second.priority = 10
    second.whenExpr = 'request.method == "POST"'

    const result = validateScenarioDraftsStrict([first, second], {
      sourcePaths: ['source.users', 'source.users.id'],
    })

    expect(result.diagnostics.some((item) => item.code === 'scenario.validation.priority-duplicate')).toBe(true)
  })
})
