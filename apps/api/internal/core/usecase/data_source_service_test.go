package usecase

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/rendis/mock-loom/apps/api/internal/config"
	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
)

type fakeTxManager struct{}

func (m *fakeTxManager) WithTx(ctx context.Context, fn func(ctx context.Context) error) error {
	return fn(ctx)
}

type fakeIntegrationRepo struct {
	integration *entity.Integration
	err         error
}

func (r *fakeIntegrationRepo) ListByWorkspace(context.Context, string) ([]*entity.Integration, error) {
	panic("not used")
}
func (r *fakeIntegrationRepo) FindByID(context.Context, string) (*entity.Integration, error) {
	if r.err != nil {
		return nil, r.err
	}
	if r.integration == nil {
		return nil, ports.ErrNotFound
	}
	return r.integration, nil
}
func (r *fakeIntegrationRepo) Create(context.Context, *entity.Integration) error {
	panic("not used")
}
func (r *fakeIntegrationRepo) UpdateAuthMode(context.Context, string, string, time.Time) error {
	panic("not used")
}
func (r *fakeIntegrationRepo) ListPacksByIntegration(context.Context, string) ([]*entity.IntegrationPack, error) {
	panic("not used")
}
func (r *fakeIntegrationRepo) FindPackByID(context.Context, string, string) (*entity.IntegrationPack, error) {
	panic("not used")
}
func (r *fakeIntegrationRepo) CreatePack(context.Context, *entity.IntegrationPack) error {
	panic("not used")
}
func (r *fakeIntegrationRepo) UpdatePack(context.Context, *entity.IntegrationPack) error {
	panic("not used")
}
func (r *fakeIntegrationRepo) FindAuthMockPolicy(context.Context, string) (*entity.AuthMockPolicy, error) {
	panic("not used")
}
func (r *fakeIntegrationRepo) UpsertAuthMockPolicy(context.Context, *entity.AuthMockPolicy) error {
	panic("not used")
}

type fakeDataSourceRepo struct {
	source *entity.DataSource
}

func (r *fakeDataSourceRepo) ListByIntegration(context.Context, string) ([]*entity.DataSource, error) {
	panic("not used")
}
func (r *fakeDataSourceRepo) FindByID(context.Context, string) (*entity.DataSource, error) {
	if r.source == nil {
		return nil, ports.ErrNotFound
	}
	return r.source, nil
}
func (r *fakeDataSourceRepo) FindByIntegrationAndSlug(context.Context, string, string) (*entity.DataSource, error) {
	panic("not used")
}
func (r *fakeDataSourceRepo) Create(context.Context, *entity.DataSource) error {
	panic("not used")
}
func (r *fakeDataSourceRepo) Update(context.Context, string, string, string, string, time.Time) error {
	panic("not used")
}
func (r *fakeDataSourceRepo) Delete(context.Context, string, string, string) error {
	panic("not used")
}
func (r *fakeDataSourceRepo) UpdateStatus(context.Context, string, entity.DataSourceStatus, time.Time) error {
	return nil
}
func (r *fakeDataSourceRepo) FindInitialSnapshotID(context.Context, string, string) (string, error) {
	panic("not used")
}
func (r *fakeDataSourceRepo) FindLatestSnapshotID(context.Context, string, string) (string, error) {
	panic("not used")
}
func (r *fakeDataSourceRepo) FindSnapshotSchema(context.Context, string) (string, error) {
	panic("not used")
}
func (r *fakeDataSourceRepo) FindSchemaOverrides(context.Context, string) (map[string]string, error) {
	panic("not used")
}
func (r *fakeDataSourceRepo) UpsertSchemaOverrides(context.Context, string, map[string]string, time.Time) error {
	panic("not used")
}
func (r *fakeDataSourceRepo) ListSnapshotBaselineEntities(context.Context, string) ([]*entity.SnapshotEntityState, error) {
	panic("not used")
}
func (r *fakeDataSourceRepo) ListDebuggerEntities(context.Context, string, string) ([]*entity.DataDebuggerEntity, error) {
	panic("not used")
}
func (r *fakeDataSourceRepo) ListEntityTimeline(context.Context, string, string, string) ([]*entity.EntityTimelineEvent, error) {
	panic("not used")
}
func (r *fakeDataSourceRepo) FindTimelineEvent(context.Context, string, string, string, string) (*entity.EntityTimelineEvent, error) {
	panic("not used")
}
func (r *fakeDataSourceRepo) FindWorkingEntity(context.Context, string, string, string) (*entity.DataDebuggerEntity, error) {
	panic("not used")
}
func (r *fakeDataSourceRepo) UpsertWorkingEntity(context.Context, string, string, string, string, time.Time) error {
	panic("not used")
}
func (r *fakeDataSourceRepo) DeleteWorkingEntity(context.Context, string, string, string) error {
	panic("not used")
}
func (r *fakeDataSourceRepo) AppendEntityEvent(context.Context, *entity.DataEvent) error {
	panic("not used")
}
func (r *fakeDataSourceRepo) CountWorkingEntities(context.Context, string, string) (int, error) {
	panic("not used")
}
func (r *fakeDataSourceRepo) ListSourceHistory(context.Context, string, string, int, int) ([]*entity.SourceHistoryEvent, error) {
	panic("not used")
}
func (r *fakeDataSourceRepo) UpdateSyncStats(context.Context, string, int, time.Time) error {
	panic("not used")
}
func (r *fakeDataSourceRepo) ReplaceBaseline(context.Context, string, string, string, *entity.DataSnapshot, []*entity.WorkingDataset, []*entity.DataEvent, time.Time) error {
	panic("not used")
}

func TestUploadBaselineHonorsConfiguredMaxBytes(t *testing.T) {
	svc := NewDataSourceService(
		&fakeTxManager{},
		&fakeIntegrationRepo{integration: &entity.Integration{ID: "int-1"}},
		&fakeDataSourceRepo{source: &entity.DataSource{ID: "src-1", IntegrationID: "int-1", Kind: entity.DataSourceKindJSON, Slug: "users"}},
		config.DataSourcesConfig{BaselineMaxBytes: 5},
	)

	_, err := svc.UploadBaseline(context.Background(), "int-1", "src-1", "baseline.json", []byte("123456"), "")
	if !errors.Is(err, ErrPayloadTooLarge) {
		t.Fatalf("expected ErrPayloadTooLarge, got %v", err)
	}
}
