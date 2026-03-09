import { describe, expect, it } from 'vitest'

import { rewriteExprChainSugar } from './rewrite'

describe('expr rewrite chain sugar', () => {
  it('rewrites supported chain methods to canonical expr', () => {
    const result = rewriteExprChainSugar({
      expression: 'request.path.startsWith("/api") && source.users.active.isTrue() && request.params.path.id.in(["1","2"])',
      knownPaths: new Set(['request.path', 'source.users.active', 'request.params.path.id']),
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.expression).toContain('startsWith(request.path, "/api")')
    expect(result.expression).toContain('source.users.active == true')
    expect(result.expression).toContain('request.params.path.id in ["1","2"]')
  })

  it('returns diagnostics for unknown method and unknown path', () => {
    const result = rewriteExprChainSugar({
      expression: 'request.params.path.tenantId.unknownMethod("x") && request.params.body.foo.contains("bar")',
      knownPaths: new Set(['request.params.path.id']),
    })

    expect(result.diagnostics.some((item) => item.code === 'script.validation.chain-unknown-method')).toBe(true)
    expect(result.diagnostics.some((item) => item.code === 'script.validation.chain-unknown-path')).toBe(true)
  })
})
