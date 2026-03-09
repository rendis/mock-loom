export interface AuthConfig {
  dummyAuth: boolean
  panelProvider?: {
    name: string
    issuer: string
    discoveryUrl?: string
    jwksUrl?: string
    authorizationEndpoint?: string
    tokenEndpoint?: string
    userinfoEndpoint?: string
    endSessionEndpoint?: string
    clientId?: string
    audience?: string
    scopes?: string
  }
}

export type SystemRole = 'SUPERADMIN' | 'PLATFORM_ADMIN'

export interface Me {
  id: string
  email: string
  fullName: string
  status: string
  systemRole?: SystemRole
}

export interface Workspace {
  id: string
  name: string
  slug: string
  description: string
  metadataJson: string
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
}

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER'

export type MembershipStatus = 'PENDING' | 'ACTIVE'

export interface WorkspaceMember {
  id: string
  workspaceId: string
  userId: string
  userEmail?: string
  userFullName?: string
  role: WorkspaceRole
  membershipStatus: MembershipStatus
  invitedBy?: string
  joinedAt?: string
  createdAt?: string
}

export interface Integration {
  id: string
  workspaceId: string
  name: string
  slug: string
  baseUrl: string
  authMode: string
  status: string
}

export interface IntegrationOverview {
  integration: Integration
  routeCount: number
  last24hRequests: number
  errorRate: number
}

export interface PackAuthSummary {
  enabled: boolean
  type: string
}

export interface IntegrationPack {
  id: string
  integrationId: string
  name: string
  slug: string
  basePath: string
  status: string
  routeCount: number
  auth: PackAuthSummary
  authPolicy?: {
    mode: AuthMockPolicyMode
    prebuilt: AuthMockPrebuiltPolicy
    customExpr?: string
  }
  createdAt: string
  updatedAt: string
}

export type EndpointAuthMode = 'INHERIT' | 'OVERRIDE' | 'NONE'

export interface IntegrationRoute {
  id: string
  packId: string
  method: string
  path: string
  authMode?: EndpointAuthMode
}

export type DataSourceKind = 'CSV' | 'JSON'
export type CSVDelimiter = 'comma' | 'semicolon' | 'tab' | 'pipe'

export type DataSourceStatus = 'ACTIVE' | 'PENDING' | 'ERROR'

export interface DataSource {
  id: string
  integrationId: string
  name: string
  slug: string
  kind: DataSourceKind
  status: DataSourceStatus
  lastSyncAt?: string
  recordCount: number
  createdAt: string
  updatedAt: string
}

export interface UploadBaselineResponse {
  sourceId: string
  snapshotId: string
  recordCount: number
  status: DataSourceStatus
}

export interface SyncDataSourceResponse {
  sourceId: string
  status: DataSourceStatus
  lastSyncAt: string
  recordCount: number
}

export interface DataSourceSchemaField {
  key: string
  inferredType: string
  effectiveType: string
  overridden: boolean
}

export interface DataSourceSchemaWarning {
  key: string
  expectedType: string
  mismatchCount: number
}

export interface DataSourceSchema {
  sourceId: string
  schemaJson: string
  fields: DataSourceSchemaField[]
  warnings: DataSourceSchemaWarning[]
}

export interface SourceHistoryEvent {
  id: string
  entityId: string
  action: string
  diffPayloadJson: string
  createdAt: string
  triggeredByRequestId?: string
}

export type ImportSourceType = 'OPENAPI' | 'POSTMAN' | 'CURL'

export interface ImportRoutesResult {
  sourceType: ImportSourceType
  createdRoutes: number
  updatedRoutes: number
  skippedRoutes: number
  warnings: string[]
  errors: string[]
}

export interface EndpointEditorPayload {
  id: string
  integrationId: string
  packId: string
  method: string
  path: string
  authMode: EndpointAuthMode
  authOverridePolicyJson: string
  contractJson: string
  scenariosJson: string
  createdAt: string
  updatedAt: string
}

