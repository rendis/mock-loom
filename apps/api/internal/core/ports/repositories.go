package ports

import (
	"context"
	"errors"
	"time"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
)

var (
	// ErrNotFound is returned when a record is absent.
	ErrNotFound = errors.New("not found")
	// ErrConflict is returned on unique/duplicate conflicts.
	ErrConflict = errors.New("conflict")
)

// TxManager wraps transaction boundaries.
type TxManager interface {
	WithTx(ctx context.Context, fn func(ctx context.Context) error) error
}

// UserRepository defines user persistence.
type UserRepository interface {
	Count(ctx context.Context) (int, error)
	FindByEmail(ctx context.Context, email string) (*entity.User, error)
	FindByID(ctx context.Context, id string) (*entity.User, error)
	Create(ctx context.Context, user *entity.User) error
	ActivateAndLink(ctx context.Context, userID, externalID string, activatedAt time.Time) error
}

// SystemRoleRepository defines system role persistence.
type SystemRoleRepository interface {
	FindByUserID(ctx context.Context, userID string) (*entity.SystemRoleAssignment, error)
	Upsert(ctx context.Context, role *entity.SystemRoleAssignment) error
}

// WorkspaceRepository defines workspace persistence.
type WorkspaceRepository interface {
	ListAllActive(ctx context.Context) ([]*entity.Workspace, error)
	ListByUser(ctx context.Context, userID string) ([]*entity.Workspace, error)
	FindByID(ctx context.Context, id string) (*entity.Workspace, error)
	Create(ctx context.Context, workspace *entity.Workspace) error
	Update(ctx context.Context, workspace *entity.Workspace) error
	Archive(ctx context.Context, workspaceID string, updatedAt time.Time) error
}

// WorkspaceMemberRepository defines workspace membership persistence.
type WorkspaceMemberRepository interface {
	ListByWorkspace(ctx context.Context, workspaceID string) ([]*entity.WorkspaceMember, error)
	FindByID(ctx context.Context, id string) (*entity.WorkspaceMember, error)
	FindByUserAndWorkspace(ctx context.Context, userID, workspaceID string) (*entity.WorkspaceMember, error)
	FindActiveByUserAndWorkspace(ctx context.Context, userID, workspaceID string) (*entity.WorkspaceMember, error)
	Create(ctx context.Context, member *entity.WorkspaceMember) error
	ActivatePendingByUser(ctx context.Context, userID string, joinedAt time.Time) error
	UpdateRole(ctx context.Context, memberID string, role entity.WorkspaceRole) error
	UpdateStatus(ctx context.Context, memberID string, status entity.MembershipStatus, joinedAt *time.Time) error
}

// IntegrationRepository defines integration persistence.
type IntegrationRepository interface {
	ListByWorkspace(ctx context.Context, workspaceID string) ([]*entity.Integration, error)
	FindByID(ctx context.Context, id string) (*entity.Integration, error)
	Create(ctx context.Context, integration *entity.Integration) error
	UpdateAuthMode(ctx context.Context, integrationID, authMode string, updatedAt time.Time) error
	ListPacksByIntegration(ctx context.Context, integrationID string) ([]*entity.IntegrationPack, error)
	FindPackByID(ctx context.Context, integrationID, packID string) (*entity.IntegrationPack, error)
	CreatePack(ctx context.Context, pack *entity.IntegrationPack) error
	UpdatePack(ctx context.Context, pack *entity.IntegrationPack) error
	FindAuthMockPolicy(ctx context.Context, integrationID string) (*entity.AuthMockPolicy, error)
	UpsertAuthMockPolicy(ctx context.Context, policy *entity.AuthMockPolicy) error
}

