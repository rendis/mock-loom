import type {
  AuditEvent,
  AuthMockPolicy,
  AuthMockPolicyMode,
  AuthConfig,
  AutocompleteContext,
  CreateEntityResponse,
  CSVDelimiter,
  DataDebuggerEntity,
  DataSource,
  DataSourceSchema,
  DataSourceSchemaField,
  DataSourceSchemaWarning,
  DataSourceKind,
  DataSourceStatus,
  EntityTimelineEvent,
  EntityMapNode,
  EndpointRevision,
  EndpointAuthMode,
  EndpointValidationResponse,
  EndpointEditorPayload,
  EndpointRouteUpdatePayload,
  EndpointRouteUpdateResponse,
  EndpointScenario,
  ImportRoutesResult,
  ImportSourceType,
  Integration,
  IntegrationOverview,
  IntegrationPack,
  IntegrationRoute,
  Me,
  PagedResult,
  RestoreEndpointRevisionResponse,
  RollbackCompleteResponse,
  RollbackEntityResponse,
  SourceHistoryEvent,
  SyncDataSourceResponse,
  TrafficEvent,
  UploadBaselineResponse,
  ValidationIssue,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '../types/api'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api/v1'

type JsonObject = Record<string, unknown>

export class APIError extends Error {
  readonly status: number
  readonly details: string[]

  constructor(message: string, status: number, details: string[] = []) {
    super(message)
    this.name = 'APIError'
    this.status = status
    this.details = details
  }
}

function authHeader(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickString(source: JsonObject, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return value
    }
  }
  return fallback
}

function pickStringOptional(source: JsonObject, keys: string[]): string | undefined {
  const value = pickString(source, keys)
  return value === '' ? undefined : value
}

function pickNumber(source: JsonObject, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
        return parsed
      }
    }
  }
  return fallback
}

function pickArray(source: JsonObject, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = source[key]
    if (Array.isArray(value)) {
      return value
    }
  }
  return []
}

function pickObject(source: JsonObject, keys: string[]): JsonObject | null {
  for (const key of keys) {
    const value = source[key]
    if (isObject(value)) {
      return value
    }
  }
  return null
}

function requireObject(payload: unknown, label: string): JsonObject {
  if (!isObject(payload)) {
    throw new Error(`${label} payload is not a JSON object`)
  }
  return payload
}

async function parseJSON(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') {
    return null
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function ensureOK(response: Response, fallbackMessage: string): Promise<unknown> {
  const payload = await parseJSON(response)
  if (response.ok) {
    return payload
  }

  const body = isObject(payload) ? payload : {}
  const message = pickString(body, ['error', 'message'], `${fallbackMessage}: ${response.status}`)
  const details = pickArray(body, ['details']).filter((item): item is string => typeof item === 'string')
  throw new APIError(message, response.status, details)
}

function buildQueryString(query: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue
    }
    const raw = String(value).trim()
    if (raw === '') {
      continue
    }
    params.set(key, raw)
  }
  const serialized = params.toString()
  return serialized === '' ? '' : `?${serialized}`
}

function normalizeWorkspace(rawValue: unknown): Workspace {
  const raw = requireObject(rawValue, 'workspace')
  return {
    id: pickString(raw, ['id', 'ID']),
    name: pickString(raw, ['name', 'Name']),
    slug: pickString(raw, ['slug', 'Slug']),
    description: pickString(raw, ['description', 'Description']),
    metadataJson: pickString(raw, ['metadata_json', 'metadataJson', 'MetadataJSON'], '{}'),
    status: (pickString(raw, ['status', 'Status'], 'ACTIVE') as Workspace['status']),
    createdAt: pickString(raw, ['created_at', 'createdAt', 'CreatedAt'], ''),
    updatedAt: pickString(raw, ['updated_at', 'updatedAt', 'UpdatedAt'], ''),
  }
}

function normalizeAutocompleteContext(rawValue: unknown): AutocompleteContext {
  const raw = requireObject(rawValue, 'autocomplete context')
  const requestPaths = pickArray(raw, ['requestPaths', 'request_paths', 'RequestPaths']).filter(
    (item): item is string => typeof item === 'string'
  )
  const sourcePaths = pickArray(raw, ['sourcePaths', 'source_paths', 'SourcePaths']).filter(
    (item): item is string => typeof item === 'string'
  )
  const functions = pickArray(raw, ['functions', 'Functions']).filter(
    (item): item is string => typeof item === 'string'
  )
  const templatePaths = pickArray(raw, ['templatePaths', 'template_paths', 'TemplatePaths']).filter(
    (item): item is string => typeof item === 'string'
  )

  return {
    requestPaths,
    sourcePaths,
    functions,
    templatePaths,
  }
}

function normalizeWorkspaceMember(rawValue: unknown): WorkspaceMember {
  const raw = requireObject(rawValue, 'workspace member')
  return {
    id: pickString(raw, ['id', 'ID']),
    workspaceId: pickString(raw, ['workspace_id', 'workspaceId', 'WorkspaceID']),
    userId: pickString(raw, ['user_id', 'userId', 'UserID']),
    userEmail: pickStringOptional(raw, ['user_email', 'userEmail', 'UserEmail']),
    userFullName: pickStringOptional(raw, ['user_full_name', 'userFullName', 'UserFullName']),
    role: (pickString(raw, ['role', 'Role'], 'VIEWER') as WorkspaceRole),
    membershipStatus: (pickString(raw, ['membership_status', 'membershipStatus', 'MembershipStatus'], 'PENDING') as WorkspaceMember['membershipStatus']),
    invitedBy: pickStringOptional(raw, ['invited_by', 'invitedBy', 'InvitedBy']),
    joinedAt: pickStringOptional(raw, ['joined_at', 'joinedAt', 'JoinedAt']),
    createdAt: pickStringOptional(raw, ['created_at', 'createdAt', 'CreatedAt']),
  }
}

function normalizeIntegration(rawValue: unknown): Integration {
  const raw = requireObject(rawValue, 'integration')
  return {
    id: pickString(raw, ['id', 'ID']),
    workspaceId: pickString(raw, ['workspace_id', 'workspaceId', 'WorkspaceID']),
    name: pickString(raw, ['name', 'Name']),
    slug: pickString(raw, ['slug', 'Slug']),
    baseUrl: pickString(raw, ['base_url', 'baseUrl', 'BaseURL']),
    authMode: pickString(raw, ['auth_mode', 'authMode', 'AuthMode'], 'NONE'),
    status: pickString(raw, ['status', 'Status'], 'ACTIVE'),
  }
}

