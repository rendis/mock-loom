export type EditableContractParamScope = 'HEADER' | 'QUERY'

export interface EditableContractParam {
  id: string
  key: string
  expectedValue: string
  required: boolean
  scope: EditableContractParamScope
}

export interface DerivedPathParam {
  key: string
  expectedValue: string
  required: true
  scope: 'PATH'
  readOnly: true
}

interface JSONSchemaObject {
  type?: unknown
  properties?: Record<string, unknown>
  required?: unknown
  additionalProperties?: unknown
  [key: string]: unknown
}

const EXPECTED_VALUE_KEY = 'x-mockloom-expectedValue'

let editableParamCounter = 0

export function createEditableContractParam(scope: EditableContractParamScope = 'HEADER'): EditableContractParam {
  editableParamCounter += 1
  return {
    id: `contract-param-${editableParamCounter}`,
    key: '',
    expectedValue: '',
    required: false,
    scope,
  }
}

export function buildDerivedPathParams(names: string[]): DerivedPathParam[] {
  const seen = new Set<string>()
  const items: DerivedPathParam[] = []
  names.forEach((rawName) => {
    const key = rawName.trim()
    if (key === '' || seen.has(key)) {
      return
    }
    seen.add(key)
    items.push({
      key,
      expectedValue: 'Derived from URL',
      required: true,
      scope: 'PATH',
      readOnly: true,
    })
  })
  return items
}

export function parseEditableParamsFromContract(contractText: string): EditableContractParam[] {
  const parsed = safeParseJSONObject(contractText)
  if (!parsed) {
    return []
  }

  const rootProperties = readProperties(parsed)
  if (!rootProperties) {
    return []
  }

  const collected: EditableContractParam[] = []
  const headerSchema = asJSONObject(rootProperties.header) ?? asJSONObject(rootProperties.headers)
  const querySchema = asJSONObject(rootProperties.query)

  collectScopeParams(collected, 'HEADER', headerSchema)
  collectScopeParams(collected, 'QUERY', querySchema)

  return sanitizeEditableParams(collected)
}

export function injectEditableParamsIntoContract(contractText: string, editableParams: EditableContractParam[]): string {
  const parsed = safeParseJSONObject(contractText)
  if (!parsed) {
    throw new Error('Contract must be a valid JSON object.')
  }

  const sanitized = sanitizeEditableParams(editableParams)
  const next = cloneJSONObject(parsed)
  const rootProperties = ensureProperties(next)

  delete rootProperties.header
  delete rootProperties.headers
  delete rootProperties.query

  const byScope = {
    HEADER: sanitized.filter((item) => item.scope === 'HEADER'),
    QUERY: sanitized.filter((item) => item.scope === 'QUERY'),
  }

  const headerSchema = buildScopeSchema(byScope.HEADER)
  if (headerSchema) {
    rootProperties.header = headerSchema
  }

  const querySchema = buildScopeSchema(byScope.QUERY)
  if (querySchema) {
    rootProperties.query = querySchema
  }

  return JSON.stringify(next)
}

export function sanitizeEditableParams(params: EditableContractParam[]): EditableContractParam[] {
  const scopedKeys = new Set<string>()
  const items: EditableContractParam[] = []

  params.forEach((rawParam) => {
    const scope = rawParam.scope === 'QUERY' ? 'QUERY' : 'HEADER'
    const key = rawParam.key.trim()
    if (key === '') {
      return
    }

    const scopedKey = `${scope}:${key.toLowerCase()}`
    if (scopedKeys.has(scopedKey)) {
      return
    }
    scopedKeys.add(scopedKey)

    items.push({
      id: rawParam.id || createEditableContractParam(scope).id,
      key,
      expectedValue: rawParam.expectedValue.trim(),
      required: Boolean(rawParam.required),
      scope,
    })
  })

  return items
}

function collectScopeParams(target: EditableContractParam[], scope: EditableContractParamScope, schema: JSONSchemaObject | null): void {
  if (!schema) {
    return
  }

  const properties = readProperties(schema)
  if (!properties) {
    return
  }

  const required = readRequired(schema)
  Object.entries(properties).forEach(([key, rawSchema]) => {
    const trimmedKey = key.trim()
    if (trimmedKey === '') {
      return
    }
    target.push({
      ...createEditableContractParam(scope),
      key: trimmedKey,
      expectedValue: readExpectedValue(rawSchema),
      required: required.has(trimmedKey),
      scope,
    })
  })
}

function readExpectedValue(rawSchema: unknown): string {
  const schema = asJSONObject(rawSchema)
  if (!schema) {
    return ''
  }

  if (typeof schema[EXPECTED_VALUE_KEY] === 'string') {
    return schema[EXPECTED_VALUE_KEY]
  }
  if (typeof schema.example === 'string') {
    return schema.example
  }
  if (typeof schema.example === 'number' || typeof schema.example === 'boolean') {
    return String(schema.example)
  }
  if (schema.example !== undefined) {
    try {
      return JSON.stringify(schema.example)
    } catch {
      return ''
    }
  }
  return ''
}

function buildScopeSchema(items: EditableContractParam[]): JSONSchemaObject | null {
  if (items.length === 0) {
    return null
  }

  const properties: Record<string, unknown> = {}
  const required: string[] = []

  items.forEach((item) => {
    const entry: JSONSchemaObject = { type: 'string' }
    if (item.expectedValue.trim() !== '') {
      entry[EXPECTED_VALUE_KEY] = item.expectedValue.trim()
    }
    properties[item.key] = entry
    if (item.required) {
      required.push(item.key)
    }
  })

  const scopeSchema: JSONSchemaObject = {
    type: 'object',
    additionalProperties: true,
    properties,
  }
  if (required.length > 0) {
    scopeSchema.required = required
  }
  return scopeSchema
}

function readRequired(schema: JSONSchemaObject): Set<string> {
  const set = new Set<string>()
  if (!Array.isArray(schema.required)) {
    return set
  }
  schema.required.forEach((value) => {
    if (typeof value === 'string' && value.trim() !== '') {
      set.add(value.trim())
    }
  })
  return set
}

function readProperties(schema: JSONSchemaObject): Record<string, unknown> | null {
  if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
    return null
  }
  return schema.properties as Record<string, unknown>
}

function ensureProperties(schema: JSONSchemaObject): Record<string, unknown> {
  const existing = readProperties(schema)
  if (existing) {
    return existing
  }
  schema.properties = {}
  return schema.properties as Record<string, unknown>
}

function safeParseJSONObject(text: string): JSONSchemaObject | null {
  try {
    const parsed = JSON.parse(text) as unknown
    return asJSONObject(parsed)
  } catch {
    return null
  }
}

function cloneJSONObject(value: JSONSchemaObject): JSONSchemaObject {
  return JSON.parse(JSON.stringify(value)) as JSONSchemaObject
}

function asJSONObject(value: unknown): JSONSchemaObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as JSONSchemaObject
}
