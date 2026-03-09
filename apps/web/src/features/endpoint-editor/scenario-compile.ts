import type { EndpointScenario, RuntimeMutation } from '../../types/api'

import { diagnostic, headersFromPairs, sortRecord, type ScenarioCompileResult, type ScenarioDiagnostic, type ScenarioDraft } from './scenario-model'

const LOOP_PATTERN = /\b(for|while|do)\b/
const IF_PATTERN = /\bif\s*\(/

export interface ScenarioCompileContext {
  sourcePaths: string[]
  requestPaths?: string[]
}

export interface ScenarioCompileManyResult {
  scenarios: EndpointScenario[]
  diagnostics: ScenarioDiagnostic[]
}

export function compileScenarioDraft(draft: ScenarioDraft, context: ScenarioCompileContext): ScenarioCompileResult {
  const diagnostics: ScenarioDiagnostic[] = []
  const sourceSlugs = sourceSlugsFromPaths(context.sourcePaths)
  const conditionExpr = compileWhenExpr(draft, sourceSlugs, diagnostics)
  const response = compileResponse(draft, diagnostics)
  const mutations = compileMutations(draft, sourceSlugs, diagnostics)

  const scenario: EndpointScenario = {
    name: draft.name.trim(),
    priority: draft.priority,
    conditionExpr,
    response,
    ...(mutations.length > 0 ? { mutations } : {}),
  }

  return {
    scenario,
    diagnostics,
  }
}

export function compileScenarioDrafts(drafts: ScenarioDraft[], context: ScenarioCompileContext): ScenarioCompileManyResult {
  const diagnostics: ScenarioDiagnostic[] = []
  const scenarios: EndpointScenario[] = []

  drafts.forEach((item) => {
    const result = compileScenarioDraft(item, context)
    scenarios.push(result.scenario)
    diagnostics.push(...result.diagnostics)
  })

  return {
    scenarios,
    diagnostics,
  }
}

function compileWhenExpr(
  draft: ScenarioDraft,
  sourceSlugs: Set<string>,
  diagnostics: ScenarioDiagnostic[]
): string {
  if (draft.fallback) {
    return 'true'
  }

  const normalized = stripExprComments(draft.whenExpr).trim()
  if (normalized === '') {
    diagnostics.push(
      diagnostic(draft.id, 'when', 'scenario.validation.when-required', 'WHEN expression is required for non-fallback scenarios.')
    )
    return 'true'
  }

  if (LOOP_PATTERN.test(normalized) || IF_PATTERN.test(normalized)) {
    diagnostics.push(
      diagnostic(draft.id, 'when', 'scenario.validation.when-script', 'WHEN must be a pure expr condition, not script statements.')
    )
  }

  if (containsRequestParamAlias(normalized)) {
    diagnostics.push(
      diagnostic(
        draft.id,
        'when',
        'scenario.validation.request-param-alias',
        'request.param.* is an autocomplete alias. Use canonical request.params.<scope>.<key> paths before saving.'
      )
    )
  }

  for (const slug of extractSourceSlugs(normalized)) {
    if (!sourceSlugs.has(slug)) {
      diagnostics.push(
        diagnostic(draft.id, 'when', 'scenario.validation.source-unknown', `Unknown source slug "${slug}" in WHEN expression.`)
      )
    }
  }

  return normalized
}

function compileResponse(draft: ScenarioDraft, diagnostics: ScenarioDiagnostic[]): EndpointScenario['response'] {
  const statusCode = Number.parseInt(draft.response.statusCode.trim(), 10)
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    diagnostics.push(
      diagnostic(draft.id, 'response.statusCode', 'scenario.validation.response-status', 'Response statusCode must be an integer between 100 and 599.')
    )
  }

  const delayMs = Number.parseInt(draft.response.delayMs.trim(), 10)
  if (!Number.isInteger(delayMs) || delayMs < 0) {
    diagnostics.push(
      diagnostic(draft.id, 'response.delayMs', 'scenario.validation.response-delay', 'Response delayMs must be an integer greater than or equal to 0.')
    )
  }

  const bodyParsed = safeParseJSON(draft.response.bodyJson)
  if (!isObject(bodyParsed)) {
    diagnostics.push(
      diagnostic(draft.id, 'response.body', 'scenario.validation.response-body', 'Response body must be a valid JSON object.')
    )
  }

  const headersParsed =
    draft.response.headersMode === 'advanced'
      ? parseHeadersObject(draft.response.headersJson, draft.id, diagnostics, 'response.headers')
      : parseHeadersObject(JSON.stringify(headersFromPairs(draft.response.headers), null, 2), draft.id, diagnostics, 'response.headers')

  return {
    statusCode: Number.isInteger(statusCode) ? statusCode : 200,
    delayMs: Number.isInteger(delayMs) && delayMs >= 0 ? delayMs : 0,
    headers: sortRecord(headersParsed),
    body: isObject(bodyParsed) ? bodyParsed : { ok: true },
  }
}

