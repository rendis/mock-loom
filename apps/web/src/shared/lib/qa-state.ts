export type BundleAQAState = 'ready' | 'empty' | 'access-error' | 'no-workspace'
export type BundleBQAState = 'ready' | 'empty' | 'import-error'
export type BundleCQAState = 'contract-ready' | 'scenarios-editing' | 'traffic-streaming' | 'traffic-error'
export type BundleDQAState = 'ready' | 'empty' | 'upload-error'
export type BundleEQAState = 'ready' | 'timeline-details' | 'rollback-confirmation'

const BUNDLE_A_QA_STATES: BundleAQAState[] = ['ready', 'empty', 'access-error', 'no-workspace']
const BUNDLE_B_QA_STATES: BundleBQAState[] = ['ready', 'empty', 'import-error']
const BUNDLE_C_QA_STATES: BundleCQAState[] = ['contract-ready', 'scenarios-editing', 'traffic-streaming', 'traffic-error']
const BUNDLE_D_QA_STATES: BundleDQAState[] = ['ready', 'empty', 'upload-error']
const BUNDLE_E_QA_STATES: BundleEQAState[] = ['ready', 'timeline-details', 'rollback-confirmation']

function isBundleAQAState(value: string): value is BundleAQAState {
  return BUNDLE_A_QA_STATES.includes(value as BundleAQAState)
}

function isBundleBQAState(value: string): value is BundleBQAState {
  return BUNDLE_B_QA_STATES.includes(value as BundleBQAState)
}

function isBundleCQAState(value: string): value is BundleCQAState {
  return BUNDLE_C_QA_STATES.includes(value as BundleCQAState)
}

function isBundleDQAState(value: string): value is BundleDQAState {
  return BUNDLE_D_QA_STATES.includes(value as BundleDQAState)
}

function isBundleEQAState(value: string): value is BundleEQAState {
  return BUNDLE_E_QA_STATES.includes(value as BundleEQAState)
}

function readQAState(searchValue: string | URLSearchParams): string | null {
  const params = typeof searchValue === 'string' ? new URLSearchParams(searchValue) : searchValue
  return params.get('qaState')
}

export function parseBundleAQAState(searchValue: string | URLSearchParams): BundleAQAState | null {
  const value = readQAState(searchValue)
  if (!value) {
    return null
  }
  return isBundleAQAState(value) ? value : null
}

export function parseBundleBQAState(searchValue: string | URLSearchParams): BundleBQAState | null {
  const value = readQAState(searchValue)
  if (!value) {
    return null
  }
  return isBundleBQAState(value) ? value : null
}

export function parseBundleCQAState(searchValue: string | URLSearchParams): BundleCQAState | null {
  const value = readQAState(searchValue)
  if (!value) {
    return null
  }
  return isBundleCQAState(value) ? value : null
}

export function parseBundleDQAState(searchValue: string | URLSearchParams): BundleDQAState | null {
  const value = readQAState(searchValue)
  if (!value) {
    return null
  }
  return isBundleDQAState(value) ? value : null
}

export function parseBundleEQAState(searchValue: string | URLSearchParams): BundleEQAState | null {
  const value = readQAState(searchValue)
  if (!value) {
    return null
  }
  return isBundleEQAState(value) ? value : null
}
