package httpserver

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/talentrank/talentrank/backend/internal/platform/health"
)

type Options struct {
	ServiceName    string
	Version        string
	BasePath       string
	Logger         *slog.Logger
	Readiness      health.Checker
	RegisterRoutes func(chi.Router, string)
}

func New(options Options) http.Handler {
	router := chi.NewRouter()
	router.Use(chimiddleware.RealIP)
	router.Use(chimiddleware.Recoverer)
	router.Use(Identity)
	router.Use(TraceRequests(options.ServiceName))
	router.Use(LogRequests(options.Logger))

	basePath := strings.TrimSuffix(options.BasePath, "/")
	router.Get(basePath+"/healthz", func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(writer, http.StatusOK, map[string]string{
			"status":  "ok",
			"service": options.ServiceName,
			"version": options.Version,
		})
	})
	router.Get(basePath+"/readyz", func(writer http.ResponseWriter, request *http.Request) {
		ctx, cancel := context.WithTimeout(request.Context(), 3*time.Second)
		defer cancel()
		if err := options.Readiness.Ready(ctx); err != nil {
			writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
				"type":       "about:blank",
				"title":      "Service unavailable",
				"status":     http.StatusServiceUnavailable,
				"code":       "dependency_unavailable",
				"detail":     "One or more required dependencies are unavailable.",
				"request_id": RequestID(request.Context()),
			})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]string{
			"status":  "ok",
			"service": options.ServiceName,
			"version": options.Version,
		})
	})
	if options.RegisterRoutes != nil {
		options.RegisterRoutes(router, basePath)
	}

	return router
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