function compileMutations(
  draft: ScenarioDraft,
  sourceSlugs: Set<string>,
  diagnostics: ScenarioDiagnostic[]
): RuntimeMutation[] {
  const mutations: RuntimeMutation[] = []

  draft.mutations.forEach((item, index) => {
    const baseField = `mutations.${index}`
    const sourceSlug = item.sourceSlug.trim()
    if (sourceSlug === '') {
      diagnostics.push(
        diagnostic(draft.id, `${baseField}.sourceSlug`, 'scenario.validation.mutation-source', 'Mutation source slug is required.')
      )
      return
    }

    if (!sourceSlugs.has(sourceSlug)) {
      diagnostics.push(
        diagnostic(
          draft.id,
          `${baseField}.sourceSlug`,
          'scenario.validation.source-unknown',
          `Unknown source slug "${sourceSlug}" in mutation.`
        )
      )
    }

    const entityIdExprRaw = stripExprComments(item.entityIdExpr).trim()
    const entityIdExpr = entityIdExprRaw.trim()
    if (entityIdExpr === '') {
      diagnostics.push(
        diagnostic(
          draft.id,
          `${baseField}.entityIdExpr`,
          'scenario.validation.mutation-entity',
          'Mutation entityId expression is required.'
        )
      )
      return
    }

    if (containsRequestParamAlias(entityIdExpr)) {
      diagnostics.push(
        diagnostic(
          draft.id,
          `${baseField}.entityIdExpr`,
          'scenario.validation.request-param-alias',
          'request.param.* is an autocomplete alias. Use canonical request.params.<scope>.<key> paths before saving.'
        )
      )
    }

    for (const slug of extractSourceSlugs(entityIdExpr)) {
      if (!sourceSlugs.has(slug)) {
        diagnostics.push(
          diagnostic(
            draft.id,
            `${baseField}.entityIdExpr`,
            'scenario.validation.source-unknown',
            `Unknown source slug "${slug}" in mutation entity expression.`
          )
        )
      }
    }

    if (item.type === 'delete') {
      mutations.push({
        type: 'DELETE',
        sourceSlug,
        entityIdExpr,
      })
      return
    }

    const payloadExprRaw = stripExprComments(item.payloadExpr).trim()
    const payloadExpr = payloadExprRaw.trim()
    if (payloadExpr === '') {
      diagnostics.push(
        diagnostic(
          draft.id,
          `${baseField}.payloadExpr`,
          'scenario.validation.mutation-payload',
          'Mutation payload expression is required for update.'
        )
      )
      return
    }

    if (containsRequestParamAlias(payloadExpr)) {
      diagnostics.push(
        diagnostic(
          draft.id,
          `${baseField}.payloadExpr`,
          'scenario.validation.request-param-alias',
          'request.param.* is an autocomplete alias. Use canonical request.params.<scope>.<key> paths before saving.'
        )
      )
    }

    for (const slug of extractSourceSlugs(payloadExpr)) {
      if (!sourceSlugs.has(slug)) {
        diagnostics.push(
          diagnostic(
            draft.id,
            `${baseField}.payloadExpr`,
            'scenario.validation.source-unknown',
            `Unknown source slug "${slug}" in mutation payload expression.`
          )
        )
      }
    }

    mutations.push({
      type: 'UPSERT',
      sourceSlug,
      entityIdExpr,
      payloadExpr,
    })
  })

  return mutations
}

function parseHeadersObject(
  source: string,
  scenarioId: string,
  diagnostics: ScenarioDiagnostic[],
  field: string
): Record<string, string> {
  const parsed = safeParseJSON(source)
  if (!isObject(parsed)) {
    diagnostics.push(diagnostic(scenarioId, field, 'scenario.validation.response-headers', 'Response headers must be a JSON object.'))
    return {
      'Content-Type': 'application/json',
    }
  }

  const normalized = Object.entries(parsed).reduce<Record<string, string>>((acc, [key, value]) => {
    if (key.trim() === '') {
      return acc
    }
    if (typeof value !== 'string') {
      diagnostics.push(
        diagnostic(scenarioId, field, 'scenario.validation.response-header-value', `Header "${key}" must be a string value.`)
      )
      acc[key] = String(value)
      return acc
    }
    acc[key] = value
    return acc
  }, {})

  if (Object.keys(normalized).length === 0) {
    normalized['Content-Type'] = 'application/json'
  }
  return normalized
}

function stripExprComments(input: string): string {
  return input
    .split('\n')
    .map((line) => {
      const index = line.indexOf('//')
      if (index < 0) {
        return line
      }
      return line.slice(0, index)
    })
    .join('\n')
}

function extractSourceSlugs(expression: string): string[] {
  const slugs = new Set<string>()

  const propertyMatches = expression.matchAll(/\bsource\.([A-Za-z0-9_-]+)/g)
  for (const match of propertyMatches) {
    const raw = match[1]?.trim()
    if (!raw) {
      continue
    }
    const slug = raw.endsWith('_by_id') ? raw.slice(0, -6) : raw
    if (slug !== '') {
      slugs.add(slug)
    }
  }

  const bracketMatches = expression.matchAll(/\bsource\[['"]([^'"\]]+)['"]\]/g)
  for (const match of bracketMatches) {
    const raw = match[1]?.trim()
    if (!raw) {
      continue
    }
    const slug = raw.endsWith('_by_id') ? raw.slice(0, -6) : raw
    if (slug !== '') {
      slugs.add(slug)
    }
  }

  return [...slugs]
}

function containsRequestParamAlias(expression: string): boolean {
  return /\brequest\.param(?:\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)?\b/.test(expression)
}

function sourceSlugsFromPaths(paths: string[]): Set<string> {
  const result = new Set<string>()
  paths.forEach((path) => {
    const normalized = path.replaceAll('[]', '').trim()
    if (!normalized.startsWith('source.')) {
      return
    }
    const parts = normalized.split('.')
    const slug = parts[1]?.trim()
    if (slug) {
      result.add(slug)
    }
  })
  return result
}

function safeParseJSON(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
