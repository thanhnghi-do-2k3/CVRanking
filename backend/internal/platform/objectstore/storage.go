package objectstore

import (
	"context"
	"fmt"
	"io"
	"net/url"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Storage struct {
	client *minio.Client
	bucket string
}

func New(endpoint, accessKey, secretKey, bucket string) (*Storage, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse object storage endpoint: %w", err)
	}
	client, err := minio.New(parsed.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: parsed.Scheme == "https",
	})
	if err != nil {
		return nil, fmt.Errorf("create object storage client: %w", err)
	}
	return &Storage{client: client, bucket: bucket}, nil
}

func (storage *Storage) Put(ctx context.Context, key, mediaType string, reader io.Reader, size int64) error {
	_, err := storage.client.PutObject(ctx, storage.bucket, key, reader, size, minio.PutObjectOptions{
		ContentType: mediaType,
	})
	if err != nil {
		return fmt.Errorf("put resume object: %w", err)
	}
	return nil
}

func (storage *Storage) Get(ctx context.Context, key string) (*minio.Object, error) {
	object, err := storage.client.GetObject(ctx, storage.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("get resume object: %w", err)
	}
	if _, err := object.Stat(); err != nil {
		object.Close()
		return nil, fmt.Errorf("stat resume object: %w", err)
	}
	return object, nil
}
