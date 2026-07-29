package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type registerRequest struct {
	Email         string `json:"email"`
	Password      string `json:"password"`
	DisplayName   string `json:"display_name"`
	WorkspaceName string `json:"workspace_name"`
}

func (handler *Handler) register(writer http.ResponseWriter, request *http.Request) {
	var input registerRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		handler.validationProblem(writer, request, "The request body is invalid.")
		return
	}
	email, err := normalizeEmail(input.Email)
	if err != nil {
		handler.validationProblem(writer, request, "Enter a valid email address.")
		return
	}
	displayName, err := validateName(input.DisplayName, 2, 120)
	if err != nil {
		handler.validationProblem(writer, request, "Display name must contain 2 to 120 characters.")
		return
	}
	workspaceName, err := validateName(input.WorkspaceName, 2, 120)
	if err != nil {
		handler.validationProblem(writer, request, "Workspace name must contain 2 to 120 characters.")
		return
	}
	if !handler.enforceRateLimit(writer, request, "register", email, 5, time.Hour) {
		return
	}
	passwordHash, err := HashPassword(input.Password)
	if err != nil {
		handler.validationProblem(writer, request, err.Error())
		return
	}
	slug, err := NewWorkspaceSlug(workspaceName)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	rawToken, tokenHash, err := NewOpaqueToken()
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}

	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	defer transaction.Rollback(request.Context())

	var userID uuid.UUID
	err = transaction.QueryRow(request.Context(), `
		INSERT INTO users (email, password_hash, display_name)
		VALUES ($1, $2, $3)
		RETURNING id
	`, email, passwordHash, displayName).Scan(&userID)
	if isUniqueViolation(err) {
		handler.problem(writer, request, http.StatusConflict, "email_in_use", "An account already exists for this email.")
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}

	var workspaceID uuid.UUID
	err = transaction.QueryRow(request.Context(), `
		INSERT INTO workspaces (name, slug, created_by)
		VALUES ($1, $2, $3)
		RETURNING id
	`, workspaceName, slug, userID).Scan(&workspaceID)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	var membershipID uuid.UUID
	err = transaction.QueryRow(request.Context(), `
		INSERT INTO workspace_members (workspace_id, user_id, role, status, created_by)
		VALUES ($1, $2, 'admin', 'active', $2)
		RETURNING id
	`, workspaceID, userID).Scan(&membershipID)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	_, err = transaction.Exec(request.Context(), `
		INSERT INTO email_verification_tokens (user_id, workspace_id, token_hash, expires_at)
		VALUES ($1, $2, $3, $4)
	`, userID, workspaceID, tokenHash, handler.now().UTC().Add(verificationTTL))
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := handler.audit(request.Context(), transaction, workspaceID, &userID, "auth.register", "user", &userID, request, map[string]any{
		"membership_id": membershipID,
	}); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := transaction.Commit(request.Context()); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}

	if err := handler.email.SendVerification(request.Context(), email, displayName, rawToken); err != nil {
		handler.logger.ErrorContext(request.Context(), "verification_email_failed", "error", err, "user_id", userID)
	}
	handler.writeJSON(writer, http.StatusAccepted, map[string]string{
		"status": "verification_pending",
		"email":  email,
	})
}

type verifyEmailRequest struct {
	Token string `json:"token"`
}

