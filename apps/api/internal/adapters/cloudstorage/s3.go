package cloudstorage

import (
	"context"
	"errors"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// S3Storage implements BucketStorage for AWS S3.
type S3Storage struct {
	bucket    string
	objectKey string
	region    string
}

// NewS3 creates an S3 storage adapter. Credentials are resolved from the
// default AWS credential chain (env vars, shared config, instance metadata).
func NewS3(bucket, objectKey, region string) *S3Storage {
	if region == "" {
		region = "us-east-1"
	}
	return &S3Storage{bucket: bucket, objectKey: objectKey, region: region}
}

func (s *S3Storage) Upload(ctx context.Context, reader io.Reader) (int64, error) {
	client, err := s.newClient(ctx)
	if err != nil {
		return 0, err
	}

	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.objectKey),
		Body:   reader,
	})
	if err != nil {
		return 0, err
	}

	head, err := client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.objectKey),
	})
	if err != nil {
		return 0, nil
	}
	if head.ContentLength != nil {
		return *head.ContentLength, nil
	}
	return 0, nil
}

func (s *S3Storage) Download(ctx context.Context) (io.ReadCloser, error) {
	client, err := s.newClient(ctx)
	if err != nil {
		return nil, err
	}

	out, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.objectKey),
	})
	if err != nil {
		return nil, err
	}
	return out.Body, nil
}

func (s *S3Storage) Exists(ctx context.Context) (bool, error) {
	client, err := s.newClient(ctx)
	if err != nil {
		return false, err
	}

	_, err = client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.objectKey),
	})
	if err != nil {
		var notFound *types.NotFound
		if errors.As(err, &notFound) {
			return false, nil
		}
		var noSuchKey *types.NoSuchKey
		if errors.As(err, &noSuchKey) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (s *S3Storage) newClient(ctx context.Context) (*s3.Client, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(s.region))
	if err != nil {
		return nil, err
	}
	return s3.NewFromConfig(cfg), nil
}
