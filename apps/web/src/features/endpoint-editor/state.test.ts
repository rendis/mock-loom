import { describe, expect, it } from 'vitest'

import { deriveBundleCViewState } from './state'

describe('deriveBundleCViewState', () => {
  it('prioritizes qaState override', () => {
    const state = deriveBundleCViewState({
      qaState: 'traffic-error',
      endpointId: 'ep-1',
      endpointTab: 'traffic',
      contractState: 'valid',
      scenarioState: 'ready',
      trafficState: 'streaming',
      error: '',
    })

    expect(state).toBe('traffic-error')
  })

  it('returns loading when endpoint is not selected', () => {
    const state = deriveBundleCViewState({
      qaState: null,
      endpointId: '',
      endpointTab: 'contract',
      contractState: 'editing',
      scenarioState: 'empty',
      trafficState: 'idle',
      error: '',
    })

    expect(state).toBe('loading')
  })

  it('maps contract and scenarios tabs to ready states', () => {
    expect(
      deriveBundleCViewState({
        qaState: null,
        endpointId: 'ep-1',
        endpointTab: 'contract',
        contractState: 'valid',
        scenarioState: 'ready',
        trafficState: 'idle',
        error: '',
      })
    ).toBe('contract-ready')

    expect(
      deriveBundleCViewState({
        qaState: null,
        endpointId: 'ep-1',
        endpointTab: 'scenarios',
        contractState: 'valid',
        scenarioState: 'ready',
        trafficState: 'paused',
        error: '',
      })
    ).toBe('scenarios-editing')
  })

  it('maps traffic states to streaming/error variants', () => {
    expect(
      deriveBundleCViewState({
        qaState: null,
        endpointId: 'ep-1',
        endpointTab: 'traffic',
        contractState: 'valid',
        scenarioState: 'ready',
        trafficState: 'streaming',
        error: '',
      })
    ).toBe('traffic-streaming')

    expect(
      deriveBundleCViewState({
        qaState: null,
        endpointId: 'ep-1',
        endpointTab: 'traffic',
        contractState: 'valid',
        scenarioState: 'ready',
        trafficState: 'error',
        error: '',
      })
    ).toBe('traffic-error')
  })

  it('returns error when request fails outside qa mode', () => {
    const state = deriveBundleCViewState({
      qaState: null,
      endpointId: 'ep-1',
      endpointTab: 'contract',
      contractState: 'invalid',
      scenarioState: 'error',
      trafficState: 'error',
      error: 'request failed',
    })

    expect(state).toBe('error')
  })
})