function normalizePack(rawValue: unknown): IntegrationPack {
  const raw = requireObject(rawValue, 'integration pack')
  const rawPolicy = pickObject(raw, ['authPolicy', 'auth_policy'])
  const rawPolicyPrebuilt = rawPolicy ? pickObject(rawPolicy, ['prebuilt']) : null
  const rawPolicyOidc = rawPolicyPrebuilt ? pickObject(rawPolicyPrebuilt, ['oidc']) : null
  const prebuilt: AuthMockPolicy['prebuilt'] = {
    denyAll: Boolean(rawPolicyPrebuilt?.denyAll ?? rawPolicyPrebuilt?.deny_all),
    tokenEquals: rawPolicyPrebuilt ? pickStringOptional(rawPolicyPrebuilt, ['tokenEquals', 'token_equals']) : undefined,
    emailEquals: rawPolicyPrebuilt ? pickStringOptional(rawPolicyPrebuilt, ['emailEquals', 'email_equals']) : undefined,
    emailContains: rawPolicyPrebuilt ? pickStringOptional(rawPolicyPrebuilt, ['emailContains', 'email_contains']) : undefined,
    emailInList: rawPolicyPrebuilt
      ? pickArray(rawPolicyPrebuilt, ['emailInList', 'email_in_list']).filter((item): item is string => typeof item === 'string')
      : [],
    requiredHeaders: rawPolicyPrebuilt
      ? pickArray(rawPolicyPrebuilt, ['requiredHeaders', 'required_headers']).flatMap((item) => {
          if (!isObject(item)) {
            return []
          }
          const name = pickString(item, ['name'])
          if (name === '') {
            return []
          }
          return [
            {
              name,
              operator: pickString(item, ['operator'], 'EXISTS') as 'EXISTS' | 'EQUALS' | 'CONTAINS',
              value: pickStringOptional(item, ['value']),
            },
          ]
        })
      : [],
    oidc: {
      issuer: rawPolicyOidc ? pickStringOptional(rawPolicyOidc, ['issuer']) : undefined,
      jwksUrl: rawPolicyOidc ? pickStringOptional(rawPolicyOidc, ['jwksUrl', 'jwks_url']) : undefined,
      audience: rawPolicyOidc ? pickStringOptional(rawPolicyOidc, ['audience']) : undefined,
      emailClaim: rawPolicyOidc ? pickStringOptional(rawPolicyOidc, ['emailClaim', 'email_claim']) : undefined,
    },
  }
  const authPolicy =
    rawPolicy && typeof rawPolicy.mode === 'string'
      ? {
          mode: pickString(rawPolicy, ['mode'], 'PREBUILT') as AuthMockPolicyMode,
          prebuilt,
          customExpr: pickStringOptional(rawPolicy, ['customExpr', 'custom_expr']),
        }
      : undefined
  return {
    id: pickString(raw, ['id', 'ID']),
    integrationId: pickString(raw, ['integration_id', 'integrationId', 'IntegrationID']),
    name: pickString(raw, ['name', 'Name']),
    slug: pickString(raw, ['slug', 'Slug']),
    basePath: pickString(raw, ['base_path', 'basePath', 'BasePath'], '/'),
    status: pickString(raw, ['status', 'Status'], 'ACTIVE'),
    routeCount: pickNumber(raw, ['routeCount', 'route_count']),
    auth: {
      enabled: Boolean(raw.authEnabled ?? raw.auth_enabled ?? false),
      type: pickString(raw, ['authType', 'auth_type'], 'PREBUILT'),
    },
    authPolicy,
    createdAt: pickString(raw, ['created_at', 'createdAt', 'CreatedAt']),
    updatedAt: pickString(raw, ['updated_at', 'updatedAt', 'UpdatedAt']),
  }
}

function normalizeRoute(rawValue: unknown): IntegrationRoute {
  const raw = requireObject(rawValue, 'route')
  return {
    id: pickString(raw, ['id', 'ID']),
    packId: pickString(raw, ['pack_id', 'packId', 'PackID']),
    method: pickString(raw, ['method', 'Method']).toUpperCase(),
    path: pickString(raw, ['path', 'Path']),
    authMode: pickString(raw, ['auth_mode', 'authMode', 'AuthMode'], 'INHERIT') as EndpointAuthMode,
  }
}

function normalizeDataSource(rawValue: unknown): DataSource {
  const raw = requireObject(rawValue, 'data source')
  return {
    id: pickString(raw, ['id', 'ID']),
    integrationId: pickString(raw, ['integration_id', 'integrationId', 'IntegrationID']),
    name: pickString(raw, ['name', 'Name']),
    slug: pickString(raw, ['slug', 'Slug']),
    kind: pickString(raw, ['kind', 'Kind'], 'JSON') as DataSourceKind,
    status: pickString(raw, ['status', 'Status'], 'PENDING') as DataSourceStatus,
    lastSyncAt: pickStringOptional(raw, ['last_sync_at', 'lastSyncAt', 'LastSyncAt']),
    recordCount: pickNumber(raw, ['record_count', 'recordCount', 'RecordCount']),
    createdAt: pickString(raw, ['created_at', 'createdAt', 'CreatedAt']),
    updatedAt: pickString(raw, ['updated_at', 'updatedAt', 'UpdatedAt']),
  }
}

function normalizeDataSourceSchemaField(rawValue: unknown): DataSourceSchemaField {
  const raw = requireObject(rawValue, 'data source schema field')
  const overriddenRaw = raw.overridden ?? raw.is_overridden ?? raw.isOverridden
  const overridden =
    typeof overriddenRaw === 'boolean'
      ? overriddenRaw
      : typeof overriddenRaw === 'string'
        ? overriddenRaw.toLowerCase() === 'true'
        : false
  return {
    key: pickString(raw, ['key', 'Key']),
    inferredType: pickString(raw, ['inferredType', 'inferred_type', 'InferredType'], 'string'),
    effectiveType: pickString(raw, ['effectiveType', 'effective_type', 'EffectiveType'], 'string'),
    overridden,
  }
}

function normalizeDataSourceSchemaWarning(rawValue: unknown): DataSourceSchemaWarning {
  const raw = requireObject(rawValue, 'data source schema warning')
  return {
    key: pickString(raw, ['key', 'Key']),
    expectedType: pickString(raw, ['expectedType', 'expected_type', 'ExpectedType'], 'string'),
    mismatchCount: pickNumber(raw, ['mismatchCount', 'mismatch_count', 'MismatchCount']),
  }
}

