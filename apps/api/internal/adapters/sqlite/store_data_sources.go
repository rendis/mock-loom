package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
)

// DataSourceRepository implements data source persistence.
type DataSourceRepository struct {
	db *DBRef
}

// NewDataSourceRepository returns DataSourceRepository.
func NewDataSourceRepository(db *DBRef) *DataSourceRepository {
	return &DataSourceRepository{db: db}
}

// ListByIntegration lists data sources for one integration.
func (r *DataSourceRepository) ListByIntegration(ctx context.Context, integrationID string) ([]*entity.DataSource, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, integration_id, name, slug, kind, status, last_sync_at, record_count, created_at, updated_at
		FROM core_integration_data_sources
		WHERE integration_id = ?
		ORDER BY created_at DESC
	`, integrationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDataSources(rows)
}

// FindByID returns data source by id.
func (r *DataSourceRepository) FindByID(ctx context.Context, sourceID string) (*entity.DataSource, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, integration_id, name, slug, kind, status, last_sync_at, record_count, created_at, updated_at
		FROM core_integration_data_sources
		WHERE id = ?
	`, sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanDataSources(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, ports.ErrNotFound
	}
	return items[0], nil
}

// FindByIntegrationAndSlug returns data source by integration and slug.
func (r *DataSourceRepository) FindByIntegrationAndSlug(ctx context.Context, integrationID, slug string) (*entity.DataSource, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, integration_id, name, slug, kind, status, last_sync_at, record_count, created_at, updated_at
		FROM core_integration_data_sources
		WHERE integration_id = ? AND slug = ?
		LIMIT 1
	`, integrationID, slug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanDataSources(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, ports.ErrNotFound
	}
	return items[0], nil
}

// Create inserts data source.
func (r *DataSourceRepository) Create(ctx context.Context, source *entity.DataSource) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		INSERT INTO core_integration_data_sources (
			id,
			integration_id,
			name,
			slug,
			kind,
			status,
			last_sync_at,
			record_count,
			created_at,
			updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		source.ID,
		source.IntegrationID,
		source.Name,
		source.Slug,
		source.Kind,
		source.Status,
		nullableTime(source.LastSyncAt),
		source.RecordCount,
		toRFC3339(source.CreatedAt),
		toRFC3339(source.UpdatedAt),
	)
	return mapSQLError(err)
}

// Update updates mutable data source fields and synchronizes snapshot table mapping when slug changes.
func (r *DataSourceRepository) Update(
	ctx context.Context,
	sourceID string,
	integrationID string,
	name string,
	slug string,
	updatedAt time.Time,
) error {
	exec := executor(ctx, r.db)
	var currentSlug string
	if err := exec.QueryRowContext(ctx, `
		SELECT slug
		FROM core_integration_data_sources
		WHERE id = ? AND integration_id = ?
	`, sourceID, integrationID).Scan(&currentSlug); errors.Is(err, sql.ErrNoRows) {
		return ports.ErrNotFound
	} else if err != nil {
		return err
	}

	if _, err := exec.ExecContext(ctx, `
		UPDATE core_integration_data_sources
		SET name = ?, slug = ?, updated_at = ?
		WHERE id = ? AND integration_id = ?
	`, name, slug, toRFC3339(updatedAt), sourceID, integrationID); err != nil {
		return mapSQLError(err)
	}

	if currentSlug == slug {
		return nil
	}

	if _, err := exec.ExecContext(ctx, `
		UPDATE snapshots
		SET table_name = ?
		WHERE integration_id = ? AND table_name = ?
	`, slug, integrationID, currentSlug); err != nil {
		return err
	}

	if err := r.propagateDataSourceSlugReferences(ctx, exec, integrationID, currentSlug, slug); err != nil {
		return err
	}

	return nil
}

// Delete removes one data source and all snapshot/event/projection records bound to its table slug.
func (r *DataSourceRepository) Delete(ctx context.Context, sourceID, integrationID, slug string) error {
	exec := executor(ctx, r.db)

	if _, err := exec.ExecContext(ctx, `
		DELETE FROM working_datasets
		WHERE snapshot_id IN (
			SELECT snapshot_id
			FROM snapshots
			WHERE integration_id = ? AND table_name = ?
		)
	`, integrationID, slug); err != nil {
		return err
	}

	if _, err := exec.ExecContext(ctx, `
		DELETE FROM events
		WHERE snapshot_id IN (
			SELECT snapshot_id
			FROM snapshots
			WHERE integration_id = ? AND table_name = ?
		)
	`, integrationID, slug); err != nil {
		return err
	}

	if _, err := exec.ExecContext(ctx, `
		DELETE FROM snapshots
		WHERE integration_id = ? AND table_name = ?
	`, integrationID, slug); err != nil {
		return err
	}

	result, err := exec.ExecContext(ctx, `
		DELETE FROM core_integration_data_sources
		WHERE id = ? AND integration_id = ?
	`, sourceID, integrationID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ports.ErrNotFound
	}
	return nil
}

// UpdateStatus updates data source status.
func (r *DataSourceRepository) UpdateStatus(ctx context.Context, sourceID string, status entity.DataSourceStatus, updatedAt time.Time) error {
	result, err := executor(ctx, r.db).ExecContext(ctx, `
		UPDATE core_integration_data_sources
		SET status = ?, updated_at = ?
		WHERE id = ?
	`, status, toRFC3339(updatedAt), sourceID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ports.ErrNotFound
	}
	return nil
}

// FindInitialSnapshotID resolves the oldest snapshot for one integration/source table.
func (r *DataSourceRepository) FindInitialSnapshotID(ctx context.Context, integrationID, tableName string) (string, error) {
	var snapshotID string
	err := executor(ctx, r.db).QueryRowContext(ctx, `
		SELECT snapshot_id
		FROM snapshots
		WHERE integration_id = ? AND table_name = ?
		ORDER BY created_at ASC
		LIMIT 1
	`, integrationID, tableName).Scan(&snapshotID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ports.ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return snapshotID, nil
}

// FindLatestSnapshotID resolves active snapshot for one integration/source table.
func (r *DataSourceRepository) FindLatestSnapshotID(ctx context.Context, integrationID, tableName string) (string, error) {
	var snapshotID string
	err := executor(ctx, r.db).QueryRowContext(ctx, `
		SELECT snapshot_id
		FROM snapshots
		WHERE integration_id = ? AND table_name = ?
		ORDER BY created_at DESC
		LIMIT 1
	`, integrationID, tableName).Scan(&snapshotID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ports.ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return snapshotID, nil
}

// FindSnapshotSchema returns snapshot schema JSON by snapshot id.
func (r *DataSourceRepository) FindSnapshotSchema(ctx context.Context, snapshotID string) (string, error) {
	var schema string
	err := executor(ctx, r.db).QueryRowContext(ctx, `
		SELECT data_schema
		FROM snapshots
		WHERE snapshot_id = ?
	`, snapshotID).Scan(&schema)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ports.ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return schema, nil
}

// FindSchemaOverrides returns persisted top-level schema overrides for one source.
func (r *DataSourceRepository) FindSchemaOverrides(ctx context.Context, sourceID string) (map[string]string, error) {
	var overridesJSON string
	err := executor(ctx, r.db).QueryRowContext(ctx, `
		SELECT overrides_json
		FROM core_data_source_schema_overrides
		WHERE source_id = ?
	`, sourceID).Scan(&overridesJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}

	overridesJSON = strings.TrimSpace(overridesJSON)
	if overridesJSON == "" {
		return map[string]string{}, nil
	}

	var raw map[string]any
	if err := json.Unmarshal([]byte(overridesJSON), &raw); err != nil {
		return nil, err
	}

	result := make(map[string]string, len(raw))
	for key, value := range raw {
		normalizedKey := strings.TrimSpace(key)
		typeValue, ok := value.(string)
		normalizedType := strings.ToLower(strings.TrimSpace(typeValue))
		if !ok || normalizedKey == "" || normalizedType == "" {
			continue
		}
		result[normalizedKey] = normalizedType
	}
	return result, nil
}

// UpsertSchemaOverrides stores one full override set for a source.
func (r *DataSourceRepository) UpsertSchemaOverrides(
	ctx context.Context,
	sourceID string,
	overrides map[string]string,
	updatedAt time.Time,
) error {
	exec := executor(ctx, r.db)

	normalized := make(map[string]string, len(overrides))
	for key, value := range overrides {
		normalizedKey := strings.TrimSpace(key)
		normalizedType := strings.ToLower(strings.TrimSpace(value))
		if normalizedKey == "" || normalizedType == "" {
			continue
		}
		normalized[normalizedKey] = normalizedType
	}

	if len(normalized) == 0 {
		_, err := exec.ExecContext(ctx, `
			DELETE FROM core_data_source_schema_overrides
			WHERE source_id = ?
		`, sourceID)
		return err
	}

	encoded, err := json.Marshal(normalized)
	if err != nil {
		return err
	}

	_, err = exec.ExecContext(ctx, `
		INSERT INTO core_data_source_schema_overrides (source_id, overrides_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(source_id) DO UPDATE SET
			overrides_json = excluded.overrides_json,
			updated_at = excluded.updated_at
	`, sourceID, string(encoded), toRFC3339(updatedAt))
	return err
}

// ListSnapshotBaselineEntities returns baseline-imported entities for one snapshot.
func (r *DataSourceRepository) ListSnapshotBaselineEntities(ctx context.Context, snapshotID string) ([]*entity.SnapshotEntityState, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT entity_id, diff_payload
		FROM events
		WHERE snapshot_id = ? AND action = 'BASELINE_IMPORT'
		ORDER BY timestamp ASC, event_id ASC
	`, snapshotID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]*entity.SnapshotEntityState, 0)
	for rows.Next() {
		item := &entity.SnapshotEntityState{}
		if err := rows.Scan(&item.EntityID, &item.PayloadJSON); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// ListDebuggerEntities returns current projection rows for one source snapshot.
func (r *DataSourceRepository) ListDebuggerEntities(ctx context.Context, sourceID, snapshotID string) ([]*entity.DataDebuggerEntity, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, entity_id, current_data_json, updated_at
		FROM working_datasets
		WHERE snapshot_id = ?
		ORDER BY updated_at DESC, entity_id ASC
	`, snapshotID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDebuggerEntities(rows, sourceID)
}

// ListEntityTimeline returns immutable timeline sorted by newest first.
func (r *DataSourceRepository) ListEntityTimeline(ctx context.Context, integrationID, tableName, entityID string) ([]*entity.EntityTimelineEvent, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT e.event_id, e.entity_id, e.action, e.diff_payload, e.timestamp, e.triggered_by_request_id
		FROM events e
		INNER JOIN snapshots s ON s.snapshot_id = e.snapshot_id
		WHERE s.integration_id = ? AND s.table_name = ? AND e.entity_id = ?
		ORDER BY e.timestamp DESC, e.event_id DESC
	`, integrationID, tableName, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTimelineEvents(rows)
}

// FindTimelineEvent returns one timeline event by id scoped to integration/source/entity.
func (r *DataSourceRepository) FindTimelineEvent(
	ctx context.Context,
	integrationID string,
	tableName string,
	entityID string,
	eventID string,
) (*entity.EntityTimelineEvent, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT e.event_id, e.entity_id, e.action, e.diff_payload, e.timestamp, e.triggered_by_request_id
		FROM events e
		INNER JOIN snapshots s ON s.snapshot_id = e.snapshot_id
		WHERE s.integration_id = ? AND s.table_name = ? AND e.entity_id = ? AND e.event_id = ?
	`, integrationID, tableName, entityID, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanTimelineEvents(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, ports.ErrNotFound
	}
	return items[0], nil
}

// FindWorkingEntity returns one projected row for one entity.
func (r *DataSourceRepository) FindWorkingEntity(ctx context.Context, sourceID, snapshotID, entityID string) (*entity.DataDebuggerEntity, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, entity_id, current_data_json, updated_at
		FROM working_datasets
		WHERE snapshot_id = ? AND entity_id = ?
		LIMIT 1
	`, snapshotID, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanDebuggerEntities(rows, sourceID)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, ports.ErrNotFound
	}
	return items[0], nil
}

