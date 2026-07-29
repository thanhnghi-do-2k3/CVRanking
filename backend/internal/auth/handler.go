package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/talentrank/talentrank/backend/internal/platform/httpserver"
)

const (
	refreshCookieName  = "talentrank_refresh"
	refreshTTL         = 7 * 24 * time.Hour
	rememberRefreshTTL = 30 * 24 * time.Hour
	verificationTTL    = 24 * time.Hour
	invitationTTL      = 7 * 24 * time.Hour
	refreshReuseGrace  = 5 * time.Second
)

type HandlerOptions struct {
	Database     *pgxpool.Pool
	Redis        *redis.Client
	JWT          *JWTManager
	Email        EmailSender
	Logger       *slog.Logger
	CookieSecure bool
}

type Handler struct {
	database     *pgxpool.Pool
	jwt          *JWTManager
	email        EmailSender
	logger       *slog.Logger
	rateLimiter  *RateLimiter
	cookieSecure bool
	now          func() time.Time
}

func NewHandler(options HandlerOptions) *Handler {
	return &Handler{
		database:     options.Database,
		jwt:          options.JWT,
		email:        options.Email,
		logger:       options.Logger,
		rateLimiter:  NewRateLimiter(options.Redis),
		cookieSecure: options.CookieSecure,
		now:          time.Now,
	}
}

func (handler *Handler) RegisterRoutes(router chi.Router, basePath string) {
	basePath = strings.TrimSuffix(basePath, "/")

	router.Post(basePath+"/auth/register", handler.register)
	router.Post(basePath+"/auth/login", handler.login)
	router.Post(basePath+"/auth/refresh", handler.refresh)
	router.Post(basePath+"/auth/verify-email", handler.verifyEmail)
	router.Post(basePath+"/auth/resend-verification", handler.resendVerification)
	router.Post(basePath+"/auth/invitations/inspect", handler.inspectInvitation)
	router.Post(basePath+"/auth/invitations/accept", handler.acceptInvitation)

	router.Group(func(protected chi.Router) {
		protected.Use(handler.authenticate)
		protected.Post(basePath+"/auth/logout", handler.logout)
		protected.Get(basePath+"/auth/me", handler.me)
		protected.Post(basePath+"/auth/switch-workspace", handler.switchWorkspace)

		protected.Get(basePath+"/workspace/members", handler.listMembers)
		protected.Group(func(admin chi.Router) {
			admin.Use(handler.requireAdmin)
			admin.Patch(basePath+"/workspace/members/{memberId}", handler.updateMember)
			admin.Delete(basePath+"/workspace/members/{memberId}", handler.removeMember)
			admin.Get(basePath+"/workspace/invitations", handler.listInvitations)
			admin.Post(basePath+"/workspace/invitations", handler.createInvitation)
			admin.Post(basePath+"/workspace/invitations/{invitationId}/resend", handler.resendInvitation)
			admin.Delete(basePath+"/workspace/invitations/{invitationId}", handler.revokeInvitation)
		})
	})
}

func (handler *Handler) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		authorization := strings.TrimSpace(request.Header.Get("Authorization"))
		if !strings.HasPrefix(authorization, "Bearer ") {
			handler.problem(writer, request, http.StatusUnauthorized, "invalid_token", "Authentication required.")
			return
		}
		claims, err := handler.jwt.Parse(strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer ")))
		if err != nil {
			code := "invalid_token"
			if errors.Is(err, errTokenExpired) {
				code = "token_expired"
			}
			handler.problem(writer, request, http.StatusUnauthorized, code, "The access token is invalid or expired.")
			return
		}

		var role Role
		var familyActive bool
		err = handler.database.QueryRow(request.Context(), `
			SELECT wm.role,
			       EXISTS (
			           SELECT 1 FROM refresh_tokens rt
			           WHERE rt.family_id = $3
			             AND rt.user_id = $1
			             AND rt.workspace_id = $2
			             AND rt.revoked_at IS NULL
			             AND rt.expires_at > now()
			       )
			FROM workspace_members wm
			JOIN users u ON u.id = wm.user_id
			JOIN workspaces w ON w.id = wm.workspace_id
			WHERE wm.user_id = $1
			  AND wm.workspace_id = $2
			  AND wm.deleted_at IS NULL
			  AND wm.status = 'active'
			  AND u.is_active = true
			  AND u.deleted_at IS NULL
			  AND u.email_verified_at IS NOT NULL
			  AND w.deleted_at IS NULL
		`, claims.UserID, claims.WorkspaceID, claims.FamilyID).Scan(&role, &familyActive)
		if errors.Is(err, pgx.ErrNoRows) {
			handler.problem(writer, request, http.StatusForbidden, "membership_inactive", "The workspace membership is inactive.")
			return
		}
		if err != nil {
			handler.internalProblem(writer, request, err)
			return
		}
		if !familyActive {
			handler.problem(writer, request, http.StatusUnauthorized, "invalid_token", "The session has been revoked.")
			return
		}

		principal := Principal{
			UserID:      claims.UserID,
			WorkspaceID: claims.WorkspaceID,
			Role:        role,
			FamilyID:    claims.FamilyID,
		}
		ctx := context.WithValue(request.Context(), principalKey{}, principal)
		next.ServeHTTP(writer, request.WithContext(ctx))
	})
}