function normalizeEndpoint(rawValue: unknown): EndpointEditorPayload {
  const raw = requireObject(rawValue, 'endpoint')
  return {
    id: pickString(raw, ['id', 'ID']),
    integrationId: pickString(raw, ['integration_id', 'integrationId', 'IntegrationID']),
    packId: pickString(raw, ['pack_id', 'packId', 'PackID']),
    method: pickString(raw, ['method', 'Method']).toUpperCase(),
    path: pickString(raw, ['path', 'Path']),
    authMode: pickString(raw, ['auth_mode', 'authMode', 'AuthMode'], 'INHERIT') as EndpointAuthMode,
    authOverridePolicyJson: pickString(raw, ['auth_override_policy_json', 'authOverridePolicyJson', 'AuthOverridePolicyJSON'], '{}'),
    contractJson: pickString(raw, ['contract_json', 'contractJson', 'ContractJSON'], '{}'),
    scenariosJson: pickString(raw, ['scenarios_json', 'scenariosJson', 'ScenariosJSON'], '[]'),
    createdAt: pickString(raw, ['created_at', 'createdAt', 'CreatedAt']),
    updatedAt: pickString(raw, ['updated_at', 'updatedAt', 'UpdatedAt']),
  }
}

function normalizeTraffic(rawValue: unknown): TrafficEvent {
  const raw = requireObject(rawValue, 'traffic event')
  return {
    id: pickString(raw, ['id', 'ID']),
    integrationId: pickString(raw, ['integration_id', 'integrationId', 'IntegrationID']),
    endpointId: pickStringOptional(raw, ['endpoint_id', 'endpointId', 'EndpointID']),
    requestSummaryJson: pickString(raw, ['request_summary_json', 'requestSummaryJson', 'RequestSummaryJSON'], '{}'),
    matchedScenario: pickStringOptional(raw, ['matched_scenario', 'matchedScenario', 'MatchedScenario']),
    createdAt: pickString(raw, ['created_at', 'createdAt', 'CreatedAt']),
  }
}

function normalizeEntity(rawValue: unknown): DataDebuggerEntity {
  const raw = requireObject(rawValue, 'debugger entity')
  return {
    id: pickString(raw, ['id', 'ID']),
    sourceId: pickString(raw, ['source_id', 'sourceId', 'SourceID']),
    entityId: pickString(raw, ['entity_id', 'entityId', 'EntityID']),
    currentDataJson: pickString(raw, ['current_data_json', 'currentDataJson', 'CurrentDataJSON'], '{}'),
    updatedAt: pickString(raw, ['updated_at', 'updatedAt', 'UpdatedAt']),
  }
}

function normalizeEntityTimeline(rawValue: unknown): EntityTimelineEvent {
  const raw = requireObject(rawValue, 'timeline event')
  return {
    id: pickString(raw, ['id', 'ID']),
    entityId: pickString(raw, ['entity_id', 'entityId', 'EntityID']),
    action: pickString(raw, ['action', 'Action'], 'UPDATE'),
    diffPayloadJson: pickString(raw, ['diff_payload_json', 'diffPayloadJson', 'DiffPayloadJSON'], '{}'),
    createdAt: pickString(raw, ['created_at', 'createdAt', 'CreatedAt']),
    triggeredByRequestId: pickStringOptional(raw, ['triggered_by_request_id', 'triggeredByRequestId', 'TriggeredByRequestID']),
  }
}

function normalizeSourceHistoryEvent(rawValue: unknown): SourceHistoryEvent {
  const raw = requireObject(rawValue, 'source history event')
  return {
    id: pickString(raw, ['id', 'ID']),
    entityId: pickString(raw, ['entity_id', 'entityId', 'EntityID']),
    action: pickString(raw, ['action', 'Action'], 'UPDATE'),
    diffPayloadJson: pickString(raw, ['diff_payload_json', 'diffPayloadJson', 'DiffPayloadJSON'], '{}'),
    createdAt: pickString(raw, ['created_at', 'createdAt', 'CreatedAt']),
    triggeredByRequestId: pickStringOptional(raw, ['triggered_by_request_id', 'triggeredByRequestId', 'TriggeredByRequestID']),
  }
}

function normalizeValidationIssue(rawValue: unknown): ValidationIssue {
  const raw = requireObject(rawValue, 'validation issue')
  return {
    code: pickString(raw, ['code', 'Code'], 'VALIDATION'),
    message: pickString(raw, ['message', 'Message'], 'Validation failed'),
    path: pickString(raw, ['path', 'Path'], ''),
    severity: pickString(raw, ['severity', 'Severity'], 'error'),
  }
}

function normalizeEndpointRevision(rawValue: unknown): EndpointRevision {
  const raw = requireObject(rawValue, 'endpoint revision')
  return {
    id: pickString(raw, ['id', 'ID']),
    integrationId: pickString(raw, ['integration_id', 'integrationId', 'IntegrationID']),
    endpointId: pickString(raw, ['endpoint_id', 'endpointId', 'EndpointID']),
    contractJson: pickString(raw, ['contract_json', 'contractJson', 'ContractJSON'], '{}'),
    scenariosJson: pickString(raw, ['scenarios_json', 'scenariosJson', 'ScenariosJSON'], '[]'),
    restoredFromRevisionId: pickStringOptional(raw, ['restored_from_revision_id', 'restoredFromRevisionId', 'RestoredFromRevisionID']),
    createdAt: pickString(raw, ['created_at', 'createdAt', 'CreatedAt']),
  }
}

function normalizeAuditEvent(rawValue: unknown): AuditEvent {
  const raw = requireObject(rawValue, 'audit event')
  return {
    id: pickString(raw, ['id', 'ID']),
    integrationId: pickString(raw, ['integration_id', 'integrationId', 'IntegrationID']),
    resourceType: pickString(raw, ['resource_type', 'resourceType', 'ResourceType']),
    resourceId: pickString(raw, ['resource_id', 'resourceId', 'ResourceID']),
    action: pickString(raw, ['action', 'Action']),
    actor: pickString(raw, ['actor', 'Actor'], 'runtime'),
    summary: pickString(raw, ['summary', 'Summary']),
    createdAt: pickString(raw, ['created_at', 'createdAt', 'CreatedAt']),
  }
}

