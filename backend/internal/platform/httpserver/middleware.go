package httpserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
)

type identityKey string

const (
	requestIDKey     identityKey = "request_id"
	correlationIDKey identityKey = "correlation_id"
)

func Identity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestID := safeIdentity(request.Header.Get("X-Request-ID"))
		if requestID == "" {
			requestID = randomIdentity()
		}
		correlationID := safeIdentity(request.Header.Get("X-Correlation-ID"))
		if correlationID == "" {
			correlationID = requestID
		}

		ctx := context.WithValue(request.Context(), requestIDKey, requestID)
		ctx = context.WithValue(ctx, correlationIDKey, correlationID)
		writer.Header().Set("X-Request-ID", requestID)
		writer.Header().Set("X-Correlation-ID", correlationID)
		next.ServeHTTP(writer, request.WithContext(ctx))
	})
}

func TraceRequests(serviceName string) func(http.Handler) http.Handler {
	tracer := otel.Tracer(serviceName)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			ctx, span := tracer.Start(request.Context(), request.Method+" "+request.URL.Path)
			defer span.End()
			span.SetAttributes(
				attribute.String("http.request.method", request.Method),
				attribute.String("url.path", request.URL.Path),
				attribute.String("request.id", RequestID(ctx)),
				attribute.String("correlation.id", CorrelationID(ctx)),
			)
			recorder := &statusRecorder{ResponseWriter: writer, status: http.StatusOK}
			next.ServeHTTP(recorder, request.WithContext(ctx))
			span.SetAttributes(attribute.Int("http.response.status_code", recorder.status))
			if recorder.status >= http.StatusInternalServerError {
				span.SetStatus(codes.Error, http.StatusText(recorder.status))
			}
		})
	}
}

func LogRequests(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			started := time.Now()
			recorder := &statusRecorder{ResponseWriter: writer, status: http.StatusOK}
			next.ServeHTTP(recorder, request)
			logger.InfoContext(request.Context(), "http_request",
				"method", request.Method,
				"path", request.URL.Path,
				"status", recorder.status,
				"duration_ms", time.Since(started).Milliseconds(),
				"request_id", RequestID(request.Context()),
				"correlation_id", CorrelationID(request.Context()),
			)
		})
	}
}

func RequestID(ctx context.Context) string {
	value, _ := ctx.Value(requestIDKey).(string)
	return value
}

func CorrelationID(ctx context.Context) string {
	value, _ := ctx.Value(correlationIDKey).(string)
	return value
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (recorder *statusRecorder) WriteHeader(status int) {
	recorder.status = status
	recorder.ResponseWriter.WriteHeader(status)
}

func safeIdentity(value string) string {
	value = strings.TrimSpace(value)
	if len(value) == 0 || len(value) > 128 {
		return ""
	}
	for _, character := range value {
		if character < 0x21 || character > 0x7e {
			return ""
		}
	}
	return value
}

func randomIdentity() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return time.Now().UTC().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(buffer)
}