// UpsertWorkingEntity updates current projection or creates row when missing.
func (r *DataSourceRepository) UpsertWorkingEntity(
	ctx context.Context,
	_ string,
	snapshotID string,
	entityID string,
	currentDataJSON string,
	updatedAt time.Time,
) error {
	exec := executor(ctx, r.db)
	result, err := exec.ExecContext(ctx, `
		UPDATE working_datasets
		SET current_data_json = ?, updated_at = ?
		WHERE snapshot_id = ? AND entity_id = ?
	`, currentDataJSON, toRFC3339(updatedAt), snapshotID, entityID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected > 0 {
		return nil
	}

	_, err = exec.ExecContext(ctx, `
		INSERT INTO working_datasets (id, snapshot_id, entity_id, current_data_json, updated_at)
		VALUES (?, ?, ?, ?, ?)
	`, snapshotID+":"+entityID, snapshotID, entityID, currentDataJSON, toRFC3339(updatedAt))
	return err
}

// DeleteWorkingEntity removes one projected row by snapshot/entity.
func (r *DataSourceRepository) DeleteWorkingEntity(
	ctx context.Context,
	_ string,
	snapshotID string,
	entityID string,
) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		DELETE FROM working_datasets
		WHERE snapshot_id = ? AND entity_id = ?
	`, snapshotID, entityID)
	return err
}

// AppendEntityEvent appends one immutable event.
func (r *DataSourceRepository) AppendEntityEvent(ctx context.Context, event *entity.DataEvent) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		INSERT INTO events (event_id, snapshot_id, entity_id, action, diff_payload, timestamp, triggered_by_request_id)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, event.EventID, event.SnapshotID, event.EntityID, event.Action, event.DiffPayload, toRFC3339(event.Timestamp), nullableString(event.TriggeredByRequestID))
	return err
}

// CountWorkingEntities counts projected entities for one snapshot.
func (r *DataSourceRepository) CountWorkingEntities(ctx context.Context, _ string, snapshotID string) (int, error) {
	var count int
	err := executor(ctx, r.db).QueryRowContext(ctx, `
		SELECT COUNT(1)
		FROM working_datasets
		WHERE snapshot_id = ?
	`, snapshotID).Scan(&count)
	return count, err
}

// ListSourceHistory returns source-scoped immutable event rows sorted by newest first.
func (r *DataSourceRepository) ListSourceHistory(
	ctx context.Context,
	integrationID string,
	tableName string,
	limit int,
	offset int,
) ([]*entity.SourceHistoryEvent, error) {
	if limit <= 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT e.event_id, e.entity_id, e.action, e.diff_payload, e.timestamp, e.triggered_by_request_id
		FROM events e
		INNER JOIN snapshots s ON s.snapshot_id = e.snapshot_id
		WHERE s.integration_id = ? AND s.table_name = ?
		ORDER BY e.timestamp DESC, e.event_id DESC
		LIMIT ? OFFSET ?
	`, integrationID, tableName, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSourceHistoryEvents(rows)
}

