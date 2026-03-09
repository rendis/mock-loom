import type { BundleAQAState } from '../../shared/lib/qa-state'
import type { CollectionState } from '../../shared/types/ui-state'

export type WorkspaceViewState = 'ready' | 'empty' | 'access-error' | 'no-workspace'

export interface WorkspaceViewStateInput {
  token: string | null
  workspaceState: CollectionState
  selectedWorkspaceId: string
  integrationsState: CollectionState
  membersState: CollectionState
  error: string
  qaState: BundleAQAState | null
}

export function deriveWorkspaceViewState({
  token,
  workspaceState,
  selectedWorkspaceId,
  integrationsState,
  membersState,
  error,
  qaState,
}: WorkspaceViewStateInput): WorkspaceViewState {
  if (qaState) {
    return qaState
  }

  if (!token) {
    return 'access-error'
  }

  if (workspaceState === 'empty' || selectedWorkspaceId.trim() === '') {
    return 'no-workspace'
  }

  if (isAccessError(integrationsState, membersState, error)) {
    return 'access-error'
  }

  if (integrationsState === 'empty') {
    return 'empty'
  }

  return 'ready'
}

function isAccessError(integrationsState: CollectionState, membersState: CollectionState, error: string): boolean {
  const normalizedError = error.trim().toLowerCase()
  if (normalizedError === '') {
    return false
  }

  const hasAccessKeyword =
    normalizedError.includes('forbidden') ||
    normalizedError.includes('access denied') ||
    normalizedError.includes('not invited') ||
    normalizedError.includes('workspace access denied') ||
    normalizedError.includes('integration access denied')

  if (hasAccessKeyword) {
    return true
  }

  return integrationsState === 'error' && membersState === 'error'
}
