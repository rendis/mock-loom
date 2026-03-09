import type { PackFormValues, PackModalMode } from './pack-modal'

export function normalizePackSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
}

export function applyPackFormPatch(
  current: PackFormValues,
  patch: Partial<PackFormValues>,
  mode: PackModalMode
): PackFormValues {
  const next: PackFormValues = { ...current, ...patch }
  if (mode === 'create' && typeof patch.name === 'string') {
    next.slug = normalizePackSlug(patch.name)
  }
  return next
}
