package cloudstorage

import (
	"context"
	"errors"
	"io"

	"cloud.google.com/go/storage"
)

// GCSStorage implements BucketStorage for Google Cloud Storage.
type GCSStorage struct {
	bucket    string
	objectKey string
}

// NewGCS creates a GCS storage adapter. Credentials are resolved from
// Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS env var
// or metadata server).
func NewGCS(bucket, objectKey string) *GCSStorage {
	return &GCSStorage{bucket: bucket, objectKey: objectKey}
}

func (s *GCSStorage) Upload(ctx context.Context, reader io.Reader) (int64, error) {
	client, err := storage.NewClient(ctx)
	if err != nil {
		return 0, err
	}
	defer client.Close()

	w := client.Bucket(s.bucket).Object(s.objectKey).NewWriter(ctx)
	written, err := io.Copy(w, reader)
	if err != nil {
		_ = w.Close()
		return 0, err
	}
	if err := w.Close(); err != nil {
		return 0, err
	}
	return written, nil
}

func (s *GCSStorage) Download(ctx context.Context) (io.ReadCloser, error) {
	client, err := storage.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	reader, err := client.Bucket(s.bucket).Object(s.objectKey).NewReader(ctx)
	if err != nil {
		client.Close()
		return nil, err
	}
	return &gcsReadCloser{reader: reader, client: client}, nil
}

func (s *GCSStorage) Exists(ctx context.Context) (bool, error) {
	client, err := storage.NewClient(ctx)
	if err != nil {
		return false, err
	}
	defer client.Close()

	_, err = client.Bucket(s.bucket).Object(s.objectKey).Attrs(ctx)
	if errors.Is(err, storage.ErrObjectNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

type gcsReadCloser struct {
	reader *storage.Reader
	client *storage.Client
}

func (r *gcsReadCloser) Read(p []byte) (int, error) {
	return r.reader.Read(p)
}

func (r *gcsReadCloser) Close() error {
	r.reader.Close()
	return r.client.Close()
}