// UpdateSyncStats refreshes source synchronization metadata.
func (r *DataSourceRepository) UpdateSyncStats(ctx context.Context, sourceID string, recordCount int, syncedAt time.Time) error {
	result, err := executor(ctx, r.db).ExecContext(ctx, `
		UPDATE core_integration_data_sources
		SET status = ?, last_sync_at = ?, record_count = ?, updated_at = ?
		WHERE id = ?
	`, entity.DataSourceStatusActive, toRFC3339(syncedAt), recordCount, toRFC3339(syncedAt), sourceID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ports.ErrNotFound
	}
	return nil
}

// ReplaceBaseline replaces working projection and appends immutable snapshot/events.
func (r *DataSourceRepository) ReplaceBaseline(
	ctx context.Context,
	sourceID string,
	integrationID string,
	tableName string,
	snapshot *entity.DataSnapshot,
	workingRows []*entity.WorkingDataset,
	events []*entity.DataEvent,
	syncedAt time.Time,
) error {
	exec := executor(ctx, r.db)

	if _, err := exec.ExecContext(ctx, `
		DELETE FROM working_datasets
		WHERE snapshot_id IN (
			SELECT snapshot_id
			FROM snapshots
			WHERE integration_id = ? AND table_name = ?
		)
	`, integrationID, tableName); err != nil {
		return err
	}

	if _, err := exec.ExecContext(ctx, `
		INSERT INTO snapshots (snapshot_id, integration_id, table_name, data_schema, created_at)
		VALUES (?, ?, ?, ?, ?)
	`,
		snapshot.SnapshotID,
		snapshot.IntegrationID,
		snapshot.TableName,
		snapshot.DataSchema,
		toRFC3339(snapshot.CreatedAt),
	); err != nil {
		return err
	}

	for _, row := range workingRows {
		if _, err := exec.ExecContext(ctx, `
			INSERT INTO working_datasets (id, snapshot_id, entity_id, current_data_json, updated_at)
			VALUES (?, ?, ?, ?, ?)
		`, row.ID, row.SnapshotID, row.EntityID, row.CurrentDataJSON, toRFC3339(row.UpdatedAt)); err != nil {
			return err
		}
	}

	for _, event := range events {
		if _, err := exec.ExecContext(ctx, `
			INSERT INTO events (event_id, snapshot_id, entity_id, action, diff_payload, timestamp, triggered_by_request_id)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`,
			event.EventID,
			event.SnapshotID,
			event.EntityID,
			event.Action,
			event.DiffPayload,
			toRFC3339(event.Timestamp),
			nullableString(event.TriggeredByRequestID),
		); err != nil {
			return err
		}
	}

	result, err := exec.ExecContext(ctx, `
		UPDATE core_integration_data_sources
		SET status = ?, last_sync_at = ?, record_count = ?, updated_at = ?
		WHERE id = ?
	`,
		entity.DataSourceStatusActive,
		toRFC3339(syncedAt),
		len(workingRows),
		toRFC3339(syncedAt),
		sourceID,
	)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ports.ErrNotFound
	}
	return nil
}

