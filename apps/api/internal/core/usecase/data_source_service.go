package usecase

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/rendis/mock-loom/apps/api/internal/config"
	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
)

// DataSourceService handles data source lifecycle and baseline ingestion.
type DataSourceService struct {
	tx               ports.TxManager
	integrations     ports.IntegrationRepository
	dataSources      ports.DataSourceRepository
	baselineMaxBytes int
}

// SourceHistoryResult is a paged source history response.
type SourceHistoryResult struct {
	Items      []*entity.SourceHistoryEvent
	NextCursor *string
}

// NewDataSourceService returns DataSourceService.
func NewDataSourceService(
	tx ports.TxManager,
	integrations ports.IntegrationRepository,
	dataSources ports.DataSourceRepository,
	cfg config.DataSourcesConfig,
) *DataSourceService {
	maxBytes := cfg.BaselineMaxBytes
	if maxBytes <= 0 {
		maxBytes = config.DefaultDataSourceBaselineMaxBytes
	}
	return &DataSourceService{
		tx:               tx,
		integrations:     integrations,
		dataSources:      dataSources,
		baselineMaxBytes: maxBytes,
	}
}

// ListByIntegration lists all data sources for one integration.
func (s *DataSourceService) ListByIntegration(ctx context.Context, integrationID string) ([]*entity.DataSource, error) {
	if strings.TrimSpace(integrationID) == "" {
		return nil, ErrInvalidInput
	}
	if _, err := s.integrations.FindByID(ctx, integrationID); err != nil {
		return nil, err
	}
	return s.dataSources.ListByIntegration(ctx, integrationID)
}

