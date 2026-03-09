package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
)

// BackupConfigRepository implements backup config persistence.
type BackupConfigRepository struct {
	db *DBRef
}

// NewBackupConfigRepository returns BackupConfigRepository.
func NewBackupConfigRepository(db *DBRef) *BackupConfigRepository {
	return &BackupConfigRepository{db: db}
}

// Get returns the stored backup config.
func (r *BackupConfigRepository) Get(ctx context.Context) (*entity.BackupConfig, error) {
	var cfg entity.BackupConfig
	var restoreOnStart int
	var updatedAt string
	err := executor(ctx, r.db).QueryRowContext(ctx, `
		SELECT provider, bucket, object_key, s3_region, sync_interval, restore_on_start, updated_at
		FROM backup_config
		WHERE id = 1
	`).Scan(&cfg.Provider, &cfg.Bucket, &cfg.ObjectKey, &cfg.S3Region, &cfg.SyncInterval, &restoreOnStart, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ports.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	cfg.RestoreOnStart = restoreOnStart == 1
	cfg.UpdatedAt = parseTime(updatedAt)
	return &cfg, nil
}

// Upsert creates or updates the single backup config row.
func (r *BackupConfigRepository) Upsert(ctx context.Context, cfg *entity.BackupConfig) error {
	restoreOnStart := 0
	if cfg.RestoreOnStart {
		restoreOnStart = 1
	}
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		INSERT INTO backup_config (id, provider, bucket, object_key, s3_region, sync_interval, restore_on_start, updated_at)
		VALUES (1, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			provider = excluded.provider,
			bucket = excluded.bucket,
			object_key = excluded.object_key,
			s3_region = excluded.s3_region,
			sync_interval = excluded.sync_interval,
			restore_on_start = excluded.restore_on_start,
			updated_at = excluded.updated_at
	`, cfg.Provider, cfg.Bucket, cfg.ObjectKey, cfg.S3Region, cfg.SyncInterval, restoreOnStart, toRFC3339(cfg.UpdatedAt))
	return err
}
