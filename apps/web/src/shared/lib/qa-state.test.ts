import { describe, expect, it } from 'vitest'

import {
  parseBundleAQAState,
  parseBundleBQAState,
  parseBundleCQAState,
  parseBundleDQAState,
  parseBundleEQAState,
} from './qa-state'

describe('qa-state parser', () => {
  it('parses bundle A states from search strings', () => {
    expect(parseBundleAQAState('?qaState=ready')).toBe('ready')
    expect(parseBundleAQAState('?qaState=empty')).toBe('empty')
    expect(parseBundleAQAState('?qaState=access-error')).toBe('access-error')
    expect(parseBundleAQAState('?qaState=no-workspace')).toBe('no-workspace')
  })

  it('parses bundle B states from search strings', () => {
    expect(parseBundleBQAState('?qaState=ready')).toBe('ready')
    expect(parseBundleBQAState('?qaState=empty')).toBe('empty')
    expect(parseBundleBQAState('?qaState=import-error')).toBe('import-error')
  })

  it('returns null for unsupported values', () => {
    expect(parseBundleAQAState('?qaState=import-error')).toBeNull()
    expect(parseBundleBQAState('?qaState=access-error')).toBeNull()
    expect(parseBundleCQAState('?qaState=empty')).toBeNull()
    expect(parseBundleDQAState('?qaState=timeline-details')).toBeNull()
    expect(parseBundleEQAState('?qaState=upload-error')).toBeNull()
    expect(parseBundleBQAState('?qaState=unknown')).toBeNull()
    expect(parseBundleAQAState('')).toBeNull()
  })

  it('accepts URLSearchParams input', () => {
    const params = new URLSearchParams()
    params.set('qaState', 'import-error')
    expect(parseBundleBQAState(params)).toBe('import-error')
  })

  it('parses bundle C states from search strings', () => {
    expect(parseBundleCQAState('?qaState=contract-ready')).toBe('contract-ready')
    expect(parseBundleCQAState('?qaState=scenarios-editing')).toBe('scenarios-editing')
    expect(parseBundleCQAState('?qaState=traffic-streaming')).toBe('traffic-streaming')
    expect(parseBundleCQAState('?qaState=traffic-error')).toBe('traffic-error')
  })

  it('parses bundle D states from search strings', () => {
    expect(parseBundleDQAState('?qaState=ready')).toBe('ready')
    expect(parseBundleDQAState('?qaState=empty')).toBe('empty')
    expect(parseBundleDQAState('?qaState=upload-error')).toBe('upload-error')
  })

  it('parses bundle E states from search strings', () => {
    expect(parseBundleEQAState('?qaState=ready')).toBe('ready')
    expect(parseBundleEQAState('?qaState=timeline-details')).toBe('timeline-details')
    expect(parseBundleEQAState('?qaState=rollback-confirmation')).toBe('rollback-confirmation')
  })
})