// Create registers one data source in pending status.
func (s *DataSourceService) Create(ctx context.Context, integrationID, name, slug, kind string) (*entity.DataSource, error) {
	integrationID = strings.TrimSpace(integrationID)
	name = strings.TrimSpace(name)
	slug = strings.ToLower(strings.TrimSpace(slug))
	kind = strings.ToUpper(strings.TrimSpace(kind))
	if integrationID == "" || name == "" || slug == "" || kind == "" {
		return nil, ErrInvalidInput
	}
	if kind != string(entity.DataSourceKindCSV) && kind != string(entity.DataSourceKindJSON) {
		return nil, ErrInvalidInput
	}
	if _, err := s.integrations.FindByID(ctx, integrationID); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	source := &entity.DataSource{
		ID:            uuid.NewString(),
		IntegrationID: integrationID,
		Name:          name,
		Slug:          slug,
		Kind:          entity.DataSourceKind(kind),
		Status:        entity.DataSourceStatusPending,
		RecordCount:   0,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	if err := s.dataSources.Create(ctx, source); err != nil {
		if errors.Is(err, ports.ErrConflict) {
			return nil, ErrAlreadyExists
		}
		return nil, err
	}
	return source, nil
}

// Update updates mutable data source metadata.
func (s *DataSourceService) Update(ctx context.Context, integrationID, sourceID, name, slug string) (*entity.DataSource, error) {
	integrationID = strings.TrimSpace(integrationID)
	sourceID = strings.TrimSpace(sourceID)
	name = strings.TrimSpace(name)
	slug = strings.ToLower(strings.TrimSpace(slug))

	if integrationID == "" || sourceID == "" || name == "" || slug == "" {
		return nil, ErrInvalidInput
	}
	if _, err := s.integrations.FindByID(ctx, integrationID); err != nil {
		return nil, err
	}

	source, err := s.dataSources.FindByID(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	if source.IntegrationID != integrationID {
		return nil, ports.ErrNotFound
	}

	existing, err := s.dataSources.FindByIntegrationAndSlug(ctx, integrationID, slug)
	if err == nil && existing.ID != sourceID {
		return nil, ErrAlreadyExists
	}
	if err != nil && !errors.Is(err, ports.ErrNotFound) {
		return nil, err
	}

	now := time.Now().UTC()
	if err := s.tx.WithTx(ctx, func(txCtx context.Context) error {
		if err := s.dataSources.Update(txCtx, sourceID, integrationID, name, slug, now); err != nil {
			if errors.Is(err, ports.ErrConflict) {
				return ErrAlreadyExists
			}
			return err
		}
		return nil
	}); err != nil {
		return nil, err
	}

	return s.dataSources.FindByID(ctx, sourceID)
}

// Delete removes a data source and all underlying snapshot/event/working-state records.
func (s *DataSourceService) Delete(ctx context.Context, integrationID, sourceID string) error {
	integrationID = strings.TrimSpace(integrationID)
	sourceID = strings.TrimSpace(sourceID)

	if integrationID == "" || sourceID == "" {
		return ErrInvalidInput
	}
	if _, err := s.integrations.FindByID(ctx, integrationID); err != nil {
		return err
	}

	source, err := s.dataSources.FindByID(ctx, sourceID)
	if err != nil {
		return err
	}
	if source.IntegrationID != integrationID {
		return ports.ErrNotFound
	}

	return s.tx.WithTx(ctx, func(txCtx context.Context) error {
		return s.dataSources.Delete(txCtx, sourceID, integrationID, source.Slug)
	})
}

// UploadBaselineResult returns baseline ingestion metadata.
type UploadBaselineResult struct {
	SourceID    string `json:"sourceId"`
	SnapshotID  string `json:"snapshotId"`
	RecordCount int    `json:"recordCount"`
	Status      string `json:"status"`
}

// UploadBaseline parses one baseline and rebuilds the projection atomically.
func (s *DataSourceService) UploadBaseline(
	ctx context.Context,
	integrationID string,
	sourceID string,
	filename string,
	payload []byte,
	csvDelimiter string,
) (*UploadBaselineResult, error) {
	integrationID = strings.TrimSpace(integrationID)
	sourceID = strings.TrimSpace(sourceID)
	if integrationID == "" || sourceID == "" {
		return nil, ErrInvalidInput
	}
	if len(payload) == 0 {
		return nil, ErrMalformedRequest
	}
	if s.baselineMaxBytes > 0 && len(payload) > s.baselineMaxBytes {
		return nil, ErrPayloadTooLarge
	}

	source, err := s.dataSources.FindByID(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	if source.IntegrationID != integrationID {
		return nil, ports.ErrNotFound
	}

	rows, schemaJSON, parseErr := parseBaselinePayload(source.Kind, filename, payload, baselineParseOptions{
		CSVDelimiter: csvDelimiter,
	})
	if parseErr != nil {
		_ = s.dataSources.UpdateStatus(ctx, source.ID, entity.DataSourceStatusError, time.Now().UTC())
		return nil, wrapValidationError(parseErr)
	}
	inferredTypes, parseSchemaErr := parseTopLevelSchemaTypes(schemaJSON)
	if parseSchemaErr != nil {
		_ = s.dataSources.UpdateStatus(ctx, source.ID, entity.DataSourceStatusError, time.Now().UTC())
		return nil, wrapValidationError(parseSchemaErr)
	}
	existingOverrides, err := s.dataSources.FindSchemaOverrides(ctx, source.ID)
	if err != nil {
		return nil, err
	}
	prunedOverrides := pruneSchemaOverrides(existingOverrides, inferredTypes)

	now := time.Now().UTC()
	snapshotID := uuid.NewString()

	workingRows := make([]*entity.WorkingDataset, 0, len(rows))
	events := make([]*entity.DataEvent, 0, len(rows))
	for idx, row := range rows {
		entityID := resolveEntityID(row, source.ID, idx)
		if strings.TrimSpace(anyToString(row["id"])) == "" {
			row["_entity_id"] = entityID
		}

		rowJSON, marshalErr := marshalCanonicalJSON(row)
		if marshalErr != nil {
			_ = s.dataSources.UpdateStatus(ctx, source.ID, entity.DataSourceStatusError, time.Now().UTC())
			return nil, newValidationError(ErrSemanticValidation, "failed to serialize normalized row", marshalErr.Error())
		}

		workingRows = append(workingRows, &entity.WorkingDataset{
			ID:              uuid.NewString(),
			SnapshotID:      snapshotID,
			EntityID:        entityID,
			CurrentDataJSON: rowJSON,
			UpdatedAt:       now,
		})
		events = append(events, &entity.DataEvent{
			EventID:     uuid.NewString(),
			SnapshotID:  snapshotID,
			EntityID:    entityID,
			Action:      "BASELINE_IMPORT",
			DiffPayload: rowJSON,
			Timestamp:   now,
		})
	}

	snapshot := &entity.DataSnapshot{
		SnapshotID:    snapshotID,
		IntegrationID: integrationID,
		TableName:     source.Slug,
		DataSchema:    schemaJSON,
		CreatedAt:     now,
	}

	if err := s.tx.WithTx(ctx, func(txCtx context.Context) error {
		if err := s.dataSources.ReplaceBaseline(
			txCtx,
			source.ID,
			integrationID,
			source.Slug,
			snapshot,
			workingRows,
			events,
			now,
		); err != nil {
			return err
		}
		return s.dataSources.UpsertSchemaOverrides(txCtx, source.ID, prunedOverrides, now)
	}); err != nil {
		_ = s.dataSources.UpdateStatus(ctx, source.ID, entity.DataSourceStatusError, time.Now().UTC())
		return nil, err
	}

	return &UploadBaselineResult{
		SourceID:    source.ID,
		SnapshotID:  snapshotID,
		RecordCount: len(workingRows),
		Status:      string(entity.DataSourceStatusActive),
	}, nil
}

// SyncNow recalculates source metadata from the active snapshot projection.
func (s *DataSourceService) SyncNow(
	ctx context.Context,
	integrationID string,
	sourceID string,
) (*entity.SyncDataSourceResult, error) {
	source, snapshotID, err := s.resolveSourceSnapshot(ctx, integrationID, sourceID)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	recordCount := 0
	if snapshotID != "" {
		count, countErr := s.dataSources.CountWorkingEntities(ctx, source.ID, snapshotID)
		if countErr != nil {
			return nil, countErr
		}
		recordCount = count
	}

	if err := s.dataSources.UpdateSyncStats(ctx, source.ID, recordCount, now); err != nil {
		return nil, err
	}

	return &entity.SyncDataSourceResult{
		SourceID:    source.ID,
		Status:      entity.DataSourceStatusActive,
		LastSyncAt:  now,
		RecordCount: recordCount,
	}, nil
}

// GetSchema resolves active source schema JSON.
func (s *DataSourceService) GetSchema(
	ctx context.Context,
	integrationID string,
	sourceID string,
) (*entity.DataSourceSchema, error) {
	source, snapshotID, err := s.resolveSourceSnapshot(ctx, integrationID, sourceID)
	if err != nil {
		return nil, err
	}
	if snapshotID == "" {
		return nil, ports.ErrNotFound
	}

	inferredSchemaJSON, err := s.dataSources.FindSnapshotSchema(ctx, snapshotID)
	if err != nil {
		return nil, err
	}
	inferredTypes, err := parseTopLevelSchemaTypes(inferredSchemaJSON)
	if err != nil {
		return nil, wrapValidationError(err)
	}
	overrides, err := s.dataSources.FindSchemaOverrides(ctx, source.ID)
	if err != nil {
		return nil, err
	}

	return s.resolveEffectiveSchema(ctx, source, snapshotID, inferredTypes, overrides)
}

// UpdateSchema persists schema overrides and returns effective schema payload.
func (s *DataSourceService) UpdateSchema(
	ctx context.Context,
	integrationID string,
	sourceID string,
	fields []DataSourceSchemaFieldInput,
) (*entity.DataSourceSchema, error) {
	source, snapshotID, err := s.resolveSourceSnapshot(ctx, integrationID, sourceID)
	if err != nil {
		return nil, err
	}
	if snapshotID == "" {
		return nil, ports.ErrNotFound
	}

	inferredSchemaJSON, err := s.dataSources.FindSnapshotSchema(ctx, snapshotID)
	if err != nil {
		return nil, err
	}
	inferredTypes, err := parseTopLevelSchemaTypes(inferredSchemaJSON)
	if err != nil {
		return nil, wrapValidationError(err)
	}
	overrides, err := validateSchemaFieldOverrides(fields, inferredTypes)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	if err := s.dataSources.UpsertSchemaOverrides(ctx, source.ID, overrides, now); err != nil {
		return nil, err
	}

	return s.resolveEffectiveSchema(ctx, source, snapshotID, inferredTypes, overrides)
}

// ListHistory returns source-scoped immutable history events.
func (s *DataSourceService) ListHistory(
	ctx context.Context,
	integrationID string,
	sourceID string,
	limit int,
	cursor string,
) (*SourceHistoryResult, error) {
	source, _, err := s.resolveSourceSnapshot(ctx, integrationID, sourceID)
	if err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	offset := decodeHistoryCursor(cursor)

	items, err := s.dataSources.ListSourceHistory(ctx, source.IntegrationID, source.Slug, limit+1, offset)
	if err != nil {
		return nil, err
	}

	var nextCursor *string
	if len(items) > limit {
		next := strconv.Itoa(offset + limit)
		nextCursor = &next
		items = items[:limit]
	}

	return &SourceHistoryResult{
		Items:      items,
		NextCursor: nextCursor,
	}, nil
}

func (s *DataSourceService) resolveSourceSnapshot(
	ctx context.Context,
	integrationID string,
	sourceID string,
) (*entity.DataSource, string, error) {
	integrationID = strings.TrimSpace(integrationID)
	sourceID = strings.TrimSpace(sourceID)
	if integrationID == "" || sourceID == "" {
		return nil, "", ErrInvalidInput
	}

	if _, err := s.integrations.FindByID(ctx, integrationID); err != nil {
		return nil, "", err
	}

	source, err := s.dataSources.FindByID(ctx, sourceID)
	if err != nil {
		return nil, "", err
	}
	if source.IntegrationID != integrationID {
		return nil, "", ports.ErrNotFound
	}

	snapshotID, err := s.dataSources.FindLatestSnapshotID(ctx, integrationID, source.Slug)
	if err != nil {
		if errors.Is(err, ports.ErrNotFound) {
			return source, "", nil
		}
		return nil, "", err
	}
	return source, snapshotID, nil
}

func decodeHistoryCursor(cursor string) int {
	cursor = strings.TrimSpace(cursor)
	if cursor == "" {
		return 0
	}
	value, err := strconv.Atoi(cursor)
	if err != nil || value < 0 {
		return 0
	}
	return value
}

func (s *DataSourceService) resolveEffectiveSchema(
	ctx context.Context,
	source *entity.DataSource,
	snapshotID string,
	inferredTypes map[string]string,
	overrides map[string]string,
) (*entity.DataSourceSchema, error) {
	effectiveOverrides := pruneSchemaOverrides(overrides, inferredTypes)
	fields, effectiveTypes := buildSchemaFields(inferredTypes, effectiveOverrides)
	effectiveSchemaJSON, err := buildTopLevelSchemaJSON(effectiveTypes)
	if err != nil {
		return nil, err
	}

	entities, err := s.dataSources.ListDebuggerEntities(ctx, source.ID, snapshotID)
	if err != nil {
		return nil, err
	}
	warnings := buildSchemaWarningsFromEntities(entities, effectiveTypes)

	return &entity.DataSourceSchema{
		SourceID:   source.ID,
		SchemaJSON: effectiveSchemaJSON,
		Fields:     fields,
		Warnings:   warnings,
	}, nil
}
