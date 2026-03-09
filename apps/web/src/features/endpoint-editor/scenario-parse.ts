import type { EndpointScenario, RuntimeMutation, ScenarioResponse } from '../../types/api'
import {
  createScenarioDraftID,
  createScenarioHeaderID,
  defaultScenarioDraft,
  diagnostic,
  headersFromPairs,
  mutationDraftFromRuntime,
  normalizeScenarioPriorities,
  serializeHeadersPairs,
  type ScenarioDiagnostic,
  type ScenarioDraft,
  type ScenarioLoadResult,
  type ScenarioHeaderItemDraft,
} from './scenario-model'

const ALLOWED_SCENARIO_KEYS = new Set(['name', 'priority', 'conditionExpr', 'response', 'mutations'])
const ALLOWED_RESPONSE_KEYS = new Set(['statusCode', 'delayMs', 'headers', 'body'])
const ALLOWED_MUTATION_KEYS = new Set(['type', 'sourceSlug', 'entityIdExpr', 'payloadExpr'])

export function parseScenarioDraftsFromJSON(scenariosJSON: string): ScenarioLoadResult {
  const diagnostics: ScenarioDiagnostic[] = []
  const parsed = safeParseJSON(scenariosJSON)
  if (!Array.isArray(parsed)) {
    diagnostics.push(diagnostic('global', 'root', 'scenario.parse.root', 'Scenarios JSON must be an array.'))
    return {
      drafts: [defaultScenarioDraft(0, false)],
      diagnostics,
    }
  }

  const drafts: ScenarioDraft[] = []
  parsed.forEach((rawItem, index) => {
    if (!isObject(rawItem)) {
      diagnostics.push(
        diagnostic('global', 'root', 'scenario.parse.entry', `Scenario at index ${index} must be a JSON object.`)
      )
      return
    }

    for (const key of Object.keys(rawItem)) {
      if (!ALLOWED_SCENARIO_KEYS.has(key)) {
        diagnostics.push(
          diagnostic(
            `scenario-${index + 1}`,
            'legacy',
            'scenario.parse.unknown-field',
            `Scenario at index ${index} contains unsupported field "${key}".`
          )
        )
      }
    }

    const responseObject = isObject(rawItem.response) ? rawItem.response : {}
    for (const key of Object.keys(responseObject)) {
      if (!ALLOWED_RESPONSE_KEYS.has(key)) {
        diagnostics.push(
          diagnostic(
            `scenario-${index + 1}`,
            'legacy',
            'scenario.parse.unknown-response-field',
            `Scenario response at index ${index} contains unsupported field "${key}".`
          )
        )
      }
    }

    const scenario = normalizeScenario(rawItem, index)
    const draft = scenarioToDraft(scenario, index)

    const rawMutations = Array.isArray(rawItem.mutations) ? rawItem.mutations : []
    rawMutations.forEach((rawMutation, mutationIndex) => {
      if (!isObject(rawMutation)) {
        diagnostics.push(
          diagnostic(
            draft.id,
            `mutations.${mutationIndex}`,
            'scenario.parse.invalid-mutation',
            `Scenario ${index + 1} mutation ${mutationIndex + 1} must be an object.`
          )
        )
        return
      }
      for (const key of Object.keys(rawMutation)) {
        if (!ALLOWED_MUTATION_KEYS.has(key)) {
          diagnostics.push(
            diagnostic(
              draft.id,
              `mutations.${mutationIndex}`,
              'scenario.parse.unknown-mutation-field',
              `Scenario ${index + 1} mutation ${mutationIndex + 1} contains unsupported field "${key}".`
            )
          )
        }
      }
    })

    drafts.push(draft)
  })

  if (drafts.length === 0) {
    return {
      drafts: [],
      diagnostics,
    }
  }

  const normalized = normalizeScenarioPriorities(drafts)

  return {
    drafts: normalized,
    diagnostics,
  }
}

function scenarioToDraft(scenario: EndpointScenario, index: number): ScenarioDraft {
  const response = normalizeResponse(scenario.response)
  const headersObject = normalizeHeaders(response.headers)
  const headersPairs = Object.entries(headersObject).map(([key, value], itemIndex) => ({
    id: createScenarioHeaderID(index + itemIndex + 1),
    key,
    value,
  }))

  return {
    id: createScenarioDraftID(index + 1),
    name: normalizeName(scenario.name, index),
    priority: Number.isInteger(scenario.priority) && scenario.priority > 0 ? scenario.priority : (index + 1) * 10,
    fallback: (scenario.conditionExpr ?? '').trim() === 'true',
    whenExpr: (scenario.conditionExpr ?? '').trim() || 'true',
    response: {
      statusCode: String(Number.isInteger(response.statusCode) ? response.statusCode : 200),
      delayMs: String(Number.isInteger(response.delayMs) ? response.delayMs : 0),
      bodyJson: stringifyObject(response.body, '{\n  "ok": true\n}'),
      headersMode: 'simple',
      headersJson: serializeHeadersPairs(headersObject),
      headers: headersPairs.length > 0 ? headersPairs : [emptyHeader()],
    },
    mutations: (scenario.mutations ?? []).map((item, mutationIndex) => mutationDraftFromRuntime(item, mutationIndex)),
  }
}