function normalizeEntityMapNode(rawValue: unknown): EntityMapNode {
  const raw = requireObject(rawValue, 'entity map node')
  return {
    sourceId: pickString(raw, ['source_id', 'sourceId', 'SourceID']),
    sourceName: pickString(raw, ['source_name', 'sourceName', 'SourceName']),
    entityId: pickString(raw, ['entity_id', 'entityId', 'EntityID']),
    updatedAt: pickString(raw, ['updated_at', 'updatedAt', 'UpdatedAt']),
  }
}

function normalizeAuthConfig(rawValue: unknown): AuthConfig {
  const raw = requireObject(rawValue, 'auth config')
  const panelProviderRaw = isObject(raw.panelProvider)
    ? raw.panelProvider
    : isObject(raw.panel_provider)
      ? raw.panel_provider
      : undefined
  const panelProvider = panelProviderRaw
    ? {
        name: pickString(panelProviderRaw, ['name']),
        issuer: pickString(panelProviderRaw, ['issuer']),
        discoveryUrl: pickStringOptional(panelProviderRaw, ['discoveryUrl', 'discovery_url']),
        jwksUrl: pickStringOptional(panelProviderRaw, ['jwksUrl', 'jwks_url']),
        authorizationEndpoint: pickStringOptional(panelProviderRaw, ['authorizationEndpoint', 'authorization_endpoint']),
        tokenEndpoint: pickStringOptional(panelProviderRaw, ['tokenEndpoint', 'token_endpoint']),
        userinfoEndpoint: pickStringOptional(panelProviderRaw, ['userinfoEndpoint', 'userinfo_endpoint']),
        endSessionEndpoint: pickStringOptional(panelProviderRaw, ['endSessionEndpoint', 'end_session_endpoint']),
        clientId: pickStringOptional(panelProviderRaw, ['clientId', 'client_id']),
        audience: pickStringOptional(panelProviderRaw, ['audience']),
        scopes: pickStringOptional(panelProviderRaw, ['scopes']),
      }
    : undefined

  return {
    dummyAuth: Boolean(raw.dummyAuth ?? raw.dummy_auth),
    panelProvider,
  }
}

function normalizeAuthMockPolicy(rawValue: unknown): AuthMockPolicy {
  const raw = requireObject(rawValue, 'auth mock policy')
  const prebuiltRaw = isObject(raw.prebuilt) ? raw.prebuilt : {}
  const requiredHeaders = pickArray(prebuiltRaw, ['requiredHeaders', 'required_headers']).flatMap((item) => {
    if (!isObject(item)) {
      return []
    }
    const name = pickString(item, ['name'])
    const operator = pickString(item, ['operator'], 'EXISTS')
    if (name === '') {
      return []
    }
    return [
      {
        name,
        operator: operator as 'EXISTS' | 'EQUALS' | 'CONTAINS',
        value: pickStringOptional(item, ['value']),
      },
    ]
  })
  const oidcRaw = isObject(prebuiltRaw.oidc) ? prebuiltRaw.oidc : {}

  return {
    integrationId: pickString(raw, ['integrationId', 'integration_id']),
    mode: (pickString(raw, ['mode'], 'PREBUILT') as AuthMockPolicyMode),
    prebuilt: {
      denyAll: Boolean(prebuiltRaw.denyAll ?? prebuiltRaw.deny_all),
      tokenEquals: pickStringOptional(prebuiltRaw, ['tokenEquals', 'token_equals']),
      emailEquals: pickStringOptional(prebuiltRaw, ['emailEquals', 'email_equals']),
      emailContains: pickStringOptional(prebuiltRaw, ['emailContains', 'email_contains']),
      emailInList: pickArray(prebuiltRaw, ['emailInList', 'email_in_list']).filter(
        (item): item is string => typeof item === 'string'
      ),
      requiredHeaders,
      oidc: {
        issuer: pickStringOptional(oidcRaw, ['issuer']),
        jwksUrl: pickStringOptional(oidcRaw, ['jwksUrl', 'jwks_url']),
        audience: pickStringOptional(oidcRaw, ['audience']),
        emailClaim: pickStringOptional(oidcRaw, ['emailClaim', 'email_claim']),
      },
    },
    customExpr: pickStringOptional(raw, ['customExpr', 'custom_expr']),
    updatedAt: pickStringOptional(raw, ['updatedAt', 'updated_at']),
  }
}

export function formatAPIError(error: unknown): string {
  if (error instanceof APIError) {
    if (error.details.length > 0) {
      return `${error.message} (${error.details.join('; ')})`
    }
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'unexpected error'
}

export async function getAuthConfig(): Promise<AuthConfig> {
  const response = await fetch(`${API_BASE}/auth/config`, { cache: 'no-store' })
  const payload = await ensureOK(response, 'auth config failed')
  return normalizeAuthConfig(payload)
}

export async function exchangeCode(
  tokenEndpoint: string,
  code: string,
  redirectUri: string,
  clientId: string,
  codeVerifier: string
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  })

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const payload = await ensureOK(response, 'token exchange failed')
  const tokenBody = requireObject(payload, 'token exchange')
  return {
    access_token: pickString(tokenBody, ['access_token']),
    refresh_token: pickStringOptional(tokenBody, ['refresh_token']),
    expires_in: pickNumber(tokenBody, ['expires_in'], 0) || undefined,
  }
}

export async function getMe(token: string): Promise<Me> {
  const response = await fetch(`${API_BASE}/auth/me`, { headers: authHeader(token) })
  const payload = await ensureOK(response, 'auth me failed')
  const raw = requireObject(payload, 'auth me')
  return {
    id: pickString(raw, ['id', 'ID']),
    email: pickString(raw, ['email', 'Email']),
    fullName: pickString(raw, ['fullName', 'full_name', 'FullName']),
    status: pickString(raw, ['status', 'Status']),
    systemRole: pickStringOptional(raw, ['systemRole', 'system_role']) as Me['systemRole'],
  }
}

export async function getWorkspaces(token: string): Promise<Workspace[]> {
  const response = await fetch(`${API_BASE}/workspaces`, { headers: authHeader(token) })
  const payload = await ensureOK(response, 'workspaces failed')
  const body = requireObject(payload, 'workspaces')
  return pickArray(body, ['items']).map((item) => normalizeWorkspace(item))
}

