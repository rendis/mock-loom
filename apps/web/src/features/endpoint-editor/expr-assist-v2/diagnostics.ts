export interface ExprRewriteDiagnostic {
  code: string
  message: string
  line: number
  column: number
  endLine: number
  endColumn: number
}

export function createExprRewriteDiagnostic(code: string, message: string, offset: number, width = 1): ExprRewriteDiagnostic {
  const column = Math.max(1, offset + 1)
  return {
    code,
    message,
    line: 1,
    column,
    endLine: 1,
    endColumn: column + Math.max(1, width),
  }
}
