package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/talentrank/talentrank/backend/internal/platform/httpserver"
)

func Write(
	ctx context.Context,
	transaction pgx.Tx,
	workspaceID uuid.UUID,
	actorID uuid.UUID,
	action string,
	resourceType string,
	resourceID *uuid.UUID,
	request *http.Request,
	metadata any,
) error {
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal audit metadata: %w", err)
	}
	_, err = transaction.Exec(ctx, `
		INSERT INTO audit_logs (
			workspace_id, actor_user_id, action, resource_type, resource_id,
			request_id, correlation_id, ip_hash, user_agent_hash, metadata
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, digest($8, 'sha256'), digest($9, 'sha256'), $10)
	`, workspaceID, actorID, action, resourceType, resourceID,
		httpserver.RequestID(request.Context()), httpserver.CorrelationID(request.Context()),
		request.RemoteAddr, request.UserAgent(), encoded)
	if err != nil {
		return fmt.Errorf("write audit log: %w", err)
	}
	return nil
}
