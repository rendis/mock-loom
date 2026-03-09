export interface CursorToken {
  token: string
  startIndex: number
  endIndex: number
  hasTrailingDot: boolean
}

const TOKEN_CHAR_PATTERN = /[A-Za-z0-9_.\[\]"'\-]/

export function extractCursorToken(prefix: string): CursorToken {
  let endIndex = prefix.length
  while (endIndex > 0 && /\s/.test(prefix[endIndex - 1] ?? '')) {
    endIndex -= 1
  }

  let startIndex = endIndex
  while (startIndex > 0 && TOKEN_CHAR_PATTERN.test(prefix[startIndex - 1] ?? '')) {
    startIndex -= 1
  }

  const token = prefix.slice(startIndex, endIndex)

  return {
    token,
    startIndex,
    endIndex,
    hasTrailingDot: token.endsWith('.'),
  }
}
