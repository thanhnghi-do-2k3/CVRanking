package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const accessTokenTTL = 15 * time.Minute

type Claims struct {
	Issuer      string    `json:"iss"`
	Subject     string    `json:"sub"`
	UserID      uuid.UUID `json:"user_id"`
	WorkspaceID uuid.UUID `json:"workspace_id"`
	Role        Role      `json:"role"`
	FamilyID    uuid.UUID `json:"family_id"`
	IssuedAt    int64     `json:"iat"`
	ExpiresAt   int64     `json:"exp"`
}

type JWTManager struct {
	key    []byte
	issuer string
	now    func() time.Time
}

func NewJWTManager(key, issuer string) (*JWTManager, error) {
	if len(key) < 32 {
		return nil, errors.New("JWT signing key must be at least 32 bytes")
	}
	return &JWTManager{key: []byte(key), issuer: issuer, now: time.Now}, nil
}

func (manager *JWTManager) Sign(principal Principal) (string, error) {
	now := manager.now().UTC()
	claims := Claims{
		Issuer:      manager.issuer,
		Subject:     principal.UserID.String(),
		UserID:      principal.UserID,
		WorkspaceID: principal.WorkspaceID,
		Role:        principal.Role,
		FamilyID:    principal.FamilyID,
		IssuedAt:    now.Unix(),
		ExpiresAt:   now.Add(accessTokenTTL).Unix(),
	}
	header, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("marshal claims: %w", err)
	}
	unsigned := encodeSegment(header) + "." + encodeSegment(payload)
	return unsigned + "." + encodeSegment(manager.signature(unsigned)), nil
}

func (manager *JWTManager) Parse(raw string) (Claims, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return Claims{}, errTokenInvalid
	}
	unsigned := parts[0] + "." + parts[1]
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(signature, manager.signature(unsigned)) {
		return Claims{}, errTokenInvalid
	}
	headerValue, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, errTokenInvalid
	}
	var header map[string]string
	if json.Unmarshal(headerValue, &header) != nil || header["alg"] != "HS256" || header["typ"] != "JWT" {
		return Claims{}, errTokenInvalid
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, errTokenInvalid
	}
	var claims Claims
	if json.Unmarshal(payload, &claims) != nil ||
		claims.Issuer != manager.issuer ||
		claims.Subject != claims.UserID.String() ||
		claims.UserID == uuid.Nil ||
		claims.WorkspaceID == uuid.Nil ||
		claims.FamilyID == uuid.Nil ||
		!claims.Role.Valid() {
		return Claims{}, errTokenInvalid
	}
	now := manager.now().UTC().Unix()
	if claims.ExpiresAt <= now {
		return Claims{}, errTokenExpired
	}
	if claims.IssuedAt > now+30 {
		return Claims{}, errTokenInvalid
	}
	return claims, nil
}

func (manager *JWTManager) signature(value string) []byte {
	mac := hmac.New(sha256.New, manager.key)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

func encodeSegment(value []byte) string {
	return base64.RawURLEncoding.EncodeToString(value)
}
