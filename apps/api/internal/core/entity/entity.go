package entity

import "time"

// UserStatus is the state of a user record.
type UserStatus string

const (
	UserStatusInvited   UserStatus = "INVITED"
	UserStatusActive    UserStatus = "ACTIVE"
	UserStatusSuspended UserStatus = "SUSPENDED"
)

// SystemRole controls platform-wide access.
type SystemRole string

const (
	SystemRoleSuperAdmin    SystemRole = "SUPERADMIN"
	SystemRolePlatformAdmin SystemRole = "PLATFORM_ADMIN"
)

// WorkspaceRole controls access inside a workspace.
type WorkspaceRole string

const (
	WorkspaceRoleOwner  WorkspaceRole = "OWNER"
	WorkspaceRoleAdmin  WorkspaceRole = "ADMIN"
	WorkspaceRoleEditor WorkspaceRole = "EDITOR"
	WorkspaceRoleViewer WorkspaceRole = "VIEWER"
)

// Weight returns role rank.
func (r WorkspaceRole) Weight() int {
	switch r {
	case WorkspaceRoleOwner:
		return 40
	case WorkspaceRoleAdmin:
		return 30
	case WorkspaceRoleEditor:
		return 20
	case WorkspaceRoleViewer:
		return 10
	default:
		return 0
	}
}

// HasPermission returns true when role rank is sufficient.
func (r WorkspaceRole) HasPermission(required WorkspaceRole) bool {
	return r.Weight() >= required.Weight()
}

// ValidWorkspaceRole returns true when role is a known workspace role.
func ValidWorkspaceRole(r WorkspaceRole) bool {
	switch r {
	case WorkspaceRoleOwner, WorkspaceRoleAdmin, WorkspaceRoleEditor, WorkspaceRoleViewer:
		return true
	default:
		return false
	}
}

// IntegrationAuthMode represents valid integration-level auth modes.
type IntegrationAuthMode string

const (
	IntegrationAuthModeBearer IntegrationAuthMode = "BEARER"
	IntegrationAuthModeAPIKey IntegrationAuthMode = "API_KEY"
	IntegrationAuthModeNone   IntegrationAuthMode = "NONE"
)

// ValidIntegrationAuthMode returns true when mode is a known integration auth mode.
func ValidIntegrationAuthMode(mode string) bool {
	switch IntegrationAuthMode(mode) {
	case IntegrationAuthModeBearer, IntegrationAuthModeAPIKey, IntegrationAuthModeNone:
		return true
	default:
		return false
	}
}

// MembershipStatus represents membership lifecycle.
type MembershipStatus string

const (
	MembershipStatusPending MembershipStatus = "PENDING"
	MembershipStatusActive  MembershipStatus = "ACTIVE"
)

// WorkspaceStatus indicates workspace lifecycle.
type WorkspaceStatus string

const (
	WorkspaceStatusActive   WorkspaceStatus = "ACTIVE"
	WorkspaceStatusArchived WorkspaceStatus = "ARCHIVED"
)

