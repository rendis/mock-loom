type JsonSchemaNode = Record<string, unknown>

export function inferRequestBodySchemaFromExample(example: unknown): JsonSchemaNode {
  return inferSchemaNode(example)
}

function inferSchemaNode(value: unknown): JsonSchemaNode {
  if (value === null) {
    return { type: 'null' }
  }

  if (typeof value === 'string') {
    return { type: 'string' }
  }

  if (typeof value === 'boolean') {
    return { type: 'boolean' }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return { type: Number.isInteger(value) ? 'integer' : 'number' }
  }

  if (Array.isArray(value)) {
    return inferArraySchema(value)
  }

  if (isObject(value)) {
    return inferObjectSchema(value)
  }

  return { type: 'string' }
}

function inferObjectSchema(value: Record<string, unknown>): JsonSchemaNode {
  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right))
  const properties = keys.reduce<Record<string, JsonSchemaNode>>((acc, key) => {
    acc[key] = inferSchemaNode(value[key])
    return acc
  }, {})

  return {
    type: 'object',
    additionalProperties: true,
    properties,
    required: keys,
  }
}

function inferArraySchema(value: unknown[]): JsonSchemaNode {
  if (value.length === 0) {
    return {
      type: 'array',
      items: {},
    }
  }

  const uniqueByFingerprint = new Map<string, JsonSchemaNode>()
  value.forEach((item) => {
    const schema = inferSchemaNode(item)
    const fingerprint = stableStringify(schema)
    if (!uniqueByFingerprint.has(fingerprint)) {
      uniqueByFingerprint.set(fingerprint, schema)
    }
  })

  const variants = [...uniqueByFingerprint.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, schema]) => schema)

  if (variants.length === 1) {
    return {
      type: 'array',
      items: variants[0],
    }
  }

  return {
    type: 'array',
    items: {
      oneOf: variants,
    },
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item))
  }

  if (isObject(value)) {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(value[key])
        return acc
      }, {})
  }

  return value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
