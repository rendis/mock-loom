import { extractPathParamNames } from './path-template'

export interface ManualImportRequestBody {
  example: unknown
  schema: Record<string, unknown>
}

export function supportsRequestBody(method: string): boolean {
  const normalized = method.trim().toUpperCase()
  return normalized === 'POST' || normalized === 'PUT' || normalized === 'PATCH'
}

export function buildManualImportPayload(
  method: string,
  path: string,
  requestBody: ManualImportRequestBody | null = null
): string {
  const parameters = extractPathParamNames(path).map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }))
  const methodKey = method.trim().toLowerCase()
  const operation: Record<string, unknown> = {
    parameters,
    responses: {
      200: { description: 'ok' },
    },
  }

  if (requestBody && supportsRequestBody(method)) {
    operation.requestBody = {
      required: false,
      content: {
        'application/json': {
          schema: requestBody.schema,
          example: requestBody.example,
        },
      },
    }
  }

  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Mock Loom Manual Route', version: '1.0.0' },
    paths: {
      [path]: {
        [methodKey]: operation,
      },
    },
  })
}