// User is the global identity record.
type User struct {
	ID                 string
	Email              string
	ExternalIdentityID *string
	FullName           string
	Status             UserStatus
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// SystemRoleAssignment links a user to a system role.
type SystemRoleAssignment struct {
	UserID    string
	Role      SystemRole
	GrantedBy *string
	CreatedAt time.Time
}

// Workspace groups integrations.
type Workspace struct {
	ID           string
	Name         string
	Slug         string
	Description  string
	MetadataJSON string
	Status       WorkspaceStatus
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// WorkspaceMember links a user to a workspace role.
type WorkspaceMember struct {
	ID               string
	WorkspaceID      string
	UserID           string
	Role             WorkspaceRole
	MembershipStatus MembershipStatus
	InvitedBy        *string
	JoinedAt         *time.Time
	CreatedAt        time.Time
}

// WorkspaceMemberView is a workspace member projection with optional user identity fields.
type WorkspaceMemberView struct {
	ID               string           `json:"id"`
	WorkspaceID      string           `json:"workspace_id"`
	UserID           string           `json:"user_id"`
	Role             WorkspaceRole    `json:"role"`
	MembershipStatus MembershipStatus `json:"membership_status"`
	InvitedBy        *string          `json:"invited_by,omitempty"`
	JoinedAt         *time.Time       `json:"joined_at,omitempty"`
	CreatedAt        time.Time        `json:"created_at"`
	UserEmail        string           `json:"user_email,omitempty"`
	UserFullName     string           `json:"user_full_name,omitempty"`
}

// Integration represents a mock integration owned by one workspace.
type Integration struct {
	ID          string
	WorkspaceID string
	Name        string
	Slug        string
	BaseURL     string
	AuthMode    string
	Status      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// IntegrationPack represents one endpoint group inside an integration.
type IntegrationPack struct {
	ID             string
	IntegrationID  string
	Name           string
	Slug           string
	BasePath       string
	Status         string
	AuthEnabled    bool
	AuthPolicyJSON string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// EndpointAuthMode controls endpoint-level auth behavior.
type EndpointAuthMode string

const (
	EndpointAuthModeInherit  EndpointAuthMode = "INHERIT"
	EndpointAuthModeOverride EndpointAuthMode = "OVERRIDE"
	EndpointAuthModeNone     EndpointAuthMode = "NONE"
)

// AuthMockPolicyMode controls runtime auth simulation strategy.
type AuthMockPolicyMode string

const (
	AuthMockPolicyModePrebuilt   AuthMockPolicyMode = "PREBUILT"
	AuthMockPolicyModeCustomExpr AuthMockPolicyMode = "CUSTOM_EXPR"
)

// AuthMockHeaderOperator defines supported header validation operators.
type AuthMockHeaderOperator string

const (
	AuthMockHeaderOperatorExists   AuthMockHeaderOperator = "EXISTS"
	AuthMockHeaderOperatorEquals   AuthMockHeaderOperator = "EQUALS"
	AuthMockHeaderOperatorContains AuthMockHeaderOperator = "CONTAINS"
)

// AuthMockHeaderRule defines one deterministic prebuilt header check.
type AuthMockHeaderRule struct {
	Name     string                 `json:"name"`
	Operator AuthMockHeaderOperator `json:"operator"`
	Value    string                 `json:"value,omitempty"`
}

// AuthMockOIDCConfig defines OIDC-oriented token checks.
type AuthMockOIDCConfig struct {
	Issuer     string `json:"issuer,omitempty"`
	JWKSURL    string `json:"jwksUrl,omitempty"`
	Audience   string `json:"audience,omitempty"`
	EmailClaim string `json:"emailClaim,omitempty"`
}

// AuthMockPrebuiltPolicy contains deterministic auth simulation rules.
type AuthMockPrebuiltPolicy struct {
	DenyAll         bool                 `json:"denyAll"`
	TokenEquals     string               `json:"tokenEquals,omitempty"`
	EmailEquals     string               `json:"emailEquals,omitempty"`
	EmailContains   string               `json:"emailContains,omitempty"`
	EmailInList     []string             `json:"emailInList,omitempty"`
	RequiredHeaders []AuthMockHeaderRule `json:"requiredHeaders,omitempty"`
	OIDC            AuthMockOIDCConfig   `json:"oidc,omitempty"`
}

// AuthMockPolicy defines one integration-level runtime auth simulation policy.
type AuthMockPolicy struct {
	IntegrationID string             `json:"integrationId"`
	Mode          AuthMockPolicyMode `json:"mode"`
	Prebuilt      AuthMockPrebuiltPolicy
	CustomExpr    string `json:"customExpr,omitempty"`
	UpdatedAt     time.Time
}

// DataSourceKind indicates baseline source format.
type DataSourceKind string

const (
	DataSourceKindCSV  DataSourceKind = "CSV"
	DataSourceKindJSON DataSourceKind = "JSON"
)

// DataSourceStatus indicates ingestion lifecycle.
type DataSourceStatus string

const (
	DataSourceStatusActive  DataSourceStatus = "ACTIVE"
	DataSourceStatusPending DataSourceStatus = "PENDING"
	DataSourceStatusError   DataSourceStatus = "ERROR"
)

// DataSource stores integration-scoped baseline source metadata.
type DataSource struct {
	ID            string
	IntegrationID string
	Name          string
	Slug          string
	Kind          DataSourceKind
	Status        DataSourceStatus
	LastSyncAt    *time.Time
	RecordCount   int
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// DataSnapshot stores immutable baseline schema metadata.
type DataSnapshot struct {
	SnapshotID    string
	IntegrationID string
	TableName     string
	DataSchema    string
	CreatedAt     time.Time
}

// DataEvent stores immutable entity-level mutation records.
type DataEvent struct {
	EventID              string
	SnapshotID           string
	EntityID             string
	Action               string
	DiffPayload          string
	Timestamp            time.Time
	TriggeredByRequestID *string
}

// WorkingDataset stores the current projection for one entity.
type WorkingDataset struct {
	ID              string
	SnapshotID      string
	EntityID        string
	CurrentDataJSON string
	UpdatedAt       time.Time
}

// DataDebuggerEntity is one row projected for debugger entity list.
type DataDebuggerEntity struct {
	ID              string
	SourceID        string
	EntityID        string
	CurrentDataJSON string
	UpdatedAt       time.Time
}

// EntityTimelineEvent is one immutable event for one entity.
type EntityTimelineEvent struct {
	ID                   string
	EntityID             string
	Action               string
	DiffPayloadJSON      string
	CreatedAt            time.Time
	TriggeredByRequestID *string
}

// RollbackEntityResult reports rollback mutation outcome.
type RollbackEntityResult struct {
	EntityID        string
	RollbackEventID string
	RestoredAt      time.Time
}

// RollbackSourceResult reports full source rollback to initial baseline.
type RollbackSourceResult struct {
	SourceID           string
	RestoredSnapshotID string
	RestoredAt         time.Time
	UpsertedEntities   int
	RemovedEntities    int
	CompensationEvents int
}

// DataDebuggerEntitiesPage is a paged response for debugger entities.
type DataDebuggerEntitiesPage struct {
	Items      []*DataDebuggerEntity
	NextCursor *string
	Total      int
}

// CreateEntityResult reports a created/upserted debugger entity mutation.
type CreateEntityResult struct {
	EntityID  string
	EventID   string
	CreatedAt time.Time
}

// DataSourceSchema payload exposes active source schema JSON.
type DataSourceSchema struct {
	SourceID   string
	SchemaJSON string
	Fields     []DataSourceSchemaField
	Warnings   []DataSourceSchemaWarning
}

// DataSourceSchemaField describes one top-level key type in the effective source schema.
type DataSourceSchemaField struct {
	Key           string `json:"key"`
	InferredType  string `json:"inferredType"`
	EffectiveType string `json:"effectiveType"`
	Overridden    bool   `json:"overridden"`
}

// DataSourceSchemaWarning reports non-blocking type mismatches in current projected entities.
type DataSourceSchemaWarning struct {
	Key           string `json:"key"`
	ExpectedType  string `json:"expectedType"`
	MismatchCount int    `json:"mismatchCount"`
}

// SourceHistoryEvent stores source-scoped immutable event rows.
type SourceHistoryEvent struct {
	ID                   string
	EntityID             string
	Action               string
	DiffPayloadJSON      string
	CreatedAt            time.Time
	TriggeredByRequestID *string
}

// SnapshotEntityState stores one entity state extracted from a snapshot.
type SnapshotEntityState struct {
	EntityID    string
	PayloadJSON string
}

// SyncDataSourceResult reports sync-now action metadata.
type SyncDataSourceResult struct {
	SourceID    string
	Status      DataSourceStatus
	LastSyncAt  time.Time
	RecordCount int
}

// AuditEvent stores one observability audit record.
type AuditEvent struct {
	ID            string
	IntegrationID string
	ResourceType  string
	ResourceID    string
	Action        string
	Actor         string
	Summary       string
	CreatedAt     time.Time
}

// EntityMapNode stores one integration entity-map node.
type EntityMapNode struct {
	SourceID   string
	SourceName string
	EntityID   string
	UpdatedAt  time.Time
}

// ValidationIssue reports endpoint validation details.
type ValidationIssue struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	Path     string `json:"path"`
	Severity string `json:"severity"`
}

// EndpointRevision stores one endpoint artifact revision.
type EndpointRevision struct {
	ID                     string
	IntegrationID          string
	EndpointID             string
	ContractJSON           string
	ScenariosJSON          string
	CreatedAt              time.Time
	RestoredFromRevisionID *string
}

// EndpointAutocompleteContext contains runtime autocomplete suggestions for the endpoint editor.
type EndpointAutocompleteContext struct {
	RequestPaths  []string `json:"requestPaths"`
	SourcePaths   []string `json:"sourcePaths"`
	Functions     []string `json:"functions"`
	TemplatePaths []string `json:"templatePaths"`
}

// IntegrationEndpoint stores endpoint editor data.
type IntegrationEndpoint struct {
	ID                     string
	IntegrationID          string
	PackID                 string
	Method                 string
	Path                   string
	AuthMode               EndpointAuthMode
	AuthOverridePolicyJSON string
	ContractJSON           string
	ScenariosJSON          string
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

// TrafficEvent stores runtime traffic logs.
type TrafficEvent struct {
	ID                 string
	IntegrationID      string
	EndpointID         *string
	RequestSummaryJSON string
	MatchedScenario    *string
	CreatedAt          time.Time
}
