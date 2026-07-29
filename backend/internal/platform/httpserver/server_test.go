package httpserver

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/talentrank/talentrank/backend/internal/platform/health"
)

func TestHealthIncludesIdentityHeaders(t *testing.T) {
	handler := New(Options{
		ServiceName: "test",
		Version:     "1",
		BasePath:    "/api/v1",
		Logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		Readiness:   health.CheckFunc(func(context.Context) error { return nil }),
	})
	request := httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	if response.Header().Get("X-Request-ID") == "" {
		t.Fatal("missing request ID")
	}
	if response.Header().Get("X-Correlation-ID") == "" {
		t.Fatal("missing correlation ID")
	}
}

func TestReadinessHidesDependencyDetail(t *testing.T) {
	handler := New(Options{
		ServiceName: "test",
		Version:     "1",
		BasePath:    "/api/v1",
		Logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		Readiness:   health.CheckFunc(func(context.Context) error { return errors.New("private endpoint detail") }),
	})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", response.Code)
	}
	if body := response.Body.String(); body == "" || contains(body, "private endpoint detail") {
		t.Fatalf("unsafe response body %q", body)
	}
}

func contains(value, fragment string) bool {
	for i := 0; i+len(fragment) <= len(value); i++ {
		if value[i:i+len(fragment)] == fragment {
			return true
		}
	}
	return false
}
