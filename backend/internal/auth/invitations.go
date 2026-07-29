package auth

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type invitationResponse struct {
	ID            uuid.UUID  `json:"id"`
	Email         string     `json:"email"`
	Role          Role       `json:"role"`
	Status        string     `json:"status"`
	ExpiresAt     time.Time  `json:"expires_at"`
	CreatedAt     time.Time  `json:"created_at"`
	AcceptedAt    *time.Time `json:"accepted_at,omitempty"`
	InvitedByName string     `json:"invited_by_name"`
}

func (handler *Handler) listInvitations(writer http.ResponseWriter, request *http.Request) {
	principal, _ := PrincipalFromContext(request.Context())
	rows, err := handler.database.Query(request.Context(), `
		SELECT wi.id, wi.email, wi.role,
		       CASE WHEN wi.status = 'pending' AND wi.expires_at <= now() THEN 'expired' ELSE wi.status END,
		       wi.expires_at, wi.created_at, wi.accepted_at, u.display_name
		FROM workspace_invitations wi
		JOIN users u ON u.id = wi.invited_by
		WHERE wi.workspace_id = $1
		ORDER BY wi.created_at DESC
	`, principal.WorkspaceID)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	defer rows.Close()
	items := make([]invitationResponse, 0)
	for rows.Next() {
		var item invitationResponse
		if err := rows.Scan(
			&item.ID,
			&item.Email,
			&item.Role,
			&item.Status,
			&item.ExpiresAt,
			&item.CreatedAt,
			&item.AcceptedAt,
			&item.InvitedByName,
		); err != nil {
			handler.internalProblem(writer, request, err)
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	handler.writeJSON(writer, http.StatusOK, map[string]any{"items": items})
}

type createInvitationRequest struct {
	Email string `json:"email"`
	Role  Role   `json:"role"`
}

func (handler *Handler) createInvitation(writer http.ResponseWriter, request *http.Request) {
	principal, _ := PrincipalFromContext(request.Context())
	var input createInvitationRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		handler.validationProblem(writer, request, "The request body is invalid.")
		return
	}
	email, err := normalizeEmail(input.Email)
	if err != nil {
		handler.validationProblem(writer, request, "Enter a valid email address.")
		return
	}
	if !input.Role.Valid() {
		handler.validationProblem(writer, request, "The role is invalid.")
		return
	}
	if !handler.enforceRateLimit(writer, request, "invitation", principal.UserID.String(), 30, time.Hour) {
		return
	}
	var alreadyMember bool
	err = handler.database.QueryRow(request.Context(), `
		SELECT EXISTS (
			SELECT 1
			FROM users u
			JOIN workspace_members wm ON wm.user_id = u.id
			WHERE lower(u.email) = $1
			  AND wm.workspace_id = $2
			  AND wm.deleted_at IS NULL
		)
	`, email, principal.WorkspaceID).Scan(&alreadyMember)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if alreadyMember {
		handler.problem(writer, request, http.StatusConflict, "already_member", "This user is already a workspace member.")
		return
	}
	raw, hash, err := NewOpaqueToken()
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
	var invitation invitationResponse
	err = transaction.QueryRow(request.Context(), `
		INSERT INTO workspace_invitations (
			workspace_id, email, role, token_hash, invited_by, expires_at
		)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, email, role, status, expires_at, created_at
	`, principal.WorkspaceID, email, input.Role, hash, principal.UserID, handler.now().UTC().Add(invitationTTL)).Scan(
		&invitation.ID,
		&invitation.Email,
		&invitation.Role,
		&invitation.Status,
		&invitation.ExpiresAt,
		&invitation.CreatedAt,
	)
	if isUniqueViolation(err) {
		handler.problem(writer, request, http.StatusConflict, "invitation_pending", "A pending invitation already exists for this email.")
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	var workspaceName string
	err = transaction.QueryRow(request.Context(), `SELECT name FROM workspaces WHERE id = $1`, principal.WorkspaceID).Scan(&workspaceName)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := handler.audit(request.Context(), transaction, principal.WorkspaceID, &principal.UserID, "workspace.invitation_created", "workspace_invitation", &invitation.ID, request, map[string]any{
		"role":  input.Role,
		"email": email,
	}); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := transaction.Commit(request.Context()); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := handler.email.SendInvitation(request.Context(), email, workspaceName, raw, input.Role); err != nil {
		handler.logger.ErrorContext(request.Context(), "invitation_email_failed", "error", err, "invitation_id", invitation.ID)
	}
	handler.writeJSON(writer, http.StatusCreated, invitation)
}

func (handler *Handler) resendInvitation(writer http.ResponseWriter, request *http.Request) {
	principal, _ := PrincipalFromContext(request.Context())
	invitationID, err := uuid.Parse(chiURLParam(request, "invitationId"))
	if err != nil {
		handler.validationProblem(writer, request, "The invitation ID is invalid.")
		return
	}
	if !handler.enforceRateLimit(writer, request, "invitation-resend", principal.UserID.String(), 30, time.Hour) {
		return
	}
	raw, hash, err := NewOpaqueToken()
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
	var email, workspaceName string
	var role Role
	err = transaction.QueryRow(request.Context(), `
		SELECT wi.email, wi.role, w.name
		FROM workspace_invitations wi
		JOIN workspaces w ON w.id = wi.workspace_id
		WHERE wi.id = $1 AND wi.workspace_id = $2 AND wi.status = 'pending'
		FOR UPDATE OF wi
	`, invitationID, principal.WorkspaceID).Scan(&email, &role, &workspaceName)
	if errors.Is(err, pgx.ErrNoRows) {
		handler.problem(writer, request, http.StatusNotFound, "not_found", "The pending invitation was not found.")
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	_, err = transaction.Exec(request.Context(), `
		UPDATE workspace_invitations
		SET token_hash = $3, expires_at = $4, updated_at = now()
		WHERE id = $1 AND workspace_id = $2
	`, invitationID, principal.WorkspaceID, hash, handler.now().UTC().Add(invitationTTL))
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := handler.audit(request.Context(), transaction, principal.WorkspaceID, &principal.UserID, "workspace.invitation_resent", "workspace_invitation", &invitationID, request, nil); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := transaction.Commit(request.Context()); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := handler.email.SendInvitation(request.Context(), email, workspaceName, raw, role); err != nil {
		handler.logger.ErrorContext(request.Context(), "invitation_email_failed", "error", err, "invitation_id", invitationID)
	}
	handler.writeJSON(writer, http.StatusAccepted, map[string]string{"status": "invitation_resent"})
}

func (handler *Handler) revokeInvitation(writer http.ResponseWriter, request *http.Request) {
	principal, _ := PrincipalFromContext(request.Context())
	invitationID, err := uuid.Parse(chiURLParam(request, "invitationId"))
	if err != nil {
		handler.validationProblem(writer, request, "The invitation ID is invalid.")
		return
	}
	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	defer transaction.Rollback(request.Context())
	tag, err := transaction.Exec(request.Context(), `
		UPDATE workspace_invitations
		SET status = 'revoked', revoked_at = now(), updated_at = now()
		WHERE id = $1 AND workspace_id = $2 AND status = 'pending'
	`, invitationID, principal.WorkspaceID)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if tag.RowsAffected() == 0 {
		handler.problem(writer, request, http.StatusNotFound, "not_found", "The pending invitation was not found.")
		return
	}
	if err := handler.audit(request.Context(), transaction, principal.WorkspaceID, &principal.UserID, "workspace.invitation_revoked", "workspace_invitation", &invitationID, request, nil); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := transaction.Commit(request.Context()); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

type invitationTokenRequest struct {
	Token       string `json:"token"`
	DisplayName string `json:"display_name,omitempty"`
	Password    string `json:"password,omitempty"`
}

func (handler *Handler) inspectInvitation(writer http.ResponseWriter, request *http.Request) {
	var input invitationTokenRequest
	if err := decodeJSON(writer, request, &input); err != nil || strings.TrimSpace(input.Token) == "" {
		handler.validationProblem(writer, request, "An invitation token is required.")
		return
	}
	var response struct {
		Email         string    `json:"email"`
		Role          Role      `json:"role"`
		Workspace     Workspace `json:"workspace"`
		ExpiresAt     time.Time `json:"expires_at"`
		AccountExists bool      `json:"account_exists"`
	}
	var status string
	err := handler.database.QueryRow(request.Context(), `
		SELECT wi.email, wi.role, w.id, w.name, w.slug, wi.expires_at, wi.status,
		       EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(wi.email) AND u.deleted_at IS NULL)
		FROM workspace_invitations wi
		JOIN workspaces w ON w.id = wi.workspace_id
		WHERE wi.token_hash = $1
	`, HashToken(input.Token)).Scan(
		&response.Email,
		&response.Role,
		&response.Workspace.ID,
		&response.Workspace.Name,
		&response.Workspace.Slug,
		&response.ExpiresAt,
		&status,
		&response.AccountExists,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		handler.problem(writer, request, http.StatusUnauthorized, "invalid_token", "The invitation token is invalid.")
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if response.ExpiresAt.Before(handler.now().UTC()) {
		handler.problem(writer, request, http.StatusUnauthorized, "token_expired", "The invitation has expired.")
		return
	}
	if status != "pending" {
		handler.problem(writer, request, http.StatusConflict, "invitation_inactive", "The invitation is no longer active.")
		return
	}
	handler.writeJSON(writer, http.StatusOK, response)
}

func (handler *Handler) acceptInvitation(writer http.ResponseWriter, request *http.Request) {
	var input invitationTokenRequest
	if err := decodeJSON(writer, request, &input); err != nil || strings.TrimSpace(input.Token) == "" {
		handler.validationProblem(writer, request, "An invitation token is required.")
		return
	}
	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	defer transaction.Rollback(request.Context())

	var invitationID, workspaceID, invitedBy uuid.UUID
	var email, workspaceName, workspaceSlug, status string
	var role Role
	var expiresAt time.Time
	err = transaction.QueryRow(request.Context(), `
		SELECT wi.id, wi.workspace_id, wi.invited_by, wi.email, wi.role,
		       wi.status, wi.expires_at, w.name, w.slug
		FROM workspace_invitations wi
		JOIN workspaces w ON w.id = wi.workspace_id
		WHERE wi.token_hash = $1
		FOR UPDATE OF wi
	`, HashToken(input.Token)).Scan(
		&invitationID, &workspaceID, &invitedBy, &email, &role,
		&status, &expiresAt, &workspaceName, &workspaceSlug,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		handler.problem(writer, request, http.StatusUnauthorized, "invalid_token", "The invitation token is invalid.")
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if expiresAt.Before(handler.now().UTC()) {
		handler.problem(writer, request, http.StatusUnauthorized, "token_expired", "The invitation has expired.")
		return
	}
	if status != "pending" {
		handler.problem(writer, request, http.StatusConflict, "invitation_inactive", "The invitation is no longer active.")
		return
	}

	var user User
	var active bool
	err = transaction.QueryRow(request.Context(), `
		SELECT id, email, display_name, email_verified_at, is_active
		FROM users
		WHERE lower(email) = lower($1) AND deleted_at IS NULL
		FOR UPDATE
	`, email).Scan(&user.ID, &user.Email, &user.DisplayName, &user.EmailVerifiedAt, &active)
	if errors.Is(err, pgx.ErrNoRows) {
		displayName, nameErr := validateName(input.DisplayName, 2, 120)
		if nameErr != nil {
			handler.validationProblem(writer, request, "Display name is required for a new account.")
			return
		}
		passwordHash, passwordErr := HashPassword(input.Password)
		if passwordErr != nil {
			handler.validationProblem(writer, request, passwordErr.Error())
			return
		}
		err = transaction.QueryRow(request.Context(), `
			INSERT INTO users (email, password_hash, display_name, email_verified_at)
			VALUES ($1, $2, $3, now())
			RETURNING id, email, display_name, email_verified_at
		`, email, passwordHash, displayName).Scan(&user.ID, &user.Email, &user.DisplayName, &user.EmailVerifiedAt)
		active = true
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if !active {
		handler.problem(writer, request, http.StatusForbidden, "account_inactive", "The account is inactive.")
		return
	}
	if user.EmailVerifiedAt == nil {
		err = transaction.QueryRow(request.Context(), `
			UPDATE users SET email_verified_at = now(), updated_at = now()
			WHERE id = $1
			RETURNING email_verified_at
		`, user.ID).Scan(&user.EmailVerifiedAt)
		if err != nil {
			handler.internalProblem(writer, request, err)
			return
		}
	}

	var memberID uuid.UUID
	var deletedAt *time.Time
	err = transaction.QueryRow(request.Context(), `
		SELECT id, deleted_at
		FROM workspace_members
		WHERE workspace_id = $1 AND user_id = $2
		ORDER BY created_at DESC
		LIMIT 1
		FOR UPDATE
	`, workspaceID, user.ID).Scan(&memberID, &deletedAt)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		err = transaction.QueryRow(request.Context(), `
			INSERT INTO workspace_members (workspace_id, user_id, role, status, created_by)
			VALUES ($1, $2, $3, 'active', $4)
			RETURNING id
		`, workspaceID, user.ID, role, invitedBy).Scan(&memberID)
	case err == nil:
		_, err = transaction.Exec(request.Context(), `
			UPDATE workspace_members
			SET role = $3, status = 'active', deleted_at = NULL, updated_at = now()
			WHERE id = $1 AND workspace_id = $2
		`, memberID, workspaceID, role)
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	_, err = transaction.Exec(request.Context(), `
		UPDATE workspace_invitations
		SET status = 'accepted', accepted_by = $2, accepted_at = now(), updated_at = now()
		WHERE id = $1
	`, invitationID, user.ID)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	workspace := Workspace{ID: workspaceID, Name: workspaceName, Slug: workspaceSlug}
	issued, err := handler.issueSession(request.Context(), transaction, user, workspace, role, false, uuid.New())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := handler.audit(request.Context(), transaction, workspaceID, &user.ID, "workspace.invitation_accepted", "workspace_invitation", &invitationID, request, map[string]any{
		"membership_id": memberID,
	}); err != nil {
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
