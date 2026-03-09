import type { EndpointScenario, RuntimeMutation } from '../../types/api'

export type ScenarioMutationDraftType = 'update' | 'delete'
export type ScenarioHeadersMode = 'simple' | 'advanced'

export interface ScenarioHeaderItemDraft {
  id: string
  key: string
  value: string
}

export interface ScenarioMutationDraft {
  id: string
  type: ScenarioMutationDraftType
  sourceSlug: string
  entityIdExpr: string
  payloadExpr: string
}

export interface ScenarioResponseDraft {
  statusCode: string
  delayMs: string
  bodyJson: string
  headersMode: ScenarioHeadersMode
  headersJson: string
  headers: ScenarioHeaderItemDraft[]
}

export interface ScenarioDraft {
  id: string
  name: string
  priority: number
  fallback: boolean
  whenExpr: string
  response: ScenarioResponseDraft
  mutations: ScenarioMutationDraft[]
}

export interface ScenarioDiagnostic {
  code: string
  message: string
  scenarioId: string
  field: string
  line: number
  column: number
  endLine: number
  endColumn: number
}

export interface ScenarioCompileResult {
  scenario: EndpointScenario
  diagnostics: ScenarioDiagnostic[]
}

export interface ScenarioLoadResult {
  drafts: ScenarioDraft[]
  diagnostics: ScenarioDiagnostic[]
}

const EMPTY_SCENARIO_ID = 'global'

export function defaultScenarioDraft(index: number, fallback = false): ScenarioDraft {
  const base = index + 1
  return {
    id: createScenarioDraftID(),
    name: fallback ? 'Fallback Not Found' : `Scenario ${base}`,
    priority: base * 10,
    fallback,
    whenExpr: fallback ? 'true' : 'request.method == "GET"',
    response: {
      statusCode: fallback ? '404' : '200',
      delayMs: '0',
      bodyJson: fallback ? '{\n  "error": "not_found"\n}' : '{\n  "ok": true\n}',
      headersMode: 'simple',
      headersJson: '{\n  "Content-Type": "application/json"\n}',
      headers: [
        {
          id: createScenarioHeaderID(),
          key: 'Content-Type',
          value: 'application/json',
        },
      ],
    },
    mutations: [],
  }
}

export function ensureSingleFallback(drafts: ScenarioDraft[]): ScenarioDraft[] {
  if (drafts.length === 0) {
    return []
  }

  const fallbackIndex = drafts.findIndex((item) => item.fallback)
  if (fallbackIndex >= 0) {
    return drafts.map((item, index) =>
      index === fallbackIndex
        ? {
            ...item,
            fallback: true,
            whenExpr: 'true',
          }
        : {
            ...item,
            fallback: false,
          }
    )
  }

  return drafts
}

export function normalizeScenarioPriorities(drafts: ScenarioDraft[]): ScenarioDraft[] {
  return drafts
    .slice()
    .sort((left, right) => left.priority - right.priority)
    .map((item, index) => ({
      ...item,
      priority: (index + 1) * 10,
    }))
}

export function appendScenario(drafts: ScenarioDraft[]): ScenarioDraft[] {
  const next = [
    ...drafts,
    defaultScenarioDraft(drafts.length, false),
  ]
  return normalizeScenarioPriorities(next)
}

export function duplicateScenario(drafts: ScenarioDraft[], scenarioId: string): ScenarioDraft[] {
  const index = drafts.findIndex((item) => item.id === scenarioId)
  if (index < 0) {
    return drafts
  }
  const source = drafts[index]
  if (!source) {
    return drafts
  }

  const clone: ScenarioDraft = {
    ...source,
    id: createScenarioDraftID(),
    name: `${source.name} Copy`,
    fallback: false,
    whenExpr: source.fallback ? 'request.method == "GET"' : source.whenExpr,
    response: {
      ...source.response,
      headers: source.response.headers.map((header, headerIndex) => ({
        ...header,
        id: createScenarioHeaderID(headerIndex),
      })),
    },
    mutations: source.mutations.map((mutation, mutationIndex) => ({
      ...mutation,
      id: createScenarioMutationID(mutationIndex),
    })),
  }

  const next = [...drafts]
  next.splice(index + 1, 0, clone)
  return normalizeScenarioPriorities(next)
}