export interface EndpointRouteUpdatePayload {
  method: string
  relativePath: string
}

export interface EndpointRouteUpdateResponse {
  id: string
  packId: string
  method: string
  path: string
  authMode: EndpointAuthMode
}

export interface AutocompleteContext {
  requestPaths: string[]
  sourcePaths: string[]
  functions: string[]
  templatePaths: string[]
}

export interface ValidationIssue {
  code: string
  message: string
  path: string
  severity: string
}

export interface EndpointValidationResponse {
  valid: boolean
  issues: ValidationIssue[]
}

export interface EndpointRevision {
  id: string
  integrationId: string
  endpointId: string
  contractJson: string
  scenariosJson: string
  restoredFromRevisionId?: string
  createdAt: string
}

export interface RestoreEndpointRevisionResponse {
  endpointId: string
  revisionId: string
  restoredAt: string
}

export interface TrafficEvent {
  id: string
  integrationId: string
  endpointId?: string
  requestSummaryJson: string
  matchedScenario?: string
  createdAt: string
}

export interface AuditEvent {
  id: string
  integrationId: string
  resourceType: string
  resourceId: string
  action: string
  actor: string
  summary: string
  createdAt: string
}

export interface EntityMapNode {
  sourceId: string
  sourceName: string
  entityId: string
  updatedAt: string
}

export interface DataDebuggerEntity {
  id: string
  sourceId: string
  entityId: string
  currentDataJson: string
  updatedAt: string
}

export interface EntityTimelineEvent {
  id: string
  entityId: string
  action: string
  diffPayloadJson: string
  createdAt: string
  triggeredByRequestId?: string
}

export interface RollbackEntityResponse {
  entityId: string
  rollbackEventId: string
  restoredAt: string
}

export interface RollbackCompleteResponse {
  sourceId: string
  restoredSnapshotId: string
  restoredAt: string
  upsertedEntities: number
  removedEntities: number
  compensationEvents: number
}

export interface CreateEntityResponse {
  entityId: string
  eventId: string
  createdAt: string
}

export interface PagedResult<T> {
  items: T[]
  nextCursor?: string
  total?: number
}

export interface ScenarioResponse {
  statusCode?: number
  headers?: Record<string, string>
  body?: unknown
  delayMs?: number
}

export type RuntimeMutationType = 'UPSERT' | 'DELETE'

export interface RuntimeMutation {
  type: RuntimeMutationType
  sourceSlug: string
  entityIdExpr: string
  payloadExpr?: string
}

export interface EndpointScenario {
  name?: string
  priority: number
  conditionExpr: string
  response: ScenarioResponse
  mutations?: RuntimeMutation[]
}

export type DataSourcesViewState = 'loading' | 'empty' | 'ready' | 'error'

export type DataSourceUploadState = 'idle' | 'uploading' | 'validating' | 'success' | 'error'

export type AuthMockPolicyMode = 'PREBUILT' | 'CUSTOM_EXPR'

export type AuthMockHeaderOperator = 'EXISTS' | 'EQUALS' | 'CONTAINS'

export interface AuthMockHeaderRule {
  name: string
  operator: AuthMockHeaderOperator
  value?: string
}

export interface AuthMockOIDCConfig {
  issuer?: string
  jwksUrl?: string
  audience?: string
  emailClaim?: string
}

export interface AuthMockPrebuiltPolicy {
  denyAll: boolean
  tokenEquals?: string
  emailEquals?: string
  emailContains?: string
  emailInList?: string[]
  requiredHeaders?: AuthMockHeaderRule[]
  oidc?: AuthMockOIDCConfig
}

export interface AuthMockPolicy {
  integrationId: string
  mode: AuthMockPolicyMode
  prebuilt: AuthMockPrebuiltPolicy
  customExpr?: string
  updatedAt?: string
}