export async function createWorkspace(
  token: string,
  payload: { name: string; slug: string; description?: string; metadata?: string }
): Promise<Workspace> {
  const response = await fetch(`${API_BASE}/workspaces`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await ensureOK(response, 'create workspace failed')
  return normalizeWorkspace(body)
}

export async function updateWorkspace(
  token: string,
  workspaceId: string,
  payload: { name?: string; slug?: string; description?: string; metadata?: string }
): Promise<Workspace> {
  const response = await fetch(`${API_BASE}/workspaces/${workspaceId}`, {
    method: 'PATCH',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await ensureOK(response, 'update workspace failed')
  return normalizeWorkspace(body)
}

export async function archiveWorkspace(token: string, workspaceId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/workspaces/${workspaceId}`, {
    method: 'DELETE',
    headers: authHeader(token),
  })
  await ensureOK(response, 'archive workspace failed')
}

export async function getWorkspaceMembers(token: string, workspaceId: string): Promise<WorkspaceMember[]> {
  const response = await fetch(`${API_BASE}/workspaces/${workspaceId}/members`, { headers: authHeader(token) })
  const payload = await ensureOK(response, 'members failed')
  const body = requireObject(payload, 'members')
  return pickArray(body, ['items']).map((item) => normalizeWorkspaceMember(item))
}

export async function inviteMember(
  token: string,
  workspaceId: string,
  email: string,
  role: Exclude<WorkspaceRole, 'OWNER'>
): Promise<void> {
  const response = await fetch(`${API_BASE}/workspaces/${workspaceId}/members/invitations`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  })
  await ensureOK(response, 'invite failed')
}

export async function updateWorkspaceMemberRole(
  token: string,
  workspaceId: string,
  memberId: string,
  role: Exclude<WorkspaceRole, 'OWNER'>
): Promise<void> {
  const response = await fetch(`${API_BASE}/workspaces/${workspaceId}/members/${memberId}/role`, {
    method: 'PATCH',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  })
  await ensureOK(response, 'update member role failed')
}

export async function updateWorkspaceMemberStatus(
  token: string,
  workspaceId: string,
  memberId: string,
  status: WorkspaceMember['membershipStatus']
): Promise<void> {
  const response = await fetch(`${API_BASE}/workspaces/${workspaceId}/members/${memberId}/status`, {
    method: 'PATCH',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  await ensureOK(response, 'update member status failed')
}

export async function getIntegrations(token: string, workspaceId: string): Promise<Integration[]> {
  const response = await fetch(`${API_BASE}/workspaces/${workspaceId}/integrations`, { headers: authHeader(token) })
  const payload = await ensureOK(response, 'integrations failed')
  const body = requireObject(payload, 'integrations')
  return pickArray(body, ['items']).map((item) => normalizeIntegration(item))
}

export async function createIntegration(
  token: string,
  workspaceId: string,
  payload: { name: string; slug: string; baseUrl: string }
): Promise<Integration> {
  const response = await fetch(`${API_BASE}/workspaces/${workspaceId}/integrations`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await ensureOK(response, 'create integration failed')
  return normalizeIntegration(body)
}

export async function getIntegrationOverview(token: string, integrationId: string): Promise<IntegrationOverview> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/overview`, { headers: authHeader(token) })
  const payload = await ensureOK(response, 'integration overview failed')
  const body = requireObject(payload, 'integration overview')
  return {
    integration: normalizeIntegration(body.integration),
    routeCount: pickNumber(body, ['routeCount', 'route_count']),
    last24hRequests: pickNumber(body, ['last24hRequests', 'last_24h_requests']),
    errorRate: pickNumber(body, ['errorRate', 'error_rate']),
  }
}

export async function updateIntegrationAuth(token: string, integrationId: string, authMode: string): Promise<void> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/auth`, {
    method: 'PATCH',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ authMode }),
  })
  await ensureOK(response, 'update auth mode failed')
}

export async function getIntegrationAuthMockPolicy(token: string, integrationId: string): Promise<AuthMockPolicy> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/auth-mock`, {
    headers: authHeader(token),
  })
  const payload = await ensureOK(response, 'auth-mock policy failed')
  return normalizeAuthMockPolicy(payload)
}

export async function updateIntegrationAuthMockPolicy(
  token: string,
  integrationId: string,
  payload: {
    mode: AuthMockPolicyMode
    prebuilt: AuthMockPolicy['prebuilt']
    customExpr?: string
  }
): Promise<AuthMockPolicy> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/auth-mock`, {
    method: 'PUT',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await ensureOK(response, 'update auth-mock policy failed')
  return normalizeAuthMockPolicy(body)
}

export async function getIntegrationPacks(token: string, integrationId: string): Promise<IntegrationPack[]> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/packs`, { headers: authHeader(token) })
  const payload = await ensureOK(response, 'packs failed')
  const body = requireObject(payload, 'packs')
  return pickArray(body, ['items']).map((item) => normalizePack(item))
}

export async function createIntegrationPack(
  token: string,
  integrationId: string,
  payload: { name: string; slug: string; basePath: string }
): Promise<IntegrationPack> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/packs`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await ensureOK(response, 'create pack failed')
  return normalizePack(body)
}

export async function updateIntegrationPack(
  token: string,
  integrationId: string,
  packId: string,
  payload: {
    name?: string
    slug?: string
    basePath?: string
    status?: string
    authEnabled?: boolean
    authPolicy?: {
      mode: AuthMockPolicyMode
      prebuilt: AuthMockPolicy['prebuilt']
      customExpr?: string
    }
  }
): Promise<IntegrationPack> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/packs/${packId}`, {
    method: 'PATCH',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await ensureOK(response, 'update pack failed')
  return normalizePack(body)
}

async function resolveDefaultPackId(token: string, integrationId: string): Promise<string> {
  const packs = await getIntegrationPacks(token, integrationId)
  if (packs.length > 0 && packs[0]) {
    return packs[0].id
  }

  const created = await createIntegrationPack(token, integrationId, {
    name: 'Default Pack',
    slug: 'default-pack',
    basePath: '/',
  })
  return created.id
}