function normalizeScenario(raw: Record<string, unknown>, index: number): EndpointScenario {
  const response = isObject(raw.response) ? raw.response : {}
  const mutations = normalizeMutations(raw.mutations)

  return {
    name: normalizeName(raw.name, index),
    priority: normalizeInteger(raw.priority, (index + 1) * 10),
    conditionExpr: normalizeString(raw.conditionExpr, 'true'),
    response: {
      statusCode: normalizeInteger(response.statusCode, 200),
      delayMs: normalizeInteger(response.delayMs, 0),
      headers: normalizeHeaders(response.headers),
      body: normalizeBody(response.body),
    },
    ...(mutations.length > 0 ? { mutations } : {}),
  }
}

function normalizeMutations(raw: unknown): RuntimeMutation[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .map((item) => {
      if (!isObject(item)) {
        return null
      }
      const type = normalizeString(item.type, '').toUpperCase()
      if (type !== 'UPSERT' && type !== 'DELETE') {
        return null
      }
      return {
        type,
        sourceSlug: normalizeString(item.sourceSlug, ''),
        entityIdExpr: normalizeString(item.entityIdExpr, 'request.params.path.id'),
        payloadExpr: normalizeString(item.payloadExpr, 'request.params.body'),
      } as RuntimeMutation
    })
    .filter((item): item is RuntimeMutation => item !== null)
}

function normalizeName(raw: unknown, index: number): string {
  const name = normalizeString(raw, '')
  if (name !== '') {
    return name
  }
  return `Scenario ${index + 1}`
}

function normalizeInteger(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && Number.isInteger(raw)) {
    return raw
  }
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && Number.isInteger(parsed)) {
      return parsed
    }
  }
  return fallback
}

function normalizeString(raw: unknown, fallback: string): string {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    return trimmed === '' ? fallback : trimmed
  }
  return fallback
}

function normalizeResponse(raw: ScenarioResponse | undefined): Required<ScenarioResponse> {
  return {
    statusCode: Number.isInteger(raw?.statusCode) ? (raw?.statusCode as number) : 200,
    delayMs: Number.isInteger(raw?.delayMs) ? (raw?.delayMs as number) : 0,
    headers: normalizeHeaders(raw?.headers),
    body: normalizeBody(raw?.body),
  }
}

function normalizeHeaders(raw: unknown): Record<string, string> {
  if (!isObject(raw)) {
    return {
      'Content-Type': 'application/json',
    }
  }
  const normalized = Object.entries(raw).reduce<Record<string, string>>((acc, [key, value]) => {
    if (key.trim() === '') {
      return acc
    }
    acc[key] = typeof value === 'string' ? value : JSON.stringify(value)
    return acc
  }, {})
  if (Object.keys(normalized).length === 0) {
    return {
      'Content-Type': 'application/json',
    }
  }
  return normalized
}

function normalizeBody(raw: unknown): unknown {
  if (isObject(raw)) {
    return raw
  }
  if (typeof raw === 'string') {
    return raw
  }
  if (Array.isArray(raw)) {
    return { data: raw }
  }
  if (raw === null || raw === undefined) {
    return { ok: true }
  }
  return { value: raw }
}

function stringifyObject(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (isObject(value)) {
    return JSON.stringify(value, null, 2)
  }
  return fallback
}

function safeParseJSON(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function emptyHeader(): ScenarioHeaderItemDraft {
  return {
    id: createScenarioHeaderID(1),
    key: 'Content-Type',
    value: 'application/json',
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function applyHeadersJsonToPairs(headersJson: string): ScenarioHeaderItemDraft[] | null {
  const parsed = safeParseJSON(headersJson)
  if (!isObject(parsed)) {
    return null
  }
  return Object.entries(headersFromPairs(
    Object.entries(parsed).map(([key, value], index) => ({
      id: createScenarioHeaderID(index + 1),
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }))
  )).map(([key, value], index) => ({
    id: createScenarioHeaderID(index + 1),
    key,
    value,
  }))
}