func (r *DataSourceRepository) propagateDataSourceSlugReferences(
	ctx context.Context,
	exec execer,
	integrationID string,
	oldSlug string,
	newSlug string,
) error {
	if oldSlug == newSlug {
		return nil
	}

	now := time.Now().UTC()
	rows, err := exec.QueryContext(ctx, `
		SELECT id, scenarios_json
		FROM core_integration_endpoints
		WHERE integration_id = ?
	`, integrationID)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var endpointID string
		var scenariosJSON string
		if err := rows.Scan(&endpointID, &scenariosJSON); err != nil {
			return err
		}
		rewritten, changed, err := rewriteScenarioSlugReferences(scenariosJSON, oldSlug, newSlug)
		if err != nil {
			return err
		}
		if !changed {
			continue
		}
		if _, err := exec.ExecContext(ctx, `
			UPDATE core_integration_endpoints
			SET scenarios_json = ?, updated_at = ?
			WHERE integration_id = ? AND id = ?
		`, rewritten, toRFC3339(now), integrationID, endpointID); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	revisionRows, err := exec.QueryContext(ctx, `
		SELECT id, endpoint_id, scenarios_json
		FROM core_integration_endpoint_revisions
		WHERE integration_id = ?
	`, integrationID)
	if err != nil {
		return err
	}
	defer revisionRows.Close()

	for revisionRows.Next() {
		var revisionID string
		var endpointID string
		var scenariosJSON string
		if err := revisionRows.Scan(&revisionID, &endpointID, &scenariosJSON); err != nil {
			return err
		}
		rewritten, changed, err := rewriteScenarioSlugReferences(scenariosJSON, oldSlug, newSlug)
		if err != nil {
			return err
		}
		if !changed {
			continue
		}
		if _, err := exec.ExecContext(ctx, `
			UPDATE core_integration_endpoint_revisions
			SET scenarios_json = ?
			WHERE integration_id = ? AND endpoint_id = ? AND id = ?
		`, rewritten, integrationID, endpointID, revisionID); err != nil {
			return err
		}
	}
	if err := revisionRows.Err(); err != nil {
		return err
	}

	return nil
}