export async function getPackRoutes(token: string, integrationId: string, packId: string): Promise<IntegrationRoute[]> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/packs/${packId}/routes`, { headers: authHeader(token) })
  const payload = await ensureOK(response, 'pack routes failed')
  const body = requireObject(payload, 'pack routes')
  return pickArray(body, ['items']).map((item) => normalizeRoute(item))
}

export async function getIntegrationRoutes(token: string, integrationId: string): Promise<IntegrationRoute[]> {
  const packs = await getIntegrationPacks(token, integrationId)
  const merged = await Promise.all(packs.map((pack) => getPackRoutes(token, integrationId, pack.id)))
  return merged.flat()
}

export async function getDataSources(token: string, integrationId: string): Promise<DataSource[]> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/data-sources`, { headers: authHeader(token) })
  const payload = await ensureOK(response, 'data sources failed')
  const body = requireObject(payload, 'data sources')
  return pickArray(body, ['items']).map((item) => normalizeDataSource(item))
}

export async function createDataSource(
  token: string,
  integrationId: string,
  payload: { name: string; slug: string; kind: DataSourceKind }
): Promise<DataSource> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/data-sources`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await ensureOK(response, 'create data source failed')
  return normalizeDataSource(body)
}

export async function updateDataSource(
  token: string,
  integrationId: string,
  sourceId: string,
  payload: { name: string; slug: string }
): Promise<DataSource> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/data-sources/${sourceId}`, {
    method: 'PATCH',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await ensureOK(response, 'update data source failed')
  return normalizeDataSource(body)
}

export async function deleteDataSource(token: string, integrationId: string, sourceId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/data-sources/${sourceId}`, {
    method: 'DELETE',
    headers: authHeader(token),
  })
  await ensureOK(response, 'delete data source failed')
}

export async function uploadDataSourceBaseline(
  token: string,
  integrationId: string,
  sourceId: string,
  file: File,
  options?: { csvDelimiter?: CSVDelimiter }
): Promise<UploadBaselineResponse> {
  const form = new FormData()
  form.set('file', file)
  if (options?.csvDelimiter) {
    form.set('csvDelimiter', options.csvDelimiter)
  }

  const response = await fetch(`${API_BASE}/integrations/${integrationId}/data-sources/${sourceId}/baseline`, {
    method: 'POST',
    headers: authHeader(token),
    body: form,
  })
  const body = requireObject(await ensureOK(response, 'upload data source baseline failed'), 'upload baseline')
  return {
    sourceId: pickString(body, ['sourceId', 'source_id']),
    snapshotId: pickString(body, ['snapshotId', 'snapshot_id']),
    recordCount: pickNumber(body, ['recordCount', 'record_count']),
    status: pickString(body, ['status'], 'ACTIVE') as DataSourceStatus,
  }
}

export async function syncDataSource(
  token: string,
  integrationId: string,
  sourceId: string
): Promise<SyncDataSourceResponse> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/data-sources/${sourceId}/sync`, {
    method: 'POST',
    headers: authHeader(token),
  })
  const payload = requireObject(await ensureOK(response, 'sync data source failed'), 'sync data source')
  return {
    sourceId: pickString(payload, ['sourceId', 'source_id']),
    status: pickString(payload, ['status'], 'ACTIVE') as DataSourceStatus,
    lastSyncAt: pickString(payload, ['lastSyncAt', 'last_sync_at']),
    recordCount: pickNumber(payload, ['recordCount', 'record_count']),
  }
}

export async function getDataSourceSchema(
  token: string,
  integrationId: string,
  sourceId: string
): Promise<DataSourceSchema> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/data-sources/${sourceId}/schema`, {
    headers: authHeader(token),
  })
  const payload = requireObject(await ensureOK(response, 'data source schema failed'), 'data source schema')
  return {
    sourceId: pickString(payload, ['sourceId', 'source_id']),
    schemaJson: pickString(payload, ['schemaJson', 'schema_json']),
    fields: pickArray(payload, ['fields']).map((item) => normalizeDataSourceSchemaField(item)),
    warnings: pickArray(payload, ['warnings']).map((item) => normalizeDataSourceSchemaWarning(item)),
  }
}

export async function updateDataSourceSchema(
  token: string,
  integrationId: string,
  sourceId: string,
  payload: { fields: Array<{ key: string; type: string }> }
): Promise<DataSourceSchema> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/data-sources/${sourceId}/schema`, {
    method: 'PUT',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = requireObject(await ensureOK(response, 'update data source schema failed'), 'update data source schema')
  return {
    sourceId: pickString(body, ['sourceId', 'source_id']),
    schemaJson: pickString(body, ['schemaJson', 'schema_json']),
    fields: pickArray(body, ['fields']).map((item) => normalizeDataSourceSchemaField(item)),
    warnings: pickArray(body, ['warnings']).map((item) => normalizeDataSourceSchemaWarning(item)),
  }
}

export async function getDataSourceHistory(
  token: string,
  integrationId: string,
  sourceId: string,
  query?: { limit?: number; cursor?: string }
): Promise<PagedResult<SourceHistoryEvent>> {
  const search = buildQueryString({
    limit: query?.limit,
    cursor: query?.cursor,
  })
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/data-sources/${sourceId}/history${search}`, {
    headers: authHeader(token),
  })
  const payload = requireObject(await ensureOK(response, 'data source history failed'), 'data source history')
  return {
    items: pickArray(payload, ['items']).map((item) => normalizeSourceHistoryEvent(item)),
    nextCursor: pickStringOptional(payload, ['nextCursor', 'next_cursor']),
  }
}

export async function importIntegrationRoutes(
  token: string,
  integrationId: string,
  sourceType: ImportSourceType,
  payload: string
): Promise<ImportRoutesResult> {
  const packId = await resolveDefaultPackId(token, integrationId)
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/packs/${packId}/imports`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceType, payload }),
  })
  const body = requireObject(await ensureOK(response, 'import routes failed'), 'import routes')
  return {
    sourceType: pickString(body, ['sourceType', 'source_type'], sourceType) as ImportSourceType,
    createdRoutes: pickNumber(body, ['createdRoutes', 'created_routes']),
    updatedRoutes: pickNumber(body, ['updatedRoutes', 'updated_routes']),
    skippedRoutes: pickNumber(body, ['skippedRoutes', 'skipped_routes']),
    warnings: pickArray(body, ['warnings']).filter((item): item is string => typeof item === 'string'),
    errors: pickArray(body, ['errors']).filter((item): item is string => typeof item === 'string'),
  }
}

