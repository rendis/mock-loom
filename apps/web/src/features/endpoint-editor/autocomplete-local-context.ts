import { canonicalizeRequestPath } from './expr-assist-v2/catalog'
import type { EditableContractParam } from './contract-params'
import { extractPathParamNames } from './path-template'

const REQUEST_ROOTS = [
  'request.method',
  'request.path',
  'request.params',
  'request.params.path',
  'request.params.query',
  'request.params.headers',
  'request.params.body',
]

interface LocalRequestPathsInput {
  endpointPath: string
  editableParams: EditableContractParam[]
  requestFieldTypeMap: Record<string, string>
}

export function buildLocalRequestPaths(input: LocalRequestPathsInput): string[] {
  const paths = new Set<string>(REQUEST_ROOTS)

  extractPathParamNames(input.endpointPath).forEach((name) => {
    const normalized = name.trim()
    if (normalized !== '') {
      paths.add(`request.params.path.${normalized}`)
    }
  })

  input.editableParams.forEach((item) => {
    const key = item.key.trim()
    if (key === '') {
      return
    }
    if (item.scope === 'QUERY') {
      paths.add(`request.params.query.${key}`)
      return
    }
    paths.add(`request.params.headers.${key}`)
  })

  Object.keys(input.requestFieldTypeMap).forEach((rawPath) => {
    const canonical = canonicalizeRequestPath(rawPath.trim())
    if (canonical === '') {
      return
    }
    if (
      canonical === 'request.method' ||
      canonical === 'request.path' ||
      canonical.startsWith('request.params.path') ||
      canonical.startsWith('request.params.query') ||
      canonical.startsWith('request.params.headers') ||
      canonical.startsWith('request.params.body')
    ) {
      paths.add(canonical)
    }
  })

  return [...paths].sort((left, right) => left.localeCompare(right))
}
