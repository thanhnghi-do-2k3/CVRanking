package dependencies

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/talentrank/talentrank/backend/internal/config"
	"github.com/talentrank/talentrank/backend/internal/platform/health"
)

type Resources struct {
	Database       *pgxpool.Pool
	Redis          *redis.Client
	httpClient     *http.Client
	aiURL          string
	objectStoreURL string
}

func Open(ctx context.Context, cfg config.Config) (*Resources, error) {
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("configure postgres: %w", err)
	}

	redisOptions, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("configure redis: %w", err)
	}

	return &Resources{
		Database:       pool,
		Redis:          redis.NewClient(redisOptions),
		httpClient:     &http.Client{Timeout: 2 * time.Second},
		aiURL:          cfg.AIBaseURL + "/healthz",
		objectStoreURL: cfg.ObjectStoreEndpoint + "/minio/health/ready",
	}, nil
}

func (resources *Resources) Close() {
	resources.Redis.Close()
	resources.Database.Close()
}

func (resources *Resources) Readiness() health.Checker {
	return health.Composite{
		{Name: "postgres", Checker: health.CheckFunc(resources.Database.Ping)},
		{Name: "redis", Checker: health.CheckFunc(func(ctx context.Context) error {
			return resources.Redis.Ping(ctx).Err()
		})},
		{Name: "ai_service", Checker: health.CheckFunc(func(ctx context.Context) error {
			return resources.checkHTTP(ctx, resources.aiURL)
		})},
		{Name: "object_storage", Checker: health.CheckFunc(func(ctx context.Context) error {
			return resources.checkHTTP(ctx, resources.objectStoreURL)
		})},
	}
}

func (resources *Resources) checkHTTP(ctx context.Context, endpoint string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	response, err := resources.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("unexpected status %d", response.StatusCode)
	}
	return nil
}
