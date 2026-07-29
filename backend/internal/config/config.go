package config

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Environment          string
	ServiceName          string
	Version              string
	HTTPAddr             string
	LogLevel             slog.Level
	DatabaseURL          string
	RedisURL             string
	JWTSigningKey        string
	PublicWebURL         string
	RefreshCookieSecure  bool
	SMTPHost             string
	SMTPPort             int
	SMTPUsername         string
	SMTPPassword         string
	SMTPFrom             string
	SMTPTLS              bool
	AIBaseURL            string
	ObjectStoreEndpoint  string
	ObjectStoreAccessKey string
	ObjectStoreSecretKey string
	ObjectStoreBucket    string
	OTLPEndpoint         string
	ShutdownTimeout      time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Environment:          value("APP_ENV", "development"),
		ServiceName:          value("SERVICE_NAME", "talentrank-api"),
		Version:              value("APP_VERSION", "dev"),
		HTTPAddr:             value("HTTP_ADDR", ":8080"),
		DatabaseURL:          strings.TrimSpace(os.Getenv("DATABASE_URL")),
		RedisURL:             strings.TrimSpace(os.Getenv("REDIS_URL")),
		JWTSigningKey:        strings.TrimSpace(os.Getenv("JWT_SIGNING_KEY")),
		PublicWebURL:         strings.TrimRight(value("PUBLIC_WEB_URL", "http://localhost:3000"), "/"),
		RefreshCookieSecure:  boolValue("REFRESH_COOKIE_SECURE", false),
		SMTPHost:             value("SMTP_HOST", "localhost"),
		SMTPPort:             intValue("SMTP_PORT", 1025),
		SMTPUsername:         strings.TrimSpace(os.Getenv("SMTP_USERNAME")),
		SMTPPassword:         os.Getenv("SMTP_PASSWORD"),
		SMTPFrom:             value("SMTP_FROM", "TalentRank <no-reply@talentrank.local>"),
		SMTPTLS:              boolValue("SMTP_TLS", false),
		AIBaseURL:            strings.TrimRight(value("AI_BASE_URL", "http://localhost:8000"), "/"),
		ObjectStoreEndpoint:  strings.TrimRight(value("OBJECT_STORAGE_ENDPOINT", "http://localhost:9000"), "/"),
		ObjectStoreAccessKey: value("OBJECT_STORAGE_ACCESS_KEY", "talentrank"),
		ObjectStoreSecretKey: value("OBJECT_STORAGE_SECRET_KEY", "talentrank_dev_password"),
		ObjectStoreBucket:    value("OBJECT_STORAGE_BUCKET", "resumes"),
		OTLPEndpoint:         strings.TrimRight(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"), "/"),
		ShutdownTimeout:      durationValue("SHUTDOWN_TIMEOUT", 10*time.Second),
	}

	level, err := parseLevel(value("LOG_LEVEL", "info"))
	if err != nil {
		return Config{}, err
	}
	cfg.LogLevel = level

	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if cfg.RedisURL == "" {
		return Config{}, errors.New("REDIS_URL is required")
	}
	if len(cfg.JWTSigningKey) < 32 {
		return Config{}, errors.New("JWT_SIGNING_KEY must be at least 32 bytes")
	}
	if strings.EqualFold(cfg.Environment, "production") && !cfg.RefreshCookieSecure {
		return Config{}, errors.New("REFRESH_COOKIE_SECURE must be true in production")
	}
	if strings.EqualFold(cfg.Environment, "production") && !cfg.SMTPTLS {
		return Config{}, errors.New("SMTP_TLS must be true in production")
	}
	return cfg, nil
}

func value(key, fallback string) string {
	if current := strings.TrimSpace(os.Getenv(key)); current != "" {
		return current
	}
	return fallback
}

func durationValue(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds <= 0 {
		return fallback
	}
	return time.Duration(seconds) * time.Second
}

func intValue(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	result, err := strconv.Atoi(raw)
	if err != nil || result <= 0 {
		return fallback
	}
	return result
}

func boolValue(key string, fallback bool) bool {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	result, err := strconv.ParseBool(raw)
	if err != nil {
		return fallback
	}
	return result
}

func parseLevel(raw string) (slog.Level, error) {
	switch strings.ToLower(raw) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return slog.LevelInfo, fmt.Errorf("unsupported LOG_LEVEL %q", raw)
	}
}
