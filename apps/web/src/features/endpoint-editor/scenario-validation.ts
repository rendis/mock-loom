import { compileScenarioDrafts, type ScenarioCompileContext } from './scenario-compile'
import { diagnostic, type ScenarioDiagnostic, type ScenarioDraft } from './scenario-model'

export interface ScenarioValidationContext extends ScenarioCompileContext {
  legacyDiagnostics?: ScenarioDiagnostic[]
}

export interface ScenarioValidationResult {
  diagnostics: ScenarioDiagnostic[]
}

export function validateScenarioDraftsStrict(drafts: ScenarioDraft[], context: ScenarioValidationContext): ScenarioValidationResult {
  const diagnostics: ScenarioDiagnostic[] = [...(context.legacyDiagnostics ?? [])]
  const priorities = new Map<number, string>()
  let fallbackCount = 0

  drafts.forEach((item) => {
    if (!Number.isInteger(item.priority) || item.priority <= 0) {
      diagnostics.push(
        diagnostic(item.id, 'priority', 'scenario.validation.priority-range', 'Scenario priority must be a positive integer.')
      )
    }

    const existing = priorities.get(item.priority)
    if (existing) {
      diagnostics.push(
        diagnostic(item.id, 'priority', 'scenario.validation.priority-duplicate', `Priority ${item.priority} duplicates scenario "${existing}".`)
      )
    } else {
      priorities.set(item.priority, item.name || item.id)
    }

    if (item.fallback) {
      fallbackCount += 1
      if (item.whenExpr.trim() !== 'true') {
        diagnostics.push(
          diagnostic(item.id, 'when', 'scenario.validation.fallback-condition', 'Fallback scenario WHEN must be exactly `true`.')
        )
      }
    }
  })

  if (fallbackCount > 1) {
    diagnostics.push(
      diagnostic(
        'global',
        'fallback',
        'scenario.validation.fallback-count',
        'At most one fallback scenario is allowed (WHEN = true).'
      )
    )
  }

  const compiled = compileScenarioDrafts(drafts, context)
  diagnostics.push(...compiled.diagnostics)

  return {
    diagnostics: dedupeDiagnostics(diagnostics),
  }
}

function dedupeDiagnostics(values: ScenarioDiagnostic[]): ScenarioDiagnostic[] {
  const map = new Map<string, ScenarioDiagnostic>()
  values.forEach((item) => {
    const key = `${item.scenarioId}:${item.field}:${item.code}:${item.message}:${item.line}:${item.column}`
    if (!map.has(key)) {
      map.set(key, item)
    }
  })
  return [...map.values()]
}
