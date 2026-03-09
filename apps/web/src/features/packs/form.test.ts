import { describe, expect, it } from 'vitest'

import type { PackFormValues } from './pack-modal'
import { applyPackFormPatch, normalizePackSlug } from './form'

function baseValues(): PackFormValues {
  return {
    name: '',
    slug: '',
    basePath: '/',
    status: 'ACTIVE',
    authEnabled: false,
    authMode: 'PREBUILT',
    customExpr: '',
  }
}

describe('normalizePackSlug', () => {
  it('normalizes user text into slug format', () => {
    expect(normalizePackSlug(' Core API Pack ')).toBe('core-api-pack')
    expect(normalizePackSlug('A___B')).toBe('a___b')
    expect(normalizePackSlug('hello@@world')).toBe('hello-world')
  })
})

describe('applyPackFormPatch', () => {
  it('derives slug from name while creating pack', () => {
    const updated = applyPackFormPatch(baseValues(), { name: 'Payments Core' }, 'create')
    expect(updated.name).toBe('Payments Core')
    expect(updated.slug).toBe('payments-core')
  })

  it('allows manual slug edits while creating pack', () => {
    const updated = applyPackFormPatch(baseValues(), { slug: 'manual-slug' }, 'create')
    expect(updated.slug).toBe('manual-slug')
  })

  it('re-syncs slug when user edits name after manual slug', () => {
    const manual = applyPackFormPatch(baseValues(), { slug: 'manual-slug' }, 'create')
    const renamed = applyPackFormPatch(manual, { name: 'Recalculated Name' }, 'create')
    expect(renamed.slug).toBe('recalculated-name')
  })

  it('does not auto-sync slug in edit mode', () => {
    const current = { ...baseValues(), name: 'Old', slug: 'old' }
    const updated = applyPackFormPatch(current, { name: 'New Name' }, 'edit')
    expect(updated.name).toBe('New Name')
    expect(updated.slug).toBe('old')
  })
})
