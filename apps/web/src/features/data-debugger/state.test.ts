import { describe, expect, it } from 'vitest'

import { deriveBundleEViewState } from './state'

describe('data debugger state', () => {
  it('prioritizes qa state when provided', () => {
    expect(
      deriveBundleEViewState({
        qaState: 'timeline-details',
        entitiesState: 'loading',
        timelineState: 'loading',
        hasSelectedEntity: false,
        rollbackConfirmOpen: false,
        backendBlocked: false,
        error: '',
      })
    ).toBe('timeline-details')
  })

  it('returns error when backend is blocked', () => {
    expect(
      deriveBundleEViewState({
        qaState: null,
        entitiesState: 'ready',
        timelineState: 'ready',
        hasSelectedEntity: true,
        rollbackConfirmOpen: false,
        backendBlocked: true,
        error: 'missing endpoints',
      })
    ).toBe('error')
  })

  it('returns rollback-confirmation when modal is open', () => {
    expect(
      deriveBundleEViewState({
        qaState: null,
        entitiesState: 'ready',
        timelineState: 'ready',
        hasSelectedEntity: true,
        rollbackConfirmOpen: true,
        backendBlocked: false,
        error: '',
      })
    ).toBe('rollback-confirmation')
  })

  it('returns timeline-details when entity and timeline are ready', () => {
    expect(
      deriveBundleEViewState({
        qaState: null,
        entitiesState: 'ready',
        timelineState: 'ready',
        hasSelectedEntity: true,
        rollbackConfirmOpen: false,
        backendBlocked: false,
        error: '',
      })
    ).toBe('timeline-details')
  })

  it('returns ready when entities are ready and timeline is hidden', () => {
    expect(
      deriveBundleEViewState({
        qaState: null,
        entitiesState: 'ready',
        timelineState: 'empty',
        hasSelectedEntity: false,
        rollbackConfirmOpen: false,
        backendBlocked: false,
        error: '',
      })
    ).toBe('ready')
  })
})
