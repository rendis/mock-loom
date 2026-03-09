import { canonicalizeLookupPath } from './catalog'
import { createExprRewriteDiagnostic, type ExprRewriteDiagnostic } from './diagnostics'

export interface ExprRewriteInput {
  expression: string
  knownPaths?: Set<string>
}

export interface ExprRewriteResult {
  expression: string
  diagnostics: ExprRewriteDiagnostic[]
}

const CHAIN_METHOD_PATTERN = /((?:request|source|auth)[A-Za-z0-9_.\[\]"'\-]+)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)/g

const CHAIN_METHOD_DOC = 'Allowed methods: contains, startsWith, startWith, endsWith, endWith, isTrue, isFalse, in.'

export function rewriteExprChainSugar(input: ExprRewriteInput): ExprRewriteResult {
  const diagnostics: ExprRewriteDiagnostic[] = []
  let rewritten = input.expression

  rewritten = rewritten.replace(CHAIN_METHOD_PATTERN, (fullMatch, rawPath: string, method: string, rawArgs: string, rawOffset: number) => {
    const canonicalPath = canonicalizeLookupPath(rawPath)
    if (input.knownPaths && !isKnownPath(canonicalPath, input.knownPaths)) {
      diagnostics.push(
        createExprRewriteDiagnostic(
          'script.validation.chain-unknown-path',
          `Unknown expression path "${canonicalPath}" for chain operator.`,
          rawOffset,
          String(rawPath).length
        )
      )
      return fullMatch
    }

    const methodKey = method.trim()
    const args = rawArgs.trim()

    switch (methodKey) {
      case 'contains':
        return `contains(${canonicalPath}, ${args})`
      case 'startsWith':
      case 'startWith':
        return `startsWith(${canonicalPath}, ${args})`
      case 'endsWith':
      case 'endWith':
        return `endsWith(${canonicalPath}, ${args})`
      case 'isTrue':
        if (args !== '') {
          diagnostics.push(
            createExprRewriteDiagnostic(
              'script.validation.chain-args',
              'isTrue() does not accept arguments.',
              rawOffset,
              String(fullMatch).length
            )
          )
          return fullMatch
        }
        return `${canonicalPath} == true`
      case 'isFalse':
        if (args !== '') {
          diagnostics.push(
            createExprRewriteDiagnostic(
              'script.validation.chain-args',
              'isFalse() does not accept arguments.',
              rawOffset,
              String(fullMatch).length
            )
          )
          return fullMatch
        }
        return `${canonicalPath} == false`
      case 'in':
        return `${canonicalPath} in ${args}`
      default:
        diagnostics.push(
          createExprRewriteDiagnostic(
            'script.validation.chain-unknown-method',
            `Unknown chain method "${methodKey}". ${CHAIN_METHOD_DOC}`,
            rawOffset,
            String(fullMatch).length
          )
        )
        return fullMatch
    }
  })

  return {
    expression: rewritten,
    diagnostics,
  }
}

function isKnownPath(path: string, knownPaths: Set<string>): boolean {
  if (knownPaths.has(path)) {
    return true
  }

  if (path === 'request.path' || path === 'request.method') {
    return true
  }

  if (path.startsWith('request.params.path.') || path.startsWith('request.params.query.') || path.startsWith('request.params.headers.')) {
    return true
  }

  return false
}