func rewriteScenarioSlugReferences(raw string, oldSlug string, newSlug string) (string, bool, error) {
	trimmedRaw := strings.TrimSpace(raw)
	if trimmedRaw == "" {
		return raw, false, nil
	}

	var payload any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return raw, false, err
	}

	changed := rewriteScenarioValueReferences(&payload, oldSlug, newSlug)
	if !changed {
		return raw, false, nil
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", false, err
	}
	return string(encoded), true, nil
}

func rewriteScenarioValueReferences(node *any, oldSlug string, newSlug string) bool {
	switch typed := (*node).(type) {
	case map[string]any:
		changed := false
		for key, child := range typed {
			keyTrimmed := strings.TrimSpace(key)
			if strings.EqualFold(keyTrimmed, "sourceSlug") || strings.EqualFold(keyTrimmed, "source_slug") {
				if sourceSlug, ok := child.(string); ok && strings.EqualFold(strings.TrimSpace(sourceSlug), oldSlug) {
					typed[key] = newSlug
					changed = true
					continue
				}
			}

			if childString, ok := child.(string); ok {
				rewrittenString, stringChanged := rewriteSlugExpressionReferences(childString, oldSlug, newSlug)
				if stringChanged {
					typed[key] = rewrittenString
					changed = true
					continue
				}
			}

			next := child
			if rewriteScenarioValueReferences(&next, oldSlug, newSlug) {
				typed[key] = next
				changed = true
			}
		}
		return changed
	case []any:
		changed := false
		for index, item := range typed {
			next := item
			if rewriteScenarioValueReferences(&next, oldSlug, newSlug) {
				typed[index] = next
				changed = true
			}
		}
		return changed
	case string:
		rewritten, changed := rewriteSlugExpressionReferences(typed, oldSlug, newSlug)
		if changed {
			*node = rewritten
			return true
		}
		return false
	default:
		return false
	}
}

