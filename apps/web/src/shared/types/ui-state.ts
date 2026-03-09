export type CollectionState = 'loading' | 'empty' | 'ready' | 'error'

export type OverviewState = 'loading' | 'ready' | 'updating' | 'error'

export type ImportState = 'idle' | 'validating' | 'importing' | 'error' | 'success'

export type ContractState = 'editing' | 'valid' | 'invalid' | 'saving'

export type ScenarioState = 'empty' | 'ready' | 'reordering' | 'saving' | 'error'

export type TrafficState = 'idle' | 'streaming' | 'paused' | 'error'

export type EndpointTab = 'contract' | 'scenarios' | 'traffic'
