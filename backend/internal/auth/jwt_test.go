package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestJWTClaimsRoundTrip(t *testing.T) {
	manager, err := NewJWTManager(strings.Repeat("k", 32), "test")
	if err != nil {
		t.Fatalf("NewJWTManager() error = %v", err)
	}
	now := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC)
	manager.now = func() time.Time { return now }
	principal := Principal{
		UserID:      uuid.New(),
		WorkspaceID: uuid.New(),
		Role:        RoleRecruiter,
		FamilyID:    uuid.New(),
	}
	raw, err := manager.Sign(principal)
	if err != nil {
		t.Fatalf("Sign() error = %v", err)
	}
	claims, err := manager.Parse(raw)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if claims.UserID != principal.UserID ||
		claims.WorkspaceID != principal.WorkspaceID ||
		claims.Role != principal.Role ||
		claims.FamilyID != principal.FamilyID {
		t.Fatalf("claims = %#v", claims)
	}
	if claims.ExpiresAt-claims.IssuedAt != int64(accessTokenTTL.Seconds()) {
		t.Fatalf("unexpected TTL %d", claims.ExpiresAt-claims.IssuedAt)
	}
}

func TestJWTRejectsTamperingAndExpiry(t *testing.T) {
	manager, _ := NewJWTManager(strings.Repeat("k", 32), "test")
	now := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC)
	manager.now = func() time.Time { return now }
	raw, _ := manager.Sign(Principal{
		UserID: uuid.New(), WorkspaceID: uuid.New(), Role: RoleAdmin, FamilyID: uuid.New(),
	})
	if _, err := manager.Parse(raw + "x"); !errors.Is(err, errTokenInvalid) {
		t.Fatalf("tampered token error = %v", err)
	}
	manager.now = func() time.Time { return now.Add(accessTokenTTL + time.Second) }
	if _, err := manager.Parse(raw); !errors.Is(err, errTokenExpired) {
		t.Fatalf("expired token error = %v", err)
	}
}

func TestJWTRequiresLongSigningKey(t *testing.T) {
	if _, err := NewJWTManager("short", "test"); err == nil {
		t.Fatal("expected a signing key error")
	}
}
