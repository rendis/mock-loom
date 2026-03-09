import type { BundleEQAState } from '../../shared/lib/qa-state'
import type { CollectionState } from '../../shared/types/ui-state'

export type BundleEViewState =
  | 'loading'
  | 'ready'
  | 'timeline-details'
  | 'rollback-confirmation'
  | 'empty'
  | 'error'

export interface DeriveBundleEViewStateInput {
  qaState: BundleEQAState | null
  entitiesState: CollectionState
  timelineState: CollectionState
  hasSelectedEntity: boolean
  rollbackConfirmOpen: boolean
  backendBlocked: boolean
  error: string
}

export function deriveBundleEViewState({
  qaState,
  entitiesState,
  timelineState,
  hasSelectedEntity,
  rollbackConfirmOpen,
  backendBlocked,
  error,
}: DeriveBundleEViewStateInput): BundleEViewState {
  if (qaState) {
    return qaState
  }

  if (backendBlocked) {
    return 'error'
  }

  if (rollbackConfirmOpen) {
    return 'rollback-confirmation'
  }

  if (error.trim() !== '' && (entitiesState === 'error' || timelineState === 'error')) {
    return 'error'
  }

  if (entitiesState === 'loading') {
    return 'loading'
  }

  if (entitiesState === 'empty') {
    return 'empty'
  }

  if (hasSelectedEntity && timelineState === 'ready') {
    return 'timeline-details'
  }

  return 'ready'
}
