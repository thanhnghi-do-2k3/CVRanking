package main

import (
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hibiken/asynq"
	"github.com/talentrank/talentrank/backend/internal/config"
	"github.com/talentrank/talentrank/backend/internal/platform/dependencies"
	"github.com/talentrank/talentrank/backend/internal/platform/httpserver"
	"github.com/talentrank/talentrank/backend/internal/platform/telemetry"
)

func main() {
	os.Exit(run())
}

func run() int {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("invalid_configuration", "error", err)
		return 1
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	shutdownTelemetry, err := telemetry.Configure(ctx, cfg.ServiceName, cfg.Version, cfg.OTLPEndpoint)
	if err != nil {
		logger.Error("telemetry_configuration_failed", "error", err)
		return 1
	}
	resources, err := dependencies.Open(ctx, cfg)
	if err != nil {
		logger.Error("dependency_configuration_failed", "error", err)
		return 1
	}
	defer resources.Close()

	healthServer := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: httpserver.New(httpserver.Options{
			ServiceName: cfg.ServiceName,
			Version:     cfg.Version,
			Logger:      logger,
			Readiness:   resources.Readiness(),
		}),
		ReadHeaderTimeout: 5 * time.Second,
	}
	queueOptions, err := queueConnection(cfg.RedisURL)
	if err != nil {
		logger.Error("queue_configuration_failed", "error", err)
		return 1
	}
	queueServer := asynq.NewServer(queueOptions, asynq.Config{
		Concurrency: 10,
		Queues: map[string]int{
			"documents":  5,
			"ranking":    3,
			"evaluation": 1,
			"default":    1,
		},
	})

	errors := make(chan error, 2)
	go func() { errors <- healthServer.ListenAndServe() }()
	go func() { errors <- queueServer.Run(asynq.NewServeMux()) }()
	logger.Info("worker_started", "health_address", cfg.HTTPAddr)

	select {
	case <-ctx.Done():
		logger.Info("worker_shutdown_requested")
	case err := <-errors:
		if err != nil && err != http.ErrServerClosed {
			logger.Error("worker_failed", "error", err)
			return 1
		}
	}

	queueServer.Shutdown()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	_ = healthServer.Shutdown(shutdownCtx)
	if err := shutdownTelemetry(shutdownCtx); err != nil {
		logger.Error("telemetry_shutdown_failed", "error", err)
		return 1
	}
	return 0
}

func queueConnection(raw string) (asynq.RedisClientOpt, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return asynq.RedisClientOpt{}, err
	}
	password, _ := parsed.User.Password()
	database := 0
	if parsed.Path == "/1" {
		database = 1
	}
	return asynq.RedisClientOpt{
		Addr:     parsed.Host,
		Password: password,
		DB:       database,
	}, nil
}
