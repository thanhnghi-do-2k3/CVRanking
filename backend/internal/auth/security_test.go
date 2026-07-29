package auth

import (
	"bytes"
	"strings"
	"testing"
)

func TestPasswordHashRoundTrip(t *testing.T) {
	const password = "Correct-Horse-Battery-2026"
	encoded, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	if !strings.HasPrefix(encoded, "$argon2id$") {
		t.Fatalf("unexpected password format %q", encoded)
	}
	if !VerifyPassword(encoded, password) {
		t.Fatal("valid password was rejected")
	}
	if VerifyPassword(encoded, password+"!") {
		t.Fatal("invalid password was accepted")
	}
}

func TestPasswordPolicy(t *testing.T) {
	if _, err := HashPassword("too-short"); err == nil {
		t.Fatal("expected a minimum length error")
	}
	if _, err := HashPassword(strings.Repeat("a", 129)); err == nil {
		t.Fatal("expected a maximum length error")
	}
}

func TestOpaqueTokensAreHashedAndUnique(t *testing.T) {
	first, firstHash, err := NewOpaqueToken()
	if err != nil {
		t.Fatalf("NewOpaqueToken() error = %v", err)
	}
	second, secondHash, err := NewOpaqueToken()
	if err != nil {
		t.Fatalf("NewOpaqueToken() error = %v", err)
	}
	if first == second || bytes.Equal(firstHash, secondHash) {
		t.Fatal("opaque tokens must be unique")
	}
	if !bytes.Equal(firstHash, HashToken(first)) {
		t.Fatal("stored hash does not match the raw token")
	}
	if bytes.Contains(firstHash, []byte(first)) {
		t.Fatal("hash unexpectedly contains the raw token")
	}
}

func TestWorkspaceSlugNormalizesUnicode(t *testing.T) {
	slug, err := NewWorkspaceSlug("  Đội Tuyển Dụng Hà Nội ")
	if err != nil {
		t.Fatalf("NewWorkspaceSlug() error = %v", err)
	}
	if !strings.HasPrefix(slug, "doi-tuyen-dung-ha-noi-") {
		t.Fatalf("slug = %q", slug)
	}
}
