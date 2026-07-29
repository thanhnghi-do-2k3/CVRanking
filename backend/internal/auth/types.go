// Package auth owns identity, tenant sessions, RBAC, invitations, and member lifecycle.
package auth

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

type Role string

const (
	RoleAdmin         Role = "admin"
	RoleRecruiter     Role = "recruiter"
	RoleHiringManager Role = "hiring_manager"
)

func (role Role) Valid() bool {
	return role == RoleAdmin || role == RoleRecruiter || role == RoleHiringManager
}

type Principal struct {
	UserID      uuid.UUID
	WorkspaceID uuid.UUID
	Role        Role
	FamilyID    uuid.UUID
}

type principalKey struct{}

func PrincipalFromContext(ctx context.Context) (Principal, bool) {
	principal, ok := ctx.Value(principalKey{}).(Principal)
	return principal, ok
}

type User struct {
	ID              uuid.UUID  `json:"id"`
	Email           string     `json:"email"`
	DisplayName     string     `json:"display_name"`
	EmailVerifiedAt *time.Time `json:"email_verified_at"`
}

type Workspace struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Slug string    `json:"slug"`
}

type Membership struct {
	ID             uuid.UUID  `json:"id"`
	Workspace      Workspace  `json:"workspace"`
	Role           Role       `json:"role"`
	Status         string     `json:"status"`
	LastAccessedAt *time.Time `json:"last_accessed_at,omitempty"`
}

type SessionResponse struct {
	AccessToken string    `json:"access_token"`
	TokenType   string    `json:"token_type"`
	ExpiresIn   int64     `json:"expires_in"`
	User        User      `json:"user"`
	Workspace   Workspace `json:"workspace"`
	Role        Role      `json:"role"`
}

var (
	errLastAdmin    = errors.New("last active admin")
	errTokenExpired = errors.New("token expired")
	errTokenInvalid = errors.New("token invalid")
)