func (handler *Handler) verifyEmail(writer http.ResponseWriter, request *http.Request) {
	var input verifyEmailRequest
	if err := decodeJSON(writer, request, &input); err != nil || strings.TrimSpace(input.Token) == "" {
		handler.validationProblem(writer, request, "A verification token is required.")
		return
	}
	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	defer transaction.Rollback(request.Context())

	var tokenID, userID, workspaceID uuid.UUID
	var expiresAt time.Time
	var consumedAt, revokedAt *time.Time
	var user User
	var workspace Workspace
	var role Role
	err = transaction.QueryRow(request.Context(), `
		SELECT evt.id, evt.user_id, evt.workspace_id, evt.expires_at, evt.consumed_at, evt.revoked_at,
		       u.email, u.display_name, u.email_verified_at,
		       w.name, w.slug, wm.role
		FROM email_verification_tokens evt
		JOIN users u ON u.id = evt.user_id
		JOIN workspaces w ON w.id = evt.workspace_id
		JOIN workspace_members wm ON wm.workspace_id = evt.workspace_id AND wm.user_id = evt.user_id
		WHERE evt.token_hash = $1
		FOR UPDATE OF evt, u, wm
	`, HashToken(input.Token)).Scan(
		&tokenID, &userID, &workspaceID, &expiresAt, &consumedAt, &revokedAt,
		&user.Email, &user.DisplayName, &user.EmailVerifiedAt,
		&workspace.Name, &workspace.Slug, &role,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		handler.problem(writer, request, http.StatusUnauthorized, "invalid_token", "The verification token is invalid.")
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	user.ID = userID
	workspace.ID = workspaceID
	if expiresAt.Before(handler.now().UTC()) {
		handler.problem(writer, request, http.StatusUnauthorized, "token_expired", "The verification token has expired.")
		return
	}
	if consumedAt != nil || revokedAt != nil {
		handler.problem(writer, request, http.StatusUnauthorized, "invalid_token", "The verification token is no longer active.")
		return
	}
	_, err = transaction.Exec(request.Context(), `
		UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1
	`, userID)
	if err == nil {
		_, err = transaction.Exec(request.Context(), `
			UPDATE email_verification_tokens SET consumed_at = now() WHERE id = $1
		`, tokenID)
	}
	if err == nil {
		_, err = transaction.Exec(request.Context(), `
			UPDATE email_verification_tokens SET revoked_at = now()
			WHERE user_id = $1 AND id <> $2 AND consumed_at IS NULL AND revoked_at IS NULL
		`, userID, tokenID)
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	now := handler.now().UTC()
	user.EmailVerifiedAt = &now
	issued, err := handler.issueSession(request.Context(), transaction, user, workspace, role, false, uuid.New())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := handler.audit(request.Context(), transaction, workspaceID, &userID, "auth.email_verified", "user", &userID, request, nil); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := transaction.Commit(request.Context()); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	handler.setRefreshCookie(writer, issued.rawRefresh, issued.remember)
	handler.writeJSON(writer, http.StatusOK, issued.response)
}

type resendVerificationRequest struct {
	Email string `json:"email"`
}

func (handler *Handler) resendVerification(writer http.ResponseWriter, request *http.Request) {
	var input resendVerificationRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		handler.validationProblem(writer, request, "The request body is invalid.")
		return
	}
	email, err := normalizeEmail(input.Email)
	if err != nil {
		handler.validationProblem(writer, request, "Enter a valid email address.")
		return
	}
	if !handler.enforceRateLimit(writer, request, "resend-verification", email, 3, time.Hour) {
		return
	}

	var userID, workspaceID uuid.UUID
	var displayName string
	err = handler.database.QueryRow(request.Context(), `
		SELECT u.id, u.display_name, wm.workspace_id
		FROM users u
		JOIN workspace_members wm ON wm.user_id = u.id AND wm.deleted_at IS NULL
		WHERE lower(u.email) = $1
		  AND u.email_verified_at IS NULL
		  AND u.is_active = true
		  AND u.deleted_at IS NULL
		ORDER BY wm.created_at
		LIMIT 1
	`, email).Scan(&userID, &displayName, &workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		handler.writeJSON(writer, http.StatusAccepted, map[string]string{"status": "verification_pending"})
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	rawToken, tokenHash, err := NewOpaqueToken()
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	defer transaction.Rollback(request.Context())
	_, err = transaction.Exec(request.Context(), `
		UPDATE email_verification_tokens
		SET revoked_at = now()
		WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
	`, userID)
	if err == nil {
		_, err = transaction.Exec(request.Context(), `
			INSERT INTO email_verification_tokens (user_id, workspace_id, token_hash, expires_at)
			VALUES ($1, $2, $3, $4)
		`, userID, workspaceID, tokenHash, handler.now().UTC().Add(verificationTTL))
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := handler.audit(request.Context(), transaction, workspaceID, &userID, "auth.verification_resent", "user", &userID, request, nil); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := transaction.Commit(request.Context()); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := handler.email.SendVerification(request.Context(), email, displayName, rawToken); err != nil {
		handler.logger.ErrorContext(request.Context(), "verification_email_failed", "error", err, "user_id", userID)
	}
	handler.writeJSON(writer, http.StatusAccepted, map[string]string{"status": "verification_pending"})
}

type loginRequest struct {
	Email      string `json:"email"`
	Password   string `json:"password"`
	RememberMe bool   `json:"remember_me"`
}

func (handler *Handler) login(writer http.ResponseWriter, request *http.Request) {
	var input loginRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		handler.validationProblem(writer, request, "The request body is invalid.")
		return
	}
	email, err := normalizeEmail(input.Email)
	if err != nil {
		handler.problem(writer, request, http.StatusUnauthorized, "invalid_credentials", "Email or password is incorrect.")
		return
	}
	if !handler.enforceRateLimit(writer, request, "login", email, 10, 15*time.Minute) {
		return
	}

	var user User
	var passwordHash string
	var active bool
	err = handler.database.QueryRow(request.Context(), `
		SELECT id, email, password_hash, display_name, email_verified_at, is_active
		FROM users
		WHERE lower(email) = $1 AND deleted_at IS NULL
	`, email).Scan(&user.ID, &user.Email, &passwordHash, &user.DisplayName, &user.EmailVerifiedAt, &active)
	if errors.Is(err, pgx.ErrNoRows) {
		burnPassword(input.Password)
		handler.problem(writer, request, http.StatusUnauthorized, "invalid_credentials", "Email or password is incorrect.")
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if !VerifyPassword(passwordHash, input.Password) || !active {
		handler.problem(writer, request, http.StatusUnauthorized, "invalid_credentials", "Email or password is incorrect.")
		return
	}
	if user.EmailVerifiedAt == nil {
		handler.problem(writer, request, http.StatusForbidden, "email_verification_required", "Verify your email before signing in.")
		return
	}

	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	defer transaction.Rollback(request.Context())
	var workspace Workspace
	var role Role
	err = transaction.QueryRow(request.Context(), `
		SELECT w.id, w.name, w.slug, wm.role
		FROM workspace_members wm
		JOIN workspaces w ON w.id = wm.workspace_id
		WHERE wm.user_id = $1
		  AND wm.deleted_at IS NULL
		  AND wm.status = 'active'
		  AND w.deleted_at IS NULL
		ORDER BY wm.last_accessed_at DESC NULLS LAST, wm.created_at
		LIMIT 1
		FOR UPDATE OF wm
	`, user.ID).Scan(&workspace.ID, &workspace.Name, &workspace.Slug, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		handler.problem(writer, request, http.StatusForbidden, "membership_inactive", "No active workspace membership is available.")
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	issued, err := handler.issueSession(request.Context(), transaction, user, workspace, role, input.RememberMe, uuid.New())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := handler.audit(request.Context(), transaction, workspace.ID, &user.ID, "auth.login", "user", &user.ID, request, nil); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := transaction.Commit(request.Context()); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	handler.setRefreshCookie(writer, issued.rawRefresh, issued.remember)
	handler.writeJSON(writer, http.StatusOK, issued.response)
}

type issuedSession struct {
	tokenID    uuid.UUID
	rawRefresh string
	remember   bool
	response   SessionResponse
}

type refreshState int

const (
	refreshActive refreshState = iota
	refreshExpired
	refreshWithinGrace
	refreshReused
)

func classifyRefresh(expiresAt time.Time, revokedAt *time.Time, replacedBy *uuid.UUID, now time.Time) refreshState {
	if expiresAt.Before(now) {
		return refreshExpired
	}
	if revokedAt == nil && replacedBy == nil {
		return refreshActive
	}
	if replacedBy != nil && revokedAt != nil && now.Sub(*revokedAt) <= refreshReuseGrace {
		return refreshWithinGrace
	}
	return refreshReused
}

func (handler *Handler) issueSession(ctx context.Context, transaction pgx.Tx, user User, workspace Workspace, role Role, remember bool, familyID uuid.UUID) (issuedSession, error) {
	raw, hash, err := NewOpaqueToken()
	if err != nil {
		return issuedSession{}, err
	}
	ttl := refreshTTL
	if remember {
		ttl = rememberRefreshTTL
	}
	tokenID := uuid.New()
	_, err = transaction.Exec(ctx, `
		INSERT INTO refresh_tokens (
			id, workspace_id, user_id, token_hash, family_id, expires_at, remember_me
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, tokenID, workspace.ID, user.ID, hash, familyID, handler.now().UTC().Add(ttl), remember)
	if err == nil {
		_, err = transaction.Exec(ctx, `
		UPDATE workspace_members
		SET last_accessed_at = now(), updated_at = now()
			WHERE workspace_id = $1 AND user_id = $2 AND deleted_at IS NULL
		`, workspace.ID, user.ID)
	}
	if err != nil {
		return issuedSession{}, fmt.Errorf("persist session: %w", err)
	}
	access, err := handler.jwt.Sign(Principal{
		UserID:      user.ID,
		WorkspaceID: workspace.ID,
		Role:        role,
		FamilyID:    familyID,
	})
	if err != nil {
		return issuedSession{}, err
	}
	return issuedSession{
		tokenID:    tokenID,
		rawRefresh: raw,
		remember:   remember,
		response: SessionResponse{
			AccessToken: access,
			TokenType:   "Bearer",
			ExpiresIn:   int64(accessTokenTTL.Seconds()),
			User:        user,
			Workspace:   workspace,
			Role:        role,
		},
	}, nil
}

func (handler *Handler) refresh(writer http.ResponseWriter, request *http.Request) {
	cookie, err := request.Cookie(refreshCookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		handler.problem(writer, request, http.StatusUnauthorized, "invalid_token", "A refresh token is required.")
		return
	}
	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	defer transaction.Rollback(request.Context())

	var tokenID, userID, workspaceID, familyID uuid.UUID
	var expiresAt, createdAt time.Time
	var revokedAt *time.Time
	var replacedBy *uuid.UUID
	var remember bool
	err = transaction.QueryRow(request.Context(), `
		SELECT id, user_id, workspace_id, family_id, expires_at, created_at,
		       revoked_at, replaced_by, remember_me
		FROM refresh_tokens
		WHERE token_hash = $1
		FOR UPDATE
	`, HashToken(cookie.Value)).Scan(
		&tokenID, &userID, &workspaceID, &familyID, &expiresAt, &createdAt,
		&revokedAt, &replacedBy, &remember,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		handler.clearRefreshCookie(writer)
		handler.problem(writer, request, http.StatusUnauthorized, "invalid_token", "The refresh token is invalid.")
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	now := handler.now().UTC()
	switch classifyRefresh(expiresAt, revokedAt, replacedBy, now) {
	case refreshExpired:
		_, _ = transaction.Exec(request.Context(), `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1`, tokenID)
		_ = transaction.Commit(request.Context())
		handler.clearRefreshCookie(writer)
		handler.problem(writer, request, http.StatusUnauthorized, "token_expired", "The refresh token has expired.")
		return
	case refreshWithinGrace:
		handler.problem(writer, request, http.StatusConflict, "refresh_already_rotated", "This refresh request was already completed.")
		return
	case refreshReused:
		_, err = transaction.Exec(request.Context(), `
			UPDATE refresh_tokens
			SET revoked_at = COALESCE(revoked_at, now())
			WHERE family_id = $1 AND revoked_at IS NULL
		`, familyID)
		if err != nil {
			handler.internalProblem(writer, request, err)
			return
		}
		if err := handler.audit(request.Context(), transaction, workspaceID, &userID, "auth.refresh_reuse", "refresh_token", &tokenID, request, nil); err != nil {
			handler.internalProblem(writer, request, err)
			return
		}
		if err := transaction.Commit(request.Context()); err != nil {
			handler.internalProblem(writer, request, err)
			return
		}
		handler.clearRefreshCookie(writer)
		handler.problem(writer, request, http.StatusUnauthorized, "refresh_reuse_detected", "Refresh token reuse was detected and the session was revoked.")
		return
	}

	var user User
	var workspace Workspace
	var role Role
	err = transaction.QueryRow(request.Context(), `
		SELECT u.id, u.email, u.display_name, u.email_verified_at,
		       w.id, w.name, w.slug, wm.role
		FROM users u
		JOIN workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = $2
		JOIN workspaces w ON w.id = wm.workspace_id
		WHERE u.id = $1
		  AND u.is_active = true
		  AND u.deleted_at IS NULL
		  AND u.email_verified_at IS NOT NULL
		  AND wm.status = 'active'
		  AND wm.deleted_at IS NULL
		  AND w.deleted_at IS NULL
		FOR UPDATE OF wm
	`, userID, workspaceID).Scan(
		&user.ID, &user.Email, &user.DisplayName, &user.EmailVerifiedAt,
		&workspace.ID, &workspace.Name, &workspace.Slug, &role,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		handler.clearRefreshCookie(writer)
		handler.problem(writer, request, http.StatusForbidden, "membership_inactive", "The workspace membership is inactive.")
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	issued, err := handler.issueSession(request.Context(), transaction, user, workspace, role, remember, familyID)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	_, err = transaction.Exec(request.Context(), `
		UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1
	`, tokenID, issued.tokenID)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := transaction.Commit(request.Context()); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	handler.setRefreshCookie(writer, issued.rawRefresh, issued.remember)
	handler.writeJSON(writer, http.StatusOK, issued.response)
}

func (handler *Handler) logout(writer http.ResponseWriter, request *http.Request) {
	principal, _ := PrincipalFromContext(request.Context())
	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	defer transaction.Rollback(request.Context())
	_, err = transaction.Exec(request.Context(), `
		UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
		WHERE family_id = $1
	`, principal.FamilyID)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := handler.audit(request.Context(), transaction, principal.WorkspaceID, &principal.UserID, "auth.logout", "user", &principal.UserID, request, nil); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := transaction.Commit(request.Context()); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	handler.clearRefreshCookie(writer)
	writer.WriteHeader(http.StatusNoContent)
}

func isUniqueViolation(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) && databaseError.Code == "23505"
}
