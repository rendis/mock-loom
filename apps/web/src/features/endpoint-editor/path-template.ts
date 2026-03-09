export interface PathTemplateTextToken {
  id: string
  type: 'text'
  value: string
}

export interface PathTemplateParamToken {
  id: string
  type: 'param'
  name: string
}

export type PathTemplateToken = PathTemplateTextToken | PathTemplateParamToken

const PATH_PARAM_NAME_PATTERN = /^[a-z0-9_]+$/

let pathTemplateTokenCounter = 0

export function tokenizePathTemplate(value: string): PathTemplateToken[] {
  const source = value ?? ''
  const tokens: PathTemplateToken[] = []
  let textBuffer = ''
  let index = 0

  while (index < source.length) {
    const current = source[index] ?? ''

    if (current === '{') {
      const closeIndex = source.indexOf('}', index + 1)
      if (closeIndex >= 0) {
        flushTextBuffer(tokens, textBuffer)
        textBuffer = ''
        tokens.push(createPathParamToken(normalizePathParamName(source.slice(index + 1, closeIndex))))
        index = closeIndex + 1
        continue
      }
    }

    if (current === ':' && (index === 0 || source[index - 1] === '/')) {
      const result = consumeParamSegment(source, index + 1)
      if (result) {
        flushTextBuffer(tokens, textBuffer)
        textBuffer = ''
        tokens.push(createPathParamToken(result.name))
        index = result.nextIndex
        continue
      }
    }

    textBuffer += current
    index += 1
  }

  if (tokens.length === 0 || textBuffer !== '') {
    flushTextBuffer(tokens, textBuffer)
  }

  return mergeAdjacentTextTokens(tokens)
}

export function serializePathTemplate(tokens: PathTemplateToken[]): string {
  return tokens
    .map((token) => {
      if (token.type === 'text') {
        return token.value
      }
      return `:${normalizePathParamName(token.name)}`
    })
    .join('')
}

export function extractPathParamNames(value: string): string[] {
  const seen = new Set<string>()
  const params: string[] = []
  tokenizePathTemplate(value).forEach((token) => {
    if (token.type !== 'param') {
      return
    }
    const name = normalizePathParamName(token.name)
    if (!isValidPathParamName(name) || seen.has(name)) {
      return
    }
    seen.add(name)
    params.push(name)
  })
  return params
}

export function validatePathTemplate(value: string): string[] {
  const issues = new Set<string>()
  if ((value ?? '').includes('?')) {
    issues.add('Query string is not allowed in path. Define query params in Contract Params.')
  }
  tokenizePathTemplate(value).forEach((token) => {
    if (token.type === 'text') {
      if (token.value.includes('{') || token.value.includes('}')) {
        issues.add('Path parameter braces must be balanced.')
      }
      return
    }

    const name = normalizePathParamName(token.name)
    if (name === '') {
      issues.add('Path parameter name cannot be empty.')
    }
  })

  return [...issues]
}

export function insertEmptyPathParamAtCursor(value: string, cursor: number): string {
  const source = value ?? ''
  const safeCursor = Math.max(0, Math.min(cursor, source.length))
  return `${source.slice(0, safeCursor)}{}${source.slice(safeCursor)}`
}

export function createPathTextToken(value = ''): PathTemplateTextToken {
  pathTemplateTokenCounter += 1
  return {
    id: `path-token-text-${pathTemplateTokenCounter}`,
    type: 'text',
    value,
  }
}

export function createPathParamToken(name = ''): PathTemplateParamToken {
  pathTemplateTokenCounter += 1
  return {
    id: `path-token-param-${pathTemplateTokenCounter}`,
    type: 'param',
    name: normalizePathParamName(name),
  }
}

export function isValidPathParamName(value: string): boolean {
  return PATH_PARAM_NAME_PATTERN.test(value.trim())
}

export function normalizePathParamName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
}

export function finalizePathParamName(value: string): string {
  return normalizePathParamName(value).replace(/^_+/, '').replace(/_+$/, '')
}

export function normalizeAdjacentPathParamTokens(tokens: PathTemplateToken[]): PathTemplateToken[] {
  const withFilledTextSeparators = tokens.map((token, index) => {
    if (
      token.type === 'text' &&
      token.value === '' &&
      tokens[index - 1]?.type === 'param' &&
      tokens[index + 1]?.type === 'param'
    ) {
      return {
        ...token,
        value: '/',
      }
    }
    return token
  })

  const normalized: PathTemplateToken[] = []
  withFilledTextSeparators.forEach((token, index) => {
    normalized.push(token)
    if (token.type === 'param' && withFilledTextSeparators[index + 1]?.type === 'param') {
      normalized.push(createPathTextToken('/'))
    }
  })

  return normalized
}

export function mergeAdjacentTextTokens(tokens: PathTemplateToken[]): PathTemplateToken[] {
  const merged: PathTemplateToken[] = []
  tokens.forEach((token) => {
    if (token.type === 'text') {
      const previous = merged[merged.length - 1]
      if (previous?.type === 'text') {
        previous.value += token.value
        return
      }
    }
    merged.push(token)
  })
  return merged
}

function consumeParamSegment(source: string, startIndex: number): { name: string; nextIndex: number } | null {
  let end = startIndex
  while (end < source.length && source[end] !== '/' && source[end] !== '?') {
    end += 1
  }

  const name = normalizePathParamName(source.slice(startIndex, end))
  if (name === '') {
    return null
  }
  return { name, nextIndex: end }
}

function flushTextBuffer(tokens: PathTemplateToken[], value: string): void {
  if (value === '' && tokens.length > 0) {
    return
  }
  tokens.push(createPathTextToken(value))
}
