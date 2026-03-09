package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
)

// DataDebuggerService handles entities, timeline, and rollback use cases.
type DataDebuggerService struct {
	tx           ports.TxManager
	integrations ports.IntegrationRepository
	dataSources  ports.DataSourceRepository
}

// ListEntitiesInput defines optional filtering/pagination for debugger entities.
type ListEntitiesInput struct {
	Search string
	Sort   string
	Limit  int
	Cursor string
}

// NewDataDebuggerService returns DataDebuggerService.
func NewDataDebuggerService(
	tx ports.TxManager,
	integrations ports.IntegrationRepository,
	dataSources ports.DataSourceRepository,
) *DataDebuggerService {
	return &DataDebuggerService{
		tx:           tx,
		integrations: integrations,
		dataSources:  dataSources,
	}
}

// ListEntities returns working projection rows for one source.
func (s *DataDebuggerService) ListEntities(
	ctx context.Context,
	integrationID string,
	sourceID string,
	input ListEntitiesInput,
) (*entity.DataDebuggerEntitiesPage, error) {
	source, snapshotID, hasSnapshot, err := s.resolveSourceAndSnapshot(ctx, integrationID, sourceID)
	if err != nil {
		return nil, err
	}
	if !hasSnapshot {
		return &entity.DataDebuggerEntitiesPage{
			Items: []*entity.DataDebuggerEntity{},
			Total: 0,
		}, nil
	}

	items, err := s.dataSources.ListDebuggerEntities(ctx, source.ID, snapshotID)
	if err != nil {
		return nil, err
	}

	filtered := filterDebuggerEntities(items, strings.TrimSpace(input.Search))
	sortDebuggerEntities(filtered, strings.TrimSpace(input.Sort))

	offset := decodeOffsetCursor(input.Cursor)
	if offset < 0 {
		offset = 0
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	total := len(filtered)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}

	pageItems := filtered[offset:end]
	var nextCursor *string
	if end < total {
		value := strconv.Itoa(end)
		nextCursor = &value
	}
	return &entity.DataDebuggerEntitiesPage{
		Items:      pageItems,
		NextCursor: nextCursor,
		Total:      total,
	}, nil
}

// CreateEntity appends one source-scoped create/upsert event and projection update.
func (s *DataDebuggerService) CreateEntity(
	ctx context.Context,
	integrationID string,
	sourceID string,
	entityID string,
	payload map[string]any,
) (*entity.CreateEntityResult, error) {
	entityID = strings.TrimSpace(entityID)
	if entityID == "" || payload == nil {
		return nil, ErrInvalidInput
	}

	source, snapshotID, hasSnapshot, err := s.resolveSourceAndSnapshot(ctx, integrationID, sourceID)
	if err != nil {
		return nil, err
	}
	if !hasSnapshot {
		return nil, ports.ErrNotFound
	}

	canonicalPayload, err := marshalCanonicalJSON(payload)
	if err != nil {
		return nil, newValidationError(ErrSemanticValidation, "failed to serialize entity payload")
	}

	now := time.Now().UTC()
	event := &entity.DataEvent{
		EventID:     uuid.NewString(),
		SnapshotID:  snapshotID,
		EntityID:    entityID,
		Action:      "ENTITY_UPSERT",
		DiffPayload: canonicalPayload,
		Timestamp:   now,
	}

	if err := s.tx.WithTx(ctx, func(txCtx context.Context) error {
		if err := s.dataSources.UpsertWorkingEntity(txCtx, source.ID, snapshotID, entityID, canonicalPayload, now); err != nil {
			return err
		}
		if err := s.dataSources.AppendEntityEvent(txCtx, event); err != nil {
			return err
		}
		recordCount, err := s.dataSources.CountWorkingEntities(txCtx, source.ID, snapshotID)
		if err != nil {
			return err
		}
		return s.dataSources.UpdateSyncStats(txCtx, source.ID, recordCount, now)
	}); err != nil {
		return nil, err
	}

	return &entity.CreateEntityResult{
		EntityID:  entityID,
		EventID:   event.EventID,
		CreatedAt: now,
	}, nil
}

// ListTimeline returns immutable timeline for one entity.
func (s *DataDebuggerService) ListTimeline(ctx context.Context, integrationID, sourceID, entityID string) ([]*entity.EntityTimelineEvent, error) {
	entityID = strings.TrimSpace(entityID)
	if entityID == "" {
		return nil, ErrInvalidInput
	}

	source, _, hasSnapshot, err := s.resolveSourceAndSnapshot(ctx, integrationID, sourceID)
	if err != nil {
		return nil, err
	}
	if !hasSnapshot {
		return []*entity.EntityTimelineEvent{}, nil
	}
	return s.dataSources.ListEntityTimeline(ctx, source.IntegrationID, source.Slug, entityID)
}