export async function importPackRoutes(
  token: string,
  integrationId: string,
  packId: string,
  sourceType: ImportSourceType,
  payload: string
): Promise<ImportRoutesResult> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/packs/${packId}/imports`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceType, payload }),
  })
  const body = requireObject(await ensureOK(response, 'import pack routes failed'), 'import pack routes')
  return {
    sourceType: pickString(body, ['sourceType', 'source_type'], sourceType) as ImportSourceType,
    createdRoutes: pickNumber(body, ['createdRoutes', 'created_routes']),
    updatedRoutes: pickNumber(body, ['updatedRoutes', 'updated_routes']),
    skippedRoutes: pickNumber(body, ['skippedRoutes', 'skipped_routes']),
    warnings: pickArray(body, ['warnings']).filter((item): item is string => typeof item === 'string'),
    errors: pickArray(body, ['errors']).filter((item): item is string => typeof item === 'string'),
  }
}

export async function getEndpoint(
  token: string,
  integrationId: string,
  endpointId: string,
  packId?: string
): Promise<EndpointEditorPayload> {
  const resolvedPackId = packId ?? (await resolveDefaultPackId(token, integrationId))
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/packs/${resolvedPackId}/endpoints/${endpointId}`, {
    headers: authHeader(token),
  })
  const payload = await ensureOK(response, 'endpoint failed')
  return normalizeEndpoint(payload)
}

export async function getEndpointAutocompleteContext(
  token: string,
  integrationId: string,
  endpointId: string,
  packId?: string
): Promise<AutocompleteContext> {
  const resolvedPackId = packId ?? (await resolveDefaultPackId(token, integrationId))
  const response = await fetch(
    `${API_BASE}/integrations/${integrationId}/packs/${resolvedPackId}/endpoints/${endpointId}/autocomplete-context`,
    { headers: authHeader(token) }
  )
  const payload = await ensureOK(response, 'autocomplete context failed')
  return normalizeAutocompleteContext(payload)
}

export async function validateEndpoint(
  token: string,
  integrationId: string,
  endpointId: string,
  payload: { contract?: string; scenarios?: string },
  packId?: string
): Promise<EndpointValidationResponse> {
  const resolvedPackId = packId ?? (await resolveDefaultPackId(token, integrationId))
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/packs/${resolvedPackId}/endpoints/${endpointId}/validate`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = requireObject(await ensureOK(response, 'validate endpoint failed'), 'validate endpoint')
  return {
    valid: Boolean(body.valid),
    issues: pickArray(body, ['issues']).map((item) => normalizeValidationIssue(item)),
  }
}

export async function getEndpointRevisions(
  token: string,
  integrationId: string,
  endpointId: string,
  query?: { limit?: number; cursor?: string },
  packId?: string
): Promise<PagedResult<EndpointRevision>> {
  const resolvedPackId = packId ?? (await resolveDefaultPackId(token, integrationId))
  const search = buildQueryString({
    limit: query?.limit,
    cursor: query?.cursor,
  })
  const response = await fetch(
    `${API_BASE}/integrations/${integrationId}/packs/${resolvedPackId}/endpoints/${endpointId}/revisions${search}`,
    { headers: authHeader(token) }
  )
  const body = requireObject(await ensureOK(response, 'endpoint revisions failed'), 'endpoint revisions')
  return {
    items: pickArray(body, ['items']).map((item) => normalizeEndpointRevision(item)),
    nextCursor: pickStringOptional(body, ['nextCursor', 'next_cursor']),
  }
}

export async function restoreEndpointRevision(
  token: string,
  integrationId: string,
  endpointId: string,
  revisionId: string,
  packId?: string
): Promise<RestoreEndpointRevisionResponse> {
  const resolvedPackId = packId ?? (await resolveDefaultPackId(token, integrationId))
  const response = await fetch(
    `${API_BASE}/integrations/${integrationId}/packs/${resolvedPackId}/endpoints/${endpointId}/revisions/${revisionId}/restore`,
    {
      method: 'POST',
      headers: authHeader(token),
    }
  )
  const body = requireObject(await ensureOK(response, 'restore endpoint revision failed'), 'restore endpoint revision')
  return {
    endpointId: pickString(body, ['endpointId', 'endpoint_id']),
    revisionId: pickString(body, ['revisionId', 'revision_id']),
    restoredAt: pickString(body, ['restoredAt', 'restored_at']),
  }
}

export async function updateEndpointContract(
  token: string,
  integrationId: string,
  endpointId: string,
  contract: string,
  packId?: string
): Promise<void> {
  const resolvedPackId = packId ?? (await resolveDefaultPackId(token, integrationId))
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/packs/${resolvedPackId}/endpoints/${endpointId}/contract`, {
    method: 'PUT',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ contract }),
  })
  await ensureOK(response, 'update contract failed')
}

export async function updateEndpointScenarios(
  token: string,
  integrationId: string,
  endpointId: string,
  scenarios: EndpointScenario[],
  packId?: string
): Promise<void> {
  const resolvedPackId = packId ?? (await resolveDefaultPackId(token, integrationId))
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/packs/${resolvedPackId}/endpoints/${endpointId}/scenarios`, {
    method: 'PUT',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarios: JSON.stringify(scenarios) }),
  })
  await ensureOK(response, 'update scenarios failed')
}

export async function updateEndpointRoute(
  token: string,
  integrationId: string,
  packId: string,
  endpointId: string,
  payload: EndpointRouteUpdatePayload
): Promise<EndpointRouteUpdateResponse> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/packs/${packId}/endpoints/${endpointId}/route`, {
    method: 'PATCH',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = requireObject(await ensureOK(response, 'update endpoint route failed'), 'update endpoint route')
  return {
    id: pickString(body, ['id', 'ID']),
    packId: pickString(body, ['packId', 'pack_id', 'PackID']),
    method: pickString(body, ['method', 'Method']).toUpperCase(),
    path: pickString(body, ['path', 'Path']),
    authMode: pickString(body, ['authMode', 'auth_mode', 'AuthMode'], 'INHERIT') as EndpointAuthMode,
  }
}

export async function updateEndpointAuth(
  token: string,
  integrationId: string,
  packId: string,
  endpointId: string,
  payload: {
    authMode: EndpointAuthMode
    overridePolicy?: {
      mode: AuthMockPolicyMode
      prebuilt: AuthMockPolicy['prebuilt']
      customExpr?: string
    }
  }
): Promise<void> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/packs/${packId}/endpoints/${endpointId}/auth`, {
    method: 'PATCH',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  await ensureOK(response, 'update endpoint auth failed')
}

export async function getEndpointTraffic(
  token: string,
  integrationId: string,
  endpointId: string,
  packId?: string
): Promise<TrafficEvent[]> {
  if (!packId) {
    const packs = await getIntegrationPacks(token, integrationId)
    const batches = await Promise.all(
      packs.map((pack) => {
        const resolvedEndpointId = endpointId.trim() === '' ? 'all' : endpointId
        return fetch(`${API_BASE}/integrations/${integrationId}/packs/${pack.id}/endpoints/${resolvedEndpointId}/traffic`, {
          headers: authHeader(token),
        })
          .then((response) => ensureOK(response, 'traffic failed'))
          .then((payload) => {
            const body = requireObject(payload, 'traffic')
            return pickArray(body, ['items']).map((item) => normalizeTraffic(item))
          })
      })
    )
    return batches.flat().sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  const resolvedEndpointId = endpointId.trim() === '' ? 'all' : endpointId
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/packs/${packId}/endpoints/${resolvedEndpointId}/traffic`, {
    headers: authHeader(token),
  })
  const payload = await ensureOK(response, 'traffic failed')
  const body = requireObject(payload, 'traffic')
  return pickArray(body, ['items']).map((item) => normalizeTraffic(item))
}