// Authenticate validates the workspace-scoped session and refresh-token family
// before a business module handles the request.
func (handler *Handler) Authenticate(next http.Handler) http.Handler {
	return handler.authenticate(next)
}

func (handler *Handler) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		principal, ok := PrincipalFromContext(request.Context())
		if !ok || principal.Role != RoleAdmin {
			handler.problem(writer, request, http.StatusForbidden, "forbidden", "Administrator access is required.")
			return
		}
		next.ServeHTTP(writer, request)
	})
}

func (handler *Handler) enforceRateLimit(writer http.ResponseWriter, request *http.Request, event, identity string, limit int, window time.Duration) bool {
	allowed, retryAfter, err := handler.rateLimiter.Allow(request.Context(), event, identity+"|"+clientIP(request), limit, window)
	if err != nil {
		handler.internalProblem(writer, request, err)
		return false
	}
	if !allowed {
		writer.Header().Set("Retry-After", strconv.Itoa(max(1, int(retryAfter.Seconds()))))
		handler.problem(writer, request, http.StatusTooManyRequests, "rate_limit_exceeded", "Too many requests. Try again later.")
		return false
	}
	return true
}

func normalizeEmail(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	address, err := mail.ParseAddress(value)
	if err != nil || address.Address != value || len(value) > 254 {
		return "", errors.New("invalid email")
	}
	return value, nil
}

func validateName(value string, minimum, maximum int) (string, error) {
	value = strings.TrimSpace(value)
	if len([]rune(value)) < minimum || len([]rune(value)) > maximum {
		return "", fmt.Errorf("must contain %d to %d characters", minimum, maximum)
	}
	return value, nil
}

func decodeJSON(writer http.ResponseWriter, request *http.Request, destination any) error {
	request.Body = http.MaxBytesReader(writer, request.Body, 1<<20)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}

func (handler *Handler) writeJSON(writer http.ResponseWriter, status int, value any) {
	if writer.Header().Get("Content-Type") == "" {
		writer.Header().Set("Content-Type", "application/json")
	}
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func (handler *Handler) problem(writer http.ResponseWriter, request *http.Request, status int, code, detail string) {
	writer.Header().Set("Content-Type", "application/problem+json")
	handler.writeJSON(writer, status, map[string]any{
		"type":       "https://talentrank.local/problems/" + code,
		"title":      http.StatusText(status),
		"status":     status,
		"code":       code,
		"detail":     detail,
		"request_id": httpserver.RequestID(request.Context()),
	})
}

func clientIP(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		return host
	}
	return request.RemoteAddr
}

func (handler *Handler) validationProblem(writer http.ResponseWriter, request *http.Request, detail string) {
	handler.problem(writer, request, http.StatusUnprocessableEntity, "validation_error", detail)
}

func (handler *Handler) internalProblem(writer http.ResponseWriter, request *http.Request, err error) {
	handler.logger.ErrorContext(
		request.Context(),
		"request_failed",
		"error", err,
		"request_id", httpserver.RequestID(request.Context()),
		"correlation_id", httpserver.CorrelationID(request.Context()),
	)
	handler.problem(writer, request, http.StatusInternalServerError, "internal_error", "The request could not be completed.")
}

func (handler *Handler) setRefreshCookie(writer http.ResponseWriter, raw string, remember bool) {
	ttl := refreshTTL
	if remember {
		ttl = rememberRefreshTTL
	}
	http.SetCookie(writer, &http.Cookie{
		Name:     refreshCookieName,
		Value:    raw,
		Path:     "/api/v1/auth",
		MaxAge:   int(ttl.Seconds()),
		Expires:  handler.now().UTC().Add(ttl),
		HttpOnly: true,
		Secure:   handler.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (handler *Handler) clearRefreshCookie(writer http.ResponseWriter) {
	http.SetCookie(writer, &http.Cookie{
		Name:     refreshCookieName,
		Value:    "",
		Path:     "/api/v1/auth",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		Secure:   handler.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (handler *Handler) audit(ctx context.Context, transaction pgx.Tx, workspaceID uuid.UUID, actorID *uuid.UUID, action, resourceType string, resourceID *uuid.UUID, request *http.Request, metadata any) error {
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