// EndpointRepository defines endpoint/traffic persistence.
type EndpointRepository interface {
	FindByID(ctx context.Context, integrationID, endpointID string) (*entity.IntegrationEndpoint, error)
	FindByMethodPath(ctx context.Context, integrationID, method, path string) (*entity.IntegrationEndpoint, error)
	UpsertEndpoint(ctx context.Context, endpoint *entity.IntegrationEndpoint) error
	UpdateEndpointRoute(ctx context.Context, endpoint *entity.IntegrationEndpoint) error
	ListRoutes(ctx context.Context, integrationID string) ([]*entity.IntegrationEndpoint, error)
	ListRoutesByPack(ctx context.Context, integrationID, packID string) ([]*entity.IntegrationEndpoint, error)
	ListTraffic(ctx context.Context, integrationID string, limit int) ([]*entity.TrafficEvent, error)
	AppendTraffic(ctx context.Context, traffic *entity.TrafficEvent) error
	AppendRevision(ctx context.Context, revision *entity.EndpointRevision) error
	ListRevisions(ctx context.Context, integrationID, endpointID string, limit, offset int) ([]*entity.EndpointRevision, error)
	FindRevisionByID(ctx context.Context, integrationID, endpointID, revisionID string) (*entity.EndpointRevision, error)
}

// DataSourceRepository defines data source persistence.
type DataSourceRepository interface {
	ListByIntegration(ctx context.Context, integrationID string) ([]*entity.DataSource, error)
	FindByID(ctx context.Context, sourceID string) (*entity.DataSource, error)
	FindByIntegrationAndSlug(ctx context.Context, integrationID, slug string) (*entity.DataSource, error)
	Create(ctx context.Context, source *entity.DataSource) error
	Update(ctx context.Context, sourceID, integrationID, name, slug string, updatedAt time.Time) error
	Delete(ctx context.Context, sourceID, integrationID, slug string) error
	UpdateStatus(ctx context.Context, sourceID string, status entity.DataSourceStatus, updatedAt time.Time) error
	FindInitialSnapshotID(ctx context.Context, integrationID, tableName string) (string, error)
	FindLatestSnapshotID(ctx context.Context, integrationID, tableName string) (string, error)
	FindSnapshotSchema(ctx context.Context, snapshotID string) (string, error)
	FindSchemaOverrides(ctx context.Context, sourceID string) (map[string]string, error)
	UpsertSchemaOverrides(ctx context.Context, sourceID string, overrides map[string]string, updatedAt time.Time) error
	ListSnapshotBaselineEntities(ctx context.Context, snapshotID string) ([]*entity.SnapshotEntityState, error)
	ListDebuggerEntities(ctx context.Context, sourceID, snapshotID string) ([]*entity.DataDebuggerEntity, error)
	ListEntityTimeline(ctx context.Context, integrationID, tableName, entityID string) ([]*entity.EntityTimelineEvent, error)
	FindTimelineEvent(ctx context.Context, integrationID, tableName, entityID, eventID string) (*entity.EntityTimelineEvent, error)
	FindWorkingEntity(ctx context.Context, sourceID, snapshotID, entityID string) (*entity.DataDebuggerEntity, error)
	UpsertWorkingEntity(ctx context.Context, sourceID, snapshotID, entityID, currentDataJSON string, updatedAt time.Time) error
	DeleteWorkingEntity(ctx context.Context, sourceID, snapshotID, entityID string) error
	AppendEntityEvent(ctx context.Context, event *entity.DataEvent) error
	CountWorkingEntities(ctx context.Context, sourceID, snapshotID string) (int, error)
	ListSourceHistory(ctx context.Context, integrationID, tableName string, limit, offset int) ([]*entity.SourceHistoryEvent, error)
	UpdateSyncStats(ctx context.Context, sourceID string, recordCount int, syncedAt time.Time) error
	ReplaceBaseline(
		ctx context.Context,
		sourceID string,
		integrationID string,
		tableName string,
		snapshot *entity.DataSnapshot,
		workingRows []*entity.WorkingDataset,
		events []*entity.DataEvent,
		syncedAt time.Time,
	) error
}
