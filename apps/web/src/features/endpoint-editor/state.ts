import type { BundleCQAState } from '../../shared/lib/qa-state'
import type { ContractState, EndpointTab, ScenarioState, TrafficState } from '../../shared/types/ui-state'

export type BundleCViewState = 'loading' | 'contract-ready' | 'scenarios-editing' | 'traffic-streaming' | 'traffic-error' | 'error'

export interface DeriveBundleCViewStateInput {
  qaState: BundleCQAState | null
  endpointId: string
  endpointTab: EndpointTab
  contractState: ContractState
  scenarioState: ScenarioState
  trafficState: TrafficState
  error: string
}

export function deriveBundleCViewState({
  qaState,
  endpointId,
  endpointTab,
  contractState,
  scenarioState,
  trafficState,
  error,
}: DeriveBundleCViewStateInput): BundleCViewState {
  if (qaState) {
    return qaState
  }

  if (error.trim() !== '') {
    return 'error'
  }

  if (endpointId.trim() === '') {
    return 'loading'
  }

  if (endpointTab === 'contract') {
    return contractState === 'saving' ? 'loading' : 'contract-ready'
  }

  if (endpointTab === 'scenarios') {
    return scenarioState === 'saving' ? 'loading' : 'scenarios-editing'
  }

  if (trafficState === 'error') {
    return 'traffic-error'
  }

  return 'traffic-streaming'
}
