package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/talentrank/talentrank/backend/internal/platform/httpserver"
)

func DecodeJSON(writer http.ResponseWriter, request *http.Request, destination any, maxBytes int64) error {
	request.Body = http.MaxBytesReader(writer, request.Body, maxBytes)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}

func WriteJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func Problem(writer http.ResponseWriter, request *http.Request, status int, code, detail string) {
	writer.Header().Set("Content-Type", "application/problem+json")
	WriteJSON(writer, status, map[string]any{
		"type":       "https://talentrank.local/problems/" + code,
		"title":      http.StatusText(status),
		"status":     status,
		"code":       code,
		"detail":     detail,
		"request_id": httpserver.RequestID(request.Context()),
	})
}

func Internal(writer http.ResponseWriter, request *http.Request, logger *slog.Logger, err error) {
	logger.ErrorContext(
		request.Context(),
		"business_request_failed",
		"error", err,
		"request_id", httpserver.RequestID(request.Context()),
		"correlation_id", httpserver.CorrelationID(request.Context()),
	)
	Problem(
		writer,
		request,
		http.StatusInternalServerError,
		"internal_error",
		"The request could not be completed.",
	)
}
