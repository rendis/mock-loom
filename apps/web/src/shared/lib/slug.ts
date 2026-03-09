function normalizeSlugCharacters(rawValue: string): string {
  return rawValue
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
}

export function formatSlugInput(rawValue: string): string {
  return normalizeSlugCharacters(rawValue)
}

export function finalizeSlugInput(rawValue: string): string {
  return normalizeSlugCharacters(rawValue)
    .replace(/^-|-$/g, '')
}