// RollbackEntity appends compensation event and restores working state.
func (s *DataDebuggerService) RollbackEntity(
	ctx context.Context,
	integrationID string,
	sourceID string,
	entityID string,
	targetEventID string,
) (*entity.RollbackEntityResult, error) {
	entityID = strings.TrimSpace(entityID)
	targetEventID = strings.TrimSpace(targetEventID)
	if entityID == "" || targetEventID == "" {
		return nil, ErrInvalidInput
	}

	source, snapshotID, hasSnapshot, err := s.resolveSourceAndSnapshot(ctx, integrationID, sourceID)
	if err != nil {
		return nil, err
	}
	if !hasSnapshot {
		return nil, ports.ErrNotFound
	}

	targetEvent, err := s.dataSources.FindTimelineEvent(ctx, source.IntegrationID, source.Slug, entityID, targetEventID)
	if err != nil {
		return nil, err
	}

	targetStateJSON, err := resolveRollbackTargetState(targetEvent.DiffPayloadJSON)
	if err != nil {
		return nil, newValidationError(ErrSemanticValidation, err.Error())
	}

	currentStateJSON := "null"
	current, err := s.dataSources.FindWorkingEntity(ctx, source.ID, snapshotID, entityID)
	if err != nil && !errors.Is(err, ports.ErrNotFound) {
		return nil, err
	}
	if err == nil {
		currentStateJSON = current.CurrentDataJSON
	}

	compensationPayloadJSON, err := buildCompensationPayload(currentStateJSON, targetStateJSON, targetEventID)
	if err != nil {
		return nil, newValidationError(ErrSemanticValidation, err.Error())
	}

	now := time.Now().UTC()
	compensation := &entity.DataEvent{
		EventID:     uuid.NewString(),
		SnapshotID:  snapshotID,
		EntityID:    entityID,
		Action:      "ROLLBACK_COMPENSATION",
		DiffPayload: compensationPayloadJSON,
		Timestamp:   now,
	}

	if err := s.tx.WithTx(ctx, func(txCtx context.Context) error {
		if err := s.dataSources.UpsertWorkingEntity(txCtx, source.ID, snapshotID, entityID, targetStateJSON, now); err != nil {
			return err
		}
		if err := s.dataSources.AppendEntityEvent(txCtx, compensation); err != nil {
			return err
		}
		recordCount, err := s.dataSources.CountWorkingEntities(txCtx, source.ID, snapshotID)
		if err != nil {
			return err
		}
		return s.dataSources.UpdateSyncStats(txCtx, source.ID, recordCount, now)
	}); err != nil {
		return nil, err
	}

	return &entity.RollbackEntityResult{
		EntityID:        entityID,
		RollbackEventID: compensation.EventID,
		RestoredAt:      now,
	}, nil
}

