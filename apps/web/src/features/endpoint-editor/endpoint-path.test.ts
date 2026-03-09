import { describe, expect, it } from 'vitest'

import {
  composeEndpointPath,
  includesPackBasePath,
  isValidRelativeEndpointPath,
  normalizeEndpointPathInput,
  normalizePackBasePath,
  toRelativeEndpointPath,
} from './endpoint-path'

describe('endpoint path helpers', () => {
  it('normalizes endpoint input with leading slash', () => {
    expect(normalizeEndpointPathInput('users')).toBe('/users')
    expect(normalizeEndpointPathInput('/users')).toBe('/users')
    expect(normalizeEndpointPathInput('')).toBe('/')
  })

  it('normalizes pack base path', () => {
    expect(normalizePackBasePath('orders')).toBe('/orders')
    expect(normalizePackBasePath('/orders/')).toBe('/orders')
    expect(normalizePackBasePath('/')).toBe('/')
  })

  it('composes endpoint path under pack base path', () => {
    expect(composeEndpointPath('/orders', '/items')).toBe('/orders/items')
    expect(composeEndpointPath('/orders', 'items')).toBe('/orders/items')
    expect(composeEndpointPath('/', '/items')).toBe('/items')
  })

  it('keeps full path when it already includes base path', () => {
    expect(composeEndpointPath('/orders', '/orders/items')).toBe('/orders/items')
    expect(composeEndpointPath('/orders', '/orders')).toBe('/orders')
  })

  it('converts full path to relative path', () => {
    expect(toRelativeEndpointPath('/orders/items', '/orders')).toBe('/items')
    expect(toRelativeEndpointPath('/orders', '/orders')).toBe('/')
    expect(toRelativeEndpointPath('/users', '/orders')).toBe('/users')
  })

  it('validates relative endpoint path', () => {
    expect(isValidRelativeEndpointPath('/users')).toBe(true)
    expect(isValidRelativeEndpointPath('users')).toBe(true)
    expect(isValidRelativeEndpointPath('/')).toBe(false)
    expect(isValidRelativeEndpointPath('')).toBe(false)
  })

  it('detects when relative path incorrectly includes pack base path', () => {
    expect(includesPackBasePath('/orders/users', '/orders')).toBe(true)
    expect(includesPackBasePath('/orders', '/orders')).toBe(true)
    expect(includesPackBasePath('/users', '/orders')).toBe(false)
    expect(includesPackBasePath('/users', '/')).toBe(false)
  })
})
