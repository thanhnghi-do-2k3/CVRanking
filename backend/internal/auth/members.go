package auth

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type memberResponse struct {
	ID             uuid.UUID  `json:"id"`
	User           User       `json:"user"`
	Role           Role       `json:"role"`
	Status         string     `json:"status"`
	LastAccessedAt *time.Time `json:"last_accessed_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

func (handler *Handler) listMembers(writer http.ResponseWriter, request *http.Request) {
	principal, _ := PrincipalFromContext(request.Context())
	rows, err := handler.database.Query(request.Context(), `
		SELECT wm.id, u.id, u.email, u.display_name, u.email_verified_at,
		       wm.role, wm.status, wm.last_accessed_at, wm.created_at
		FROM workspace_members wm
		JOIN users u ON u.id = wm.user_id
		WHERE wm.workspace_id = $1
		  AND wm.deleted_at IS NULL
		  AND u.deleted_at IS NULL
		ORDER BY CASE wm.status WHEN 'active' THEN 0 ELSE 1 END, lower(u.display_name), lower(u.email)
	`, principal.WorkspaceID)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	defer rows.Close()
	members := make([]memberResponse, 0)
	for rows.Next() {
		var member memberResponse
		if err := rows.Scan(
			&member.ID,
			&member.User.ID,
			&member.User.Email,
			&member.User.DisplayName,
			&member.User.EmailVerifiedAt,
			&member.Role,
			&member.Status,
			&member.LastAccessedAt,
			&member.CreatedAt,
		); err != nil {
			handler.internalProblem(writer, request, err)
			return
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	handler.writeJSON(writer, http.StatusOK, map[string]any{"items": members})
}

type updateMemberRequest struct {
	Role   *Role   `json:"role"`
	Status *string `json:"status"`
}

func (handler *Handler) updateMember(writer http.ResponseWriter, request *http.Request) {
	principal, _ := PrincipalFromContext(request.Context())
	memberID, err := uuid.Parse(chiURLParam(request, "memberId"))
	if err != nil {
		handler.validationProblem(writer, request, "The member ID is invalid.")
		return
	}
	var input updateMemberRequest
	if err := decodeJSON(writer, request, &input); err != nil || (input.Role == nil && input.Status == nil) {
		handler.validationProblem(writer, request, "Provide a role or status to update.")
		return
	}
	if input.Role != nil && !input.Role.Valid() {
		handler.validationProblem(writer, request, "The role is invalid.")
		return
	}
	if input.Status != nil {
		*input.Status = strings.ToLower(strings.TrimSpace(*input.Status))
		if *input.Status != "active" && *input.Status != "suspended" {
			handler.validationProblem(writer, request, "The status must be active or suspended.")
			return
		}
	}

	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	defer transaction.Rollback(request.Context())
	var target memberResponse
	err = transaction.QueryRow(request.Context(), `
		SELECT wm.id, u.id, u.email, u.display_name, u.email_verified_at,
		       wm.role, wm.status, wm.last_accessed_at, wm.created_at
		FROM workspace_members wm
		JOIN users u ON u.id = wm.user_id
		WHERE wm.id = $1 AND wm.workspace_id = $2 AND wm.deleted_at IS NULL
		FOR UPDATE OF wm
	`, memberID, principal.WorkspaceID).Scan(
		&target.ID,
		&target.User.ID,
		&target.User.Email,
		&target.User.DisplayName,
		&target.User.EmailVerifiedAt,
		&target.Role,
		&target.Status,
		&target.LastAccessedAt,
		&target.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		handler.problem(writer, request, http.StatusNotFound, "not_found", "The workspace member was not found.")
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	nextRole := target.Role
	if input.Role != nil {
		nextRole = *input.Role
	}
	nextStatus := target.Status
	if input.Status != nil {
		nextStatus = *input.Status
	}
	if target.Role == RoleAdmin && target.Status == "active" && (nextRole != RoleAdmin || nextStatus != "active") {
		if err := handler.ensureAnotherAdmin(request, transaction, principal.WorkspaceID, target.ID); err != nil {
			if errors.Is(err, errLastAdmin) {
				handler.problem(writer, request, http.StatusConflict, "last_admin", "The last active administrator cannot be changed.")
				return
			}
			handler.internalProblem(writer, request, err)
			return
		}
	}
	err = transaction.QueryRow(request.Context(), `
		UPDATE workspace_members
		SET role = $3, status = $4, updated_at = now()
		WHERE id = $1 AND workspace_id = $2
		RETURNING role, status
	`, memberID, principal.WorkspaceID, nextRole, nextStatus).Scan(&target.Role, &target.Status)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if nextStatus != "active" {
		_, err = transaction.Exec(request.Context(), `
			UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
			WHERE workspace_id = $1 AND user_id = $2
		`, principal.WorkspaceID, target.User.ID)
		if err != nil {
			handler.internalProblem(writer, request, err)
			return
		}
	}
	if err := handler.audit(request.Context(), transaction, principal.WorkspaceID, &principal.UserID, "workspace.member_updated", "workspace_member", &memberID, request, map[string]any{
		"role":   nextRole,
		"status": nextStatus,
	}); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := transaction.Commit(request.Context()); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	handler.writeJSON(writer, http.StatusOK, target)
}

func (handler *Handler) removeMember(writer http.ResponseWriter, request *http.Request) {
	principal, _ := PrincipalFromContext(request.Context())
	memberID, err := uuid.Parse(chiURLParam(request, "memberId"))
	if err != nil {
		handler.validationProblem(writer, request, "The member ID is invalid.")
		return
	}
	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	defer transaction.Rollback(request.Context())
	var userID uuid.UUID
	var role Role
	var status string
	err = transaction.QueryRow(request.Context(), `
		SELECT user_id, role, status
		FROM workspace_members
		WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, memberID, principal.WorkspaceID).Scan(&userID, &role, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		handler.problem(writer, request, http.StatusNotFound, "not_found", "The workspace member was not found.")
		return
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if role == RoleAdmin && status == "active" {
		if err := handler.ensureAnotherAdmin(request, transaction, principal.WorkspaceID, memberID); err != nil {
			if errors.Is(err, errLastAdmin) {
				handler.problem(writer, request, http.StatusConflict, "last_admin", "The last active administrator cannot be removed.")
				return
			}
			handler.internalProblem(writer, request, err)
			return
		}
	}
	_, err = transaction.Exec(request.Context(), `
		UPDATE workspace_members SET deleted_at = now(), updated_at = now() WHERE id = $1
	`, memberID)
	if err == nil {
		_, err = transaction.Exec(request.Context(), `
		UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
			WHERE workspace_id = $1 AND user_id = $2
		`, principal.WorkspaceID, userID)
	}
	if err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := handler.audit(request.Context(), transaction, principal.WorkspaceID, &principal.UserID, "workspace.member_removed", "workspace_member", &memberID, request, map[string]any{
		"user_id": userID,
	}); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	if err := transaction.Commit(request.Context()); err != nil {
		handler.internalProblem(writer, request, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) ensureAnotherAdmin(request *http.Request, transaction pgx.Tx, workspaceID, excludedMemberID uuid.UUID) error {
	var count int
	err := transaction.QueryRow(request.Context(), `
		SELECT count(*)
		FROM workspace_members
		WHERE workspace_id = $1
		  AND id <> $2
		  AND role = 'admin'
		  AND status = 'active'
		  AND deleted_at IS NULL
	`, workspaceID, excludedMemberID).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		return errLastAdmin
	}
	return nil
}

func chiURLParam(request *http.Request, key string) string {
	return chi.URLParam(request, key)
}