// RollbackComplete restores a source projection to its initial baseline snapshot using compensation events only.
func (s *DataDebuggerService) RollbackComplete(
	ctx context.Context,
	integrationID string,
	sourceID string,
) (*entity.RollbackSourceResult, error) {
	source, snapshotID, hasSnapshot, err := s.resolveSourceAndSnapshot(ctx, integrationID, sourceID)
	if err != nil {
		return nil, err
	}
	if !hasSnapshot {
		return nil, ports.ErrNotFound
	}

	initialSnapshotID, err := s.dataSources.FindInitialSnapshotID(ctx, source.IntegrationID, source.Slug)
	if err != nil {
		return nil, err
	}
	baselineRows, err := s.dataSources.ListSnapshotBaselineEntities(ctx, initialSnapshotID)
	if err != nil {
		return nil, err
	}
	if len(baselineRows) == 0 {
		return nil, ports.ErrNotFound
	}

	currentRows, err := s.dataSources.ListDebuggerEntities(ctx, source.ID, snapshotID)
	if err != nil {
		return nil, err
	}

	currentByEntity := make(map[string]*entity.DataDebuggerEntity, len(currentRows))
	for _, row := range currentRows {
		currentByEntity[row.EntityID] = row
	}

	baselineByEntity := make(map[string]string, len(baselineRows))
	for _, row := range baselineRows {
		baselineByEntity[row.EntityID] = row.PayloadJSON
	}

	type upsertMutation struct {
		EntityID string
		Payload  string
		Before   string
	}
	type deleteMutation struct {
		EntityID string
		Before   string
	}

	upserts := make([]upsertMutation, 0)
	for entityID, baselinePayload := range baselineByEntity {
		current := currentByEntity[entityID]
		if current == nil {
			upserts = append(upserts, upsertMutation{
				EntityID: entityID,
				Payload:  baselinePayload,
				Before:   "null",
			})
			continue
		}
		if normalizeJSONForComparison(current.CurrentDataJSON) == normalizeJSONForComparison(baselinePayload) {
			continue
		}
		upserts = append(upserts, upsertMutation{
			EntityID: entityID,
			Payload:  baselinePayload,
			Before:   current.CurrentDataJSON,
		})
	}

	deletes := make([]deleteMutation, 0)
	for entityID, current := range currentByEntity {
		if _, exists := baselineByEntity[entityID]; exists {
			continue
		}
		deletes = append(deletes, deleteMutation{
			EntityID: entityID,
			Before:   current.CurrentDataJSON,
		})
	}

	now := time.Now().UTC()
	compensationEvents := 0
	if err := s.tx.WithTx(ctx, func(txCtx context.Context) error {
		for _, mutation := range upserts {
			if err := s.dataSources.UpsertWorkingEntity(
				txCtx,
				source.ID,
				snapshotID,
				mutation.EntityID,
				mutation.Payload,
				now,
			); err != nil {
				return err
			}

			payload, err := buildFullRollbackPayload(mutation.Before, mutation.Payload, initialSnapshotID, "UPSERT")
			if err != nil {
				return newValidationError(ErrSemanticValidation, err.Error())
			}
			event := &entity.DataEvent{
				EventID:     uuid.NewString(),
				SnapshotID:  snapshotID,
				EntityID:    mutation.EntityID,
				Action:      "ROLLBACK_COMPENSATION",
				DiffPayload: payload,
				Timestamp:   now,
			}
			if err := s.dataSources.AppendEntityEvent(txCtx, event); err != nil {
				return err
			}
			compensationEvents++
		}

		for _, mutation := range deletes {
			if err := s.dataSources.DeleteWorkingEntity(
				txCtx,
				source.ID,
				snapshotID,
				mutation.EntityID,
			); err != nil {
				return err
			}

			payload, err := buildFullRollbackPayload(mutation.Before, "null", initialSnapshotID, "DELETE")
			if err != nil {
				return newValidationError(ErrSemanticValidation, err.Error())
			}
			event := &entity.DataEvent{
				EventID:     uuid.NewString(),
				SnapshotID:  snapshotID,
				EntityID:    mutation.EntityID,
				Action:      "ROLLBACK_DELETE_COMPENSATION",
				DiffPayload: payload,
				Timestamp:   now,
			}
			if err := s.dataSources.AppendEntityEvent(txCtx, event); err != nil {
				return err
			}
			compensationEvents++
		}

		recordCount, err := s.dataSources.CountWorkingEntities(txCtx, source.ID, snapshotID)
		if err != nil {
			return err
		}
		return s.dataSources.UpdateSyncStats(txCtx, source.ID, recordCount, now)
	}); err != nil {
		return nil, err
	}

	return &entity.RollbackSourceResult{
		SourceID:           source.ID,
		RestoredSnapshotID: initialSnapshotID,
		RestoredAt:         now,
		UpsertedEntities:   len(upserts),
		RemovedEntities:    len(deletes),
		CompensationEvents: compensationEvents,
	}, nil
}

func (s *DataDebuggerService) resolveSourceAndSnapshot(
	ctx context.Context,
	integrationID string,
	sourceID string,
) (*entity.DataSource, string, bool, error) {
	integrationID = strings.TrimSpace(integrationID)
	sourceID = strings.TrimSpace(sourceID)
	if integrationID == "" || sourceID == "" {
		return nil, "", false, ErrInvalidInput
	}

	if _, err := s.integrations.FindByID(ctx, integrationID); err != nil {
		return nil, "", false, err
	}

	source, err := s.dataSources.FindByID(ctx, sourceID)
	if err != nil {
		return nil, "", false, err
	}
	if source.IntegrationID != integrationID {
		return nil, "", false, ports.ErrNotFound
	}

	snapshotID, err := s.dataSources.FindLatestSnapshotID(ctx, integrationID, source.Slug)
	if err != nil {
		if errors.Is(err, ports.ErrNotFound) {
			return source, "", false, nil
		}
		return nil, "", false, err
	}
	return source, snapshotID, true, nil
}

func resolveRollbackTargetState(diffPayloadJSON string) (string, error) {
	diffPayloadJSON = strings.TrimSpace(diffPayloadJSON)
	if diffPayloadJSON == "" {
		return "", errors.New("target event payload is empty")
	}

	var parsed any
	if err := json.Unmarshal([]byte(diffPayloadJSON), &parsed); err != nil {
		return "", errors.New("target event payload is invalid JSON")
	}

	resolved := pickTargetState(parsed)
	if resolved == nil {
		return "", errors.New("target event payload does not include a restorable state")
	}
	data, err := json.Marshal(resolved)
	if err != nil {
		return "", errors.New("failed to serialize target state")
	}
	return string(data), nil
}