func rewriteSlugExpressionReferences(value string, oldSlug string, newSlug string) (string, bool) {
	if value == "" || oldSlug == "" || oldSlug == newSlug {
		return value, false
	}
	rewritten := value
	rewritten = strings.ReplaceAll(rewritten, `source["`+oldSlug+`"]`, `source["`+newSlug+`"]`)
	rewritten = strings.ReplaceAll(rewritten, `source['`+oldSlug+`']`, `source['`+newSlug+`']`)
	rewritten = strings.ReplaceAll(rewritten, `source["`+oldSlug+`_by_id"]`, `source["`+newSlug+`_by_id"]`)
	rewritten = strings.ReplaceAll(rewritten, `source['`+oldSlug+`_by_id']`, `source['`+newSlug+`_by_id']`)
	rewritten = strings.ReplaceAll(rewritten, "source."+oldSlug+"_by_id", "source."+newSlug+"_by_id")
	rewritten = strings.ReplaceAll(rewritten, "source."+oldSlug, "source."+newSlug)
	return rewritten, rewritten != value
}

func scanDataSources(rows *sql.Rows) ([]*entity.DataSource, error) {
	result := make([]*entity.DataSource, 0)
	for rows.Next() {
		item := &entity.DataSource{}
		var lastSync sql.NullString
		var createdAt string
		var updatedAt string
		if err := rows.Scan(
			&item.ID,
			&item.IntegrationID,
			&item.Name,
			&item.Slug,
			&item.Kind,
			&item.Status,
			&lastSync,
			&item.RecordCount,
			&createdAt,
			&updatedAt,
		); err != nil {
			return nil, err
		}
		if lastSync.Valid {
			t := parseTime(lastSync.String)
			item.LastSyncAt = &t
		}
		item.CreatedAt = parseTime(createdAt)
		item.UpdatedAt = parseTime(updatedAt)
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func scanDebuggerEntities(rows *sql.Rows, sourceID string) ([]*entity.DataDebuggerEntity, error) {
	result := make([]*entity.DataDebuggerEntity, 0)
	for rows.Next() {
		item := &entity.DataDebuggerEntity{
			SourceID: sourceID,
		}
		var updatedAt string
		if err := rows.Scan(&item.ID, &item.EntityID, &item.CurrentDataJSON, &updatedAt); err != nil {
			return nil, err
		}
		item.UpdatedAt = parseTime(updatedAt)
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func scanTimelineEvents(rows *sql.Rows) ([]*entity.EntityTimelineEvent, error) {
	result := make([]*entity.EntityTimelineEvent, 0)
	for rows.Next() {
		item := &entity.EntityTimelineEvent{}
		var createdAt string
		var triggeredBy sql.NullString
		if err := rows.Scan(&item.ID, &item.EntityID, &item.Action, &item.DiffPayloadJSON, &createdAt, &triggeredBy); err != nil {
			return nil, err
		}
		item.CreatedAt = parseTime(createdAt)
		if triggeredBy.Valid {
			value := triggeredBy.String
			item.TriggeredByRequestID = &value
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func scanSourceHistoryEvents(rows *sql.Rows) ([]*entity.SourceHistoryEvent, error) {
	result := make([]*entity.SourceHistoryEvent, 0)
	for rows.Next() {
		item := &entity.SourceHistoryEvent{}
		var createdAt string
		var triggeredBy sql.NullString
		if err := rows.Scan(&item.ID, &item.EntityID, &item.Action, &item.DiffPayloadJSON, &createdAt, &triggeredBy); err != nil {
			return nil, err
		}
		item.CreatedAt = parseTime(createdAt)
		if triggeredBy.Valid {
			value := triggeredBy.String
			item.TriggeredByRequestID = &value
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
