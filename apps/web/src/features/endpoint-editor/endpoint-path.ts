export function normalizeEndpointPathInput(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    return '/'
  }
  if (trimmed.startsWith('/')) {
    return trimmed
  }
  return `/${trimmed}`
}

export function normalizePackBasePath(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '/') {
    return '/'
  }
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.replace(/\/+$/, '')
}

export function composeEndpointPath(basePath: string, endpointPath: string): string {
  const normalizedBasePath = normalizePackBasePath(basePath)
  const normalizedEndpointPath = normalizeEndpointPathInput(endpointPath)
  if (normalizedBasePath === '/') {
    return normalizedEndpointPath
  }
  if (normalizedEndpointPath === normalizedBasePath || normalizedEndpointPath.startsWith(`${normalizedBasePath}/`)) {
    return normalizedEndpointPath
  }
  if (normalizedEndpointPath === '/') {
    return normalizedBasePath
  }
  return `${normalizedBasePath}/${normalizedEndpointPath.replace(/^\/+/, '')}`
}

export function toRelativeEndpointPath(fullPath: string, basePath: string): string {
  const normalizedBasePath = normalizePackBasePath(basePath)
  const normalizedFullPath = normalizeEndpointPathInput(fullPath)
  if (normalizedBasePath === '/') {
    return normalizedFullPath
  }
  if (normalizedFullPath === normalizedBasePath) {
    return '/'
  }
  const prefix = `${normalizedBasePath}/`
  if (normalizedFullPath.startsWith(prefix)) {
    return `/${normalizedFullPath.slice(prefix.length)}`
  }
  return normalizedFullPath
}

export function isValidRelativeEndpointPath(value: string): boolean {
  const normalized = normalizeEndpointPathInput(value)
  return normalized.startsWith('/') && normalized.length > 1
}

export function includesPackBasePath(relativePath: string, basePath: string): boolean {
  const normalizedBasePath = normalizePackBasePath(basePath)
  if (normalizedBasePath === '/') {
    return false
  }
  const normalizedRelative = normalizeEndpointPathInput(relativePath)
  return normalizedRelative === normalizedBasePath || normalizedRelative.startsWith(`${normalizedBasePath}/`)
}