export async function getDebuggerEntitiesPage(
  token: string,
  integrationId: string,
  sourceId: string,
  query?: { search?: string; sort?: string; limit?: number; cursor?: string }
): Promise<PagedResult<DataDebuggerEntity>> {
  const search = buildQueryString({
    search: query?.search,
    sort: query?.sort,
    limit: query?.limit,
    cursor: query?.cursor,
  })
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/data-sources/${sourceId}/entities${search}`, {
    headers: authHeader(token),
  })
  const payload = await ensureOK(response, 'entities failed')
  const body = requireObject(payload, 'entities')
  return {
    items: pickArray(body, ['items']).map((item) => normalizeEntity(item)),
    nextCursor: pickStringOptional(body, ['nextCursor', 'next_cursor']),
    total: pickNumber(body, ['total'], 0),
  }
}

export async function getDebuggerEntities(
  token: string,
  integrationId: string,
  sourceId: string
): Promise<DataDebuggerEntity[]> {
  const page = await getDebuggerEntitiesPage(token, integrationId, sourceId)
  return page.items
}

export async function getEntityTimeline(
  token: string,
  integrationId: string,
  sourceId: string,
  entityId: string
): Promise<EntityTimelineEvent[]> {
  const response = await fetch(
    `${API_BASE}/integrations/${integrationId}/data-sources/${sourceId}/entities/${entityId}/timeline`,
    { headers: authHeader(token) }
  )
  const payload = await ensureOK(response, 'timeline failed')
  const body = requireObject(payload, 'timeline')
  return pickArray(body, ['items']).map((item) => normalizeEntityTimeline(item))
}

export async function rollbackEntity(
  token: string,
  integrationId: string,
  sourceId: string,
  entityId: string,
  targetEventId: string
): Promise<RollbackEntityResponse> {
  const response = await fetch(
    `${API_BASE}/integrations/${integrationId}/data-sources/${sourceId}/entities/${entityId}/rollback`,
    {
      method: 'POST',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetEventId }),
    }
  )
  const payload = requireObject(await ensureOK(response, 'rollback failed'), 'rollback')
  return {
    entityId: pickString(payload, ['entityId', 'entity_id'], entityId),
    rollbackEventId: pickString(payload, ['rollbackEventId', 'rollback_event_id']),
    restoredAt: pickString(payload, ['restoredAt', 'restored_at']),
  }
}

export async function rollbackDataSourceComplete(
  token: string,
  integrationId: string,
  sourceId: string
): Promise<RollbackCompleteResponse> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/data-sources/${sourceId}/rollback-complete`, {
    method: 'POST',
    headers: authHeader(token),
  })
  const payload = requireObject(await ensureOK(response, 'rollback-complete failed'), 'rollback-complete')
  return {
    sourceId: pickString(payload, ['sourceId', 'source_id']),
    restoredSnapshotId: pickString(payload, ['restoredSnapshotId', 'restored_snapshot_id']),
    restoredAt: pickString(payload, ['restoredAt', 'restored_at']),
    upsertedEntities: pickNumber(payload, ['upsertedEntities', 'upserted_entities']),
    removedEntities: pickNumber(payload, ['removedEntities', 'removed_entities']),
    compensationEvents: pickNumber(payload, ['compensationEvents', 'compensation_events']),
  }
}

export async function createDebuggerEntity(
  token: string,
  integrationId: string,
  sourceId: string,
  payload: { entityId: string; payload: Record<string, unknown> }
): Promise<CreateEntityResponse> {
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/data-sources/${sourceId}/entities`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = requireObject(await ensureOK(response, 'create entity failed'), 'create entity')
  return {
    entityId: pickString(body, ['entityId', 'entity_id'], payload.entityId),
    eventId: pickString(body, ['eventId', 'event_id']),
    createdAt: pickString(body, ['createdAt', 'created_at']),
  }
}

export async function getAuditEvents(
  token: string,
  integrationId: string,
  query?: { limit?: number; cursor?: string; resourceType?: string; actor?: string }
): Promise<PagedResult<AuditEvent>> {
  const search = buildQueryString({
    limit: query?.limit,
    cursor: query?.cursor,
    resourceType: query?.resourceType,
    actor: query?.actor,
  })
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/audit-events${search}`, {
    headers: authHeader(token),
  })
  const payload = requireObject(await ensureOK(response, 'audit events failed'), 'audit events')
  return {
    items: pickArray(payload, ['items']).map((item) => normalizeAuditEvent(item)),
    nextCursor: pickStringOptional(payload, ['nextCursor', 'next_cursor']),
  }
}

export async function getEntityMap(
  token: string,
  integrationId: string,
  query?: { sourceId?: string; search?: string; limit?: number; cursor?: string }
): Promise<PagedResult<EntityMapNode>> {
  const search = buildQueryString({
    sourceId: query?.sourceId,
    search: query?.search,
    limit: query?.limit,
    cursor: query?.cursor,
  })
  const response = await fetch(`${API_BASE}/integrations/${integrationId}/entity-map${search}`, {
    headers: authHeader(token),
  })
  const payload = requireObject(await ensureOK(response, 'entity map failed'), 'entity map')
  return {
    items: pickArray(payload, ['items']).map((item) => normalizeEntityMapNode(item)),
    nextCursor: pickStringOptional(payload, ['nextCursor', 'next_cursor']),
  }
}
