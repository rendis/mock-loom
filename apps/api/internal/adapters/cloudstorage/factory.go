package cloudstorage

import (
	"fmt"

	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
)

// New creates a BucketStorage adapter for the given provider.
func New(provider, bucket, objectKey, s3Region string) (ports.BucketStorage, error) {
	switch provider {
	case "gcs":
		return NewGCS(bucket, objectKey), nil
	case "s3":
		return NewS3(bucket, objectKey, s3Region), nil
	default:
		return nil, fmt.Errorf("unknown backup provider: %q (supported: gcs, s3)", provider)
	}
}
