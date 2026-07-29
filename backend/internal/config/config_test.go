package config

import "testing"

func TestLoadRequiresDependencyURLs(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("REDIS_URL", "")
	t.Setenv("JWT_SIGNING_KEY", "")

	if _, err := Load(); err == nil {
		t.Fatal("expected a validation error")
	}
}

func TestLoadUsesExplicitValues(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://example")
	t.Setenv("JWT_SIGNING_KEY", "01234567890123456789012345678901")
	t.Setenv("SERVICE_NAME", "test-api")
	t.Setenv("LOG_LEVEL", "debug")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ServiceName != "test-api" {
		t.Fatalf("ServiceName = %q", cfg.ServiceName)
	}
}

func TestLoadRejectsShortJWTKey(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://example")
	t.Setenv("JWT_SIGNING_KEY", "too-short")

	if _, err := Load(); err == nil {
		t.Fatal("expected a JWT key validation error")
	}
}

func TestLoadRequiresProductionTransportSecurity(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://example")
	t.Setenv("JWT_SIGNING_KEY", "01234567890123456789012345678901")
	t.Setenv("APP_ENV", "production")
	t.Setenv("REFRESH_COOKIE_SECURE", "false")
	t.Setenv("SMTP_TLS", "false")

	if _, err := Load(); err == nil {
		t.Fatal("expected a production transport validation error")
	}
}
