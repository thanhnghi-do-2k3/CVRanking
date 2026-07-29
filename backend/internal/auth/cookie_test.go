package auth

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRefreshCookieSecurityAttributes(t *testing.T) {
	handler := &Handler{
		logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		cookieSecure: true,
		now:          func() time.Time { return time.Date(2026, 7, 26, 0, 0, 0, 0, time.UTC) },
	}
	recorder := httptest.NewRecorder()
	handler.setRefreshCookie(recorder, "secret", true)
	response := recorder.Result()
	cookies := response.Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies = %d", len(cookies))
	}
	cookie := cookies[0]
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("unsafe cookie %#v", cookie)
	}
	if cookie.Path != "/api/v1/auth" {
		t.Fatalf("cookie path = %q", cookie.Path)
	}
	if cookie.MaxAge != int(rememberRefreshTTL.Seconds()) {
		t.Fatalf("cookie MaxAge = %d", cookie.MaxAge)
	}
	if strings.Contains(recorder.Header().Get("Set-Cookie"), "SameSite=None") {
		t.Fatal("unexpected cross-site cookie")
	}
}
