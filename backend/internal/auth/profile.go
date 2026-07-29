package auth

import (
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (handler *Handler) me(writer http.ResponseWriter, request *http.Request) {
	principal, _ := PrincipalFromContext(request.Context())
	var user User
	err := handler.database.QueryRow(request.Context(), `
		SELECT id, email, display_name, email_verified_at
		FROM users
		WHERE id = $1 AND is_active = true AND deleted_at IS NULL
	`, principal.UserID).Scan(&user.ID, &user.Email, &user.DisplayName, &user.EmailVerifiedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		handler.problem(writer, request, http.StatusUnauthorized, "invalid_token", "The account is inactive.")
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	rows, err := handler.database.Query(request.Context(), `
		SELECT wm.id, w.id, w.name, w.slug, wm.role, wm.status, wm.last_accessed_at
		FROM workspace_members wm
		JOIN workspaces w ON w.id = wm.workspace_id
		WHERE wm.user_id = $1
		  AND wm.deleted_at IS NULL
		  AND w.deleted_at IS NULL
		ORDER BY wm.last_accessed_at DESC NULLS LAST, w.name
	`, principal.UserID)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	defer rows.Close()
	memberships := make([]Membership, 0)
	var current *Workspace
	for rows.Next() {
		var membership Membership
		if err := rows.Scan(
			&membership.ID,
			&membership.Workspace.ID,
			&membership.Workspace.Name,
			&membership.Workspace.Slug,
			&membership.Role,
			&membership.Status,
			&membership.LastAccessedAt,
		); err != nil {
			handler.internalProblem(writer, request, err)
			return
		}
		if membership.Workspace.ID == principal.WorkspaceID {
			value := membership.Workspace
			current = &value
		}
		memberships = append(memberships, membership)
	}
	if err := rows.Err(); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if current == nil {
		handler.problem(writer, request, http.StatusForbidden, "membership_inactive", "The current workspace membership is unavailable.")
		return
	}
	handler.writeJSON(writer, http.StatusOK, map[string]any{
		"user":        user,
		"workspace":   current,
		"role":        principal.Role,
		"memberships": memberships,
	})
}

type switchWorkspaceRequest struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
}

func (handler *Handler) switchWorkspace(writer http.ResponseWriter, request *http.Request) {
	principal, _ := PrincipalFromContext(request.Context())
	var input switchWorkspaceRequest
	if err := decodeJSON(writer, request, &input); err != nil || input.WorkspaceID == uuid.Nil {
		handler.validationProblem(writer, request, "A valid workspace_id is required.")
		return
	}
	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	defer transaction.Rollback(request.Context())

	var user User
	var workspace Workspace
	var role Role
	err = transaction.QueryRow(request.Context(), `
		SELECT u.id, u.email, u.display_name, u.email_verified_at,
		       w.id, w.name, w.slug, wm.role
		FROM workspace_members wm
		JOIN users u ON u.id = wm.user_id
		JOIN workspaces w ON w.id = wm.workspace_id
		WHERE wm.user_id = $1
		  AND wm.workspace_id = $2
		  AND wm.status = 'active'
		  AND wm.deleted_at IS NULL
		  AND u.is_active = true
		  AND u.deleted_at IS NULL
		  AND u.email_verified_at IS NOT NULL
		  AND w.deleted_at IS NULL
		FOR UPDATE OF wm
	`, principal.UserID, input.WorkspaceID).Scan(
		&user.ID, &user.Email, &user.DisplayName, &user.EmailVerifiedAt,
		&workspace.ID, &workspace.Name, &workspace.Slug, &role,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		handler.problem(writer, request, http.StatusForbidden, "membership_inactive", "The target workspace membership is inactive.")
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	var remember bool
	err = transaction.QueryRow(request.Context(), `
		SELECT COALESCE(bool_or(remember_me), false)
		FROM refresh_tokens
		WHERE family_id = $1
	`, principal.FamilyID).Scan(&remember)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	_, err = transaction.Exec(request.Context(), `
		UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1
	`, principal.FamilyID)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	issued, err := handler.issueSession(request.Context(), transaction, user, workspace, role, remember, uuid.New())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := handler.audit(request.Context(), transaction, principal.WorkspaceID, &principal.UserID, "auth.workspace_switched", "workspace", &input.WorkspaceID, request, map[string]any{
		"from_workspace_id": principal.WorkspaceID,
		"to_workspace_id":   input.WorkspaceID,
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
