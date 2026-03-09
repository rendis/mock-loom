package ports

import (
	"context"
	"io"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
)

// BucketStorage abstracts cloud object storage (GCS, S3).
type BucketStorage interface {
	// Upload writes content from reader to the configured object key.
	Upload(ctx context.Context, reader io.Reader) (int64, error)

	// Download returns a ReadCloser for the configured object.
	Download(ctx context.Context) (io.ReadCloser, error)

	// Exists checks whether the configured object exists in the bucket.
	Exists(ctx context.Context) (bool, error)
}

// BackupConfigRepository persists backup configuration.
type BackupConfigRepository interface {
	Get(ctx context.Context) (*entity.BackupConfig, error)
	Upsert(ctx context.Context, cfg *entity.BackupConfig) error
}
