package auth

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestRequireAdminRoleMatrix(t *testing.T) {
	handler := &Handler{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	next := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	})
	tests := []struct {
		role Role
		want int
	}{
		{role: RoleAdmin, want: http.StatusNoContent},
		{role: RoleRecruiter, want: http.StatusForbidden},
		{role: RoleHiringManager, want: http.StatusForbidden},
	}
	for _, test := range tests {
		t.Run(string(test.role), func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/workspace/invitations", nil)
			principal := Principal{
				UserID: uuid.New(), WorkspaceID: uuid.New(), FamilyID: uuid.New(), Role: test.role,
			}
			request = request.WithContext(context.WithValue(request.Context(), principalKey{}, principal))
			recorder := httptest.NewRecorder()

			handler.requireAdmin(next).ServeHTTP(recorder, request)

			if recorder.Code != test.want {
				t.Fatalf("status = %d, want %d", recorder.Code, test.want)
			}
		})
	}
}

func TestRateLimitKeyDoesNotExposeIdentity(t *testing.T) {
	const email = "private.person@example.com"
	key := rateLimitKey("login", email)
	if strings.Contains(key, email) {
		t.Fatalf("rate limit key leaks identity: %q", key)
	}
	if key != rateLimitKey("login", email) {
		t.Fatal("rate limit key is not deterministic")
	}
	if key == rateLimitKey("register", email) {
		t.Fatal("rate limit events must have independent keys")
	}
}