export function moveScenario(drafts: ScenarioDraft[], scenarioId: string, direction: -1 | 1): ScenarioDraft[] {
  const index = drafts.findIndex((item) => item.id === scenarioId)
  if (index < 0) {
    return drafts
  }
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= drafts.length) {
    return drafts
  }

  const next = drafts.slice()
  const [selected] = next.splice(index, 1)
  if (!selected) {
    return drafts
  }
  next.splice(targetIndex, 0, selected)
  return normalizeScenarioPriorities(next)
}

export function removeScenario(drafts: ScenarioDraft[], scenarioId: string): ScenarioDraft[] {
  const next = drafts.filter((item) => item.id !== scenarioId)
  if (next.length === 0) {
    return []
  }
  return normalizeScenarioPriorities(next)
}

export function withFallbackScenario(drafts: ScenarioDraft[], scenarioId: string): ScenarioDraft[] {
  return drafts.map((item) =>
    item.id === scenarioId
      ? {
          ...item,
          fallback: true,
          whenExpr: 'true',
        }
      : {
          ...item,
          fallback: false,
        }
  )
}

export function withoutFallbackScenario(drafts: ScenarioDraft[], scenarioId: string): ScenarioDraft[] {
  return drafts.map((item) =>
    item.id !== scenarioId
      ? item
      : {
          ...item,
          fallback: false,
          whenExpr: item.whenExpr.trim() === 'true' ? 'request.method == "GET"' : item.whenExpr,
        }
  )
}

export function serializeHeadersPairs(headers: Record<string, string>): string {
  return JSON.stringify(sortRecord(headers), null, 2)
}

export function headersFromPairs(headers: ScenarioHeaderItemDraft[]): Record<string, string> {
  return headers.reduce<Record<string, string>>((acc, item) => {
    const key = item.key.trim()
    if (key === '') {
      return acc
    }
    acc[key] = item.value
    return acc
  }, {})
}

export function mutationDraftFromRuntime(item: RuntimeMutation, index: number): ScenarioMutationDraft {
  return {
    id: createScenarioMutationID(index),
    type: item.type === 'DELETE' ? 'delete' : 'update',
    sourceSlug: item.sourceSlug ?? '',
    entityIdExpr: item.entityIdExpr ?? '',
    payloadExpr: item.payloadExpr ?? 'request.params.body',
  }
}

export function addMutation(draft: ScenarioDraft): ScenarioDraft {
  return {
    ...draft,
    mutations: [
      ...draft.mutations,
      {
        id: createScenarioMutationID(draft.mutations.length),
        type: 'update',
        sourceSlug: '',
        entityIdExpr: 'request.params.path.id',
        payloadExpr: 'request.params.body',
      },
    ],
  }
}

export function addHeader(draft: ScenarioDraft): ScenarioDraft {
  return {
    ...draft,
    response: {
      ...draft.response,
      headers: [
        ...draft.response.headers,
        {
          id: createScenarioHeaderID(draft.response.headers.length),
          key: '',
          value: '',
        },
      ],
    },
  }
}

export function sortRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, T>>((acc, key) => {
      acc[key] = value[key] as T
      return acc
    }, {})
}

export function diagnostic(
  scenarioId: string,
  field: string,
  code: string,
  message: string,
  line = 1,
  column = 1,
  endLine = 1,
  endColumn = 2
): ScenarioDiagnostic {
  return {
    code,
    message,
    scenarioId: scenarioId.trim() === '' ? EMPTY_SCENARIO_ID : scenarioId,
    field,
    line,
    column,
    endLine,
    endColumn,
  }
}

export function createScenarioDraftID(seed = 0): string {
  return createStableDraftID('scenario', seed)
}

export function createScenarioHeaderID(seed = 0): string {
  return createStableDraftID('header', seed)
}

export function createScenarioMutationID(seed = 0): string {
  return createStableDraftID('mutation', seed)
}

function createStableDraftID(prefix: string, seed = 0): string {
  const scope = typeof seed === 'number' && Number.isFinite(seed) && seed > 0 ? `-${seed}` : ''
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}${scope}`
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 12)}${scope}`
}