func pickTargetState(payload any) any {
	object, ok := payload.(map[string]any)
	if !ok {
		return nil
	}

	if restored, exists := object["restoredState"]; exists {
		return restored
	}
	if restored, exists := object["restored_state"]; exists {
		return restored
	}
	if after, exists := object["after"]; exists {
		return after
	}

	if _, hasBefore := object["before"]; hasBefore {
		return nil
	}
	if _, hasTargetEventID := object["targetEventId"]; hasTargetEventID {
		return nil
	}
	if _, hasTargetEventID := object["target_event_id"]; hasTargetEventID {
		return nil
	}
	return object
}

func buildCompensationPayload(currentStateJSON, targetStateJSON, targetEventID string) (string, error) {
	beforeState, err := decodeJSONObjectOrNull(currentStateJSON)
	if err != nil {
		return "", errors.New("current state is invalid JSON")
	}
	afterState, err := decodeJSONObjectOrNull(targetStateJSON)
	if err != nil {
		return "", errors.New("target state is invalid JSON")
	}
	if afterState == nil {
		return "", errors.New("target state cannot be null")
	}

	payload := map[string]any{
		"targetEventId": targetEventID,
		"before":        beforeState,
		"after":         afterState,
		"restoredState": afterState,
	}
	serialized, err := json.Marshal(payload)
	if err != nil {
		return "", errors.New("failed to serialize compensation payload")
	}
	return string(serialized), nil
}

func decodeJSONObjectOrNull(value string) (any, error) {
	value = strings.TrimSpace(value)
	if value == "" || value == "null" {
		return nil, nil
	}
	var parsed any
	if err := json.Unmarshal([]byte(value), &parsed); err != nil {
		return nil, err
	}
	if parsed == nil {
		return nil, nil
	}
	if _, ok := parsed.(map[string]any); !ok {
		return nil, errors.New("expected JSON object")
	}
	return parsed, nil
}

func buildFullRollbackPayload(beforeJSON, afterJSON, snapshotID, rollbackAction string) (string, error) {
	beforeState, err := decodeJSONObjectOrNull(beforeJSON)
	if err != nil {
		return "", errors.New("full rollback before state is invalid JSON")
	}
	afterState, err := decodeJSONObjectOrNull(afterJSON)
	if err != nil {
		return "", errors.New("full rollback after state is invalid JSON")
	}
	payload := map[string]any{
		"rollbackType":     "FULL",
		"rollbackAction":   rollbackAction,
		"targetSnapshotId": snapshotID,
		"before":           beforeState,
		"after":            afterState,
	}
	if afterState != nil {
		payload["restoredState"] = afterState
	}
	serialized, err := json.Marshal(payload)
	if err != nil {
		return "", errors.New("failed to serialize full rollback payload")
	}
	return string(serialized), nil
}

func normalizeJSONForComparison(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	var parsed any
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		return trimmed
	}
	normalized, err := json.Marshal(parsed)
	if err != nil {
		return trimmed
	}
	return string(normalized)
}

func filterDebuggerEntities(items []*entity.DataDebuggerEntity, search string) []*entity.DataDebuggerEntity {
	if search == "" {
		return append([]*entity.DataDebuggerEntity(nil), items...)
	}
	query := strings.ToLower(search)
	filtered := make([]*entity.DataDebuggerEntity, 0, len(items))
	for _, item := range items {
		if strings.Contains(strings.ToLower(item.EntityID), query) || strings.Contains(strings.ToLower(item.CurrentDataJSON), query) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func sortDebuggerEntities(items []*entity.DataDebuggerEntity, sortBy string) {
	switch strings.ToLower(sortBy) {
	case "entity_asc":
		sort.SliceStable(items, func(left, right int) bool {
			return items[left].EntityID < items[right].EntityID
		})
	case "entity_desc":
		sort.SliceStable(items, func(left, right int) bool {
			return items[left].EntityID > items[right].EntityID
		})
	case "updated_at_asc":
		sort.SliceStable(items, func(left, right int) bool {
			return items[left].UpdatedAt.Before(items[right].UpdatedAt)
		})
	default:
		sort.SliceStable(items, func(left, right int) bool {
			if items[left].UpdatedAt.Equal(items[right].UpdatedAt) {
				return items[left].EntityID < items[right].EntityID
			}
			return items[left].UpdatedAt.After(items[right].UpdatedAt)
		})
	}
}

func decodeOffsetCursor(cursor string) int {
	cursor = strings.TrimSpace(cursor)
	if cursor == "" {
		return 0
	}
	offset, err := strconv.Atoi(cursor)
	if err != nil || offset < 0 {
		return 0
	}
	return offset
}
