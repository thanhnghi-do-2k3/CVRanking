package app

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/talentrank/talentrank/backend/internal/auth"
	"github.com/talentrank/talentrank/backend/internal/config"
	"github.com/talentrank/talentrank/backend/internal/job"
	"github.com/talentrank/talentrank/backend/internal/platform/ai"
	"github.com/talentrank/talentrank/backend/internal/platform/dependencies"
	"github.com/talentrank/talentrank/backend/internal/platform/httpserver"
	"github.com/talentrank/talentrank/backend/internal/platform/objectstore"
	"github.com/talentrank/talentrank/backend/internal/platform/telemetry"
	"github.com/talentrank/talentrank/backend/internal/ranking"
	"github.com/talentrank/talentrank/backend/internal/resume"
)

func RunAPI() int {
	cfg, logger, resources, shutdownTelemetry, ok := bootstrap()
	if !ok {
		return 1
	}
	defer resources.Close()

	jwt, err := auth.NewJWTManager(cfg.JWTSigningKey, cfg.ServiceName)
	if err != nil {
		logger.Error("auth_configuration_failed", "error", err)
		return 1
	}
	emailSender := auth.NewSMTPEmailSender(auth.SMTPConfig{
		Host:      cfg.SMTPHost,
		Port:      cfg.SMTPPort,
		Username:  cfg.SMTPUsername,
		Password:  cfg.SMTPPassword,
		From:      cfg.SMTPFrom,
		TLS:       cfg.SMTPTLS,
		PublicURL: cfg.PublicWebURL,
	})
	authHandler := auth.NewHandler(auth.HandlerOptions{
		Database:     resources.Database,
		Redis:        resources.Redis,
		JWT:          jwt,
		Email:        emailSender,
		Logger:       logger,
		CookieSecure: cfg.RefreshCookieSecure,
	})
	aiClient := ai.NewClient(cfg.AIBaseURL)
	storage, err := objectstore.New(
		cfg.ObjectStoreEndpoint,
		cfg.ObjectStoreAccessKey,
		cfg.ObjectStoreSecretKey,
		cfg.ObjectStoreBucket,
	)
	if err != nil {
		logger.Error("object_storage_configuration_failed", "error", err)
		return 1
	}
	jobHandler := job.NewHandler(resources.Database, aiClient, logger)
	resumeHandler := resume.NewHandler(resources.Database, aiClient, storage, logger)
	rankingHandler := ranking.NewHandler(resources.Database, aiClient, logger)
	handler := httpserver.New(httpserver.Options{
		ServiceName: cfg.ServiceName,
		Version:     cfg.Version,
		BasePath:    "/api/v1",
		Logger:      logger,
		Readiness:   resources.Readiness(),
		RegisterRoutes: func(router chi.Router, basePath string) {
			authHandler.RegisterRoutes(router, basePath)
			router.Group(func(protected chi.Router) {
				protected.Use(authHandler.Authenticate)
				jobHandler.RegisterRoutes(protected, basePath)
				resumeHandler.RegisterRoutes(protected, basePath)
				rankingHandler.RegisterRoutes(protected, basePath)
			})
		},
	})
	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	errors := make(chan error, 1)
	go func() {
		logger.Info("api_started", "address", cfg.HTTPAddr, "version", cfg.Version)
		errors <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		logger.Info("shutdown_requested")
	case err := <-errors:
		if err != nil && err != http.ErrServerClosed {
			logger.Error("api_failed", "error", err)
			return 1
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("api_shutdown_failed", "error", err)
		return 1
	}
	if err := shutdownTelemetry(shutdownCtx); err != nil {
		logger.Error("telemetry_shutdown_failed", "error", err)
		return 1
	}
	return 0
}

func bootstrap() (config.Config, *slog.Logger, *dependencies.Resources, func(context.Context) error, bool) {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("invalid_configuration", "error", err)
		return config.Config{}, nil, nil, nil, false
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	slog.SetDefault(logger)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	shutdownTelemetry, err := telemetry.Configure(ctx, cfg.ServiceName, cfg.Version, cfg.OTLPEndpoint)
	if err != nil {
		logger.Error("telemetry_configuration_failed", "error", err)
		return config.Config{}, nil, nil, nil, false
	}
	resources, err := dependencies.Open(ctx, cfg)
	if err != nil {
		logger.Error("dependency_configuration_failed", "error", err)
		_ = shutdownTelemetry(ctx)
		return config.Config{}, nil, nil, nil, false
	}
	return cfg, logger, resources, shutdownTelemetry, true
}
