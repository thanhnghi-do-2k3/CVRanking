// Package job owns workspace-scoped job descriptions, parsed requirements, and versioning.
package job

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/talentrank/talentrank/backend/internal/audit"
	"github.com/talentrank/talentrank/backend/internal/auth"
	"github.com/talentrank/talentrank/backend/internal/platform/ai"
	"github.com/talentrank/talentrank/backend/internal/platform/httpapi"
)

type Handler struct {
	database *pgxpool.Pool
	ai       *ai.Client
	logger   *slog.Logger
}

func NewHandler(database *pgxpool.Pool, aiClient *ai.Client, logger *slog.Logger) *Handler {
	return &Handler{database: database, ai: aiClient, logger: logger}
}

func (handler *Handler) RegisterRoutes(router chi.Router, basePath string) {
	router.Get(basePath+"/jobs", handler.list)
	router.Post(basePath+"/jobs", handler.create)
	router.Get(basePath+"/jobs/{jobId}", handler.get)
	router.Put(basePath+"/jobs/{jobId}/requirements", handler.replaceRequirements)
}

type createRequest struct {
	Title          string `json:"title"`
	Description    string `json:"description"`
	Location       string `json:"location"`
	EmploymentType string `json:"employment_type"`
}

type requirementResponse struct {
	ai.Requirement
	ID uuid.UUID `json:"id"`
}

type jobResponse struct {
	ID             uuid.UUID             `json:"id"`
	Title          string                `json:"title"`
	Description    string                `json:"description"`
	Summary        string                `json:"summary"`
	Seniority      *string               `json:"seniority,omitempty"`
	Location       string                `json:"location"`
	EmploymentType string                `json:"employment_type"`
	Status         string                `json:"status"`
	CurrentVersion int                   `json:"current_version"`
	CandidateCount int                   `json:"candidate_count"`
	LastRankingAt  *time.Time            `json:"last_ranking_at,omitempty"`
	Requirements   []requirementResponse `json:"requirements"`
	CreatedAt      time.Time             `json:"created_at"`
	UpdatedAt      time.Time             `json:"updated_at"`
}

type listItem struct {
	ID             uuid.UUID  `json:"id"`
	Title          string     `json:"title"`
	Location       string     `json:"location"`
	EmploymentType string     `json:"employment_type"`
	Status         string     `json:"status"`
	CandidateCount int        `json:"candidate_count"`
	LastRankingAt  *time.Time `json:"last_ranking_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

func canEdit(principal auth.Principal) bool {
	return principal.Role == auth.RoleAdmin || principal.Role == auth.RoleRecruiter
}

func (handler *Handler) create(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	if !canEdit(principal) {
		httpapi.Problem(writer, request, http.StatusForbidden, "forbidden", "Recruiter access is required.")
		return
	}
	var input createRequest
	if err := httpapi.DecodeJSON(writer, request, &input, 128<<10); err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The job payload is invalid.")
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	input.Location = strings.TrimSpace(input.Location)
	if len([]rune(input.Title)) < 2 || len([]rune(input.Title)) > 200 {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "Job title must contain 2 to 200 characters.")
		return
	}
	if len([]rune(input.Description)) < 20 || len([]rune(input.Description)) > 100_000 {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "Job description must contain 20 to 100000 characters.")
		return
	}
	if input.EmploymentType == "" {
		input.EmploymentType = "full_time"
	}
	if !validEmploymentType(input.EmploymentType) {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "Employment type is invalid.")
		return
	}
	parsed, err := handler.ai.ParseJob(request.Context(), input.Title, input.Description)
	if err != nil {
		handler.logger.ErrorContext(request.Context(), "job_parse_failed", "error", err)
		httpapi.Problem(writer, request, http.StatusBadGateway, "ai_service_error", "The job description could not be parsed.")
		return
	}

	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	defer transaction.Rollback(request.Context())
	var result jobResponse
	err = transaction.QueryRow(request.Context(), `
		INSERT INTO jobs (
			workspace_id, title, location, employment_type, status, created_by
		)
		VALUES ($1, $2, $3, $4, 'active', $5)
		RETURNING id, title, location, employment_type, status, current_version, created_at, updated_at
	`, principal.WorkspaceID, input.Title, input.Location, input.EmploymentType, principal.UserID).Scan(
		&result.ID, &result.Title, &result.Location, &result.EmploymentType, &result.Status,
		&result.CurrentVersion, &result.CreatedAt, &result.UpdatedAt,
	)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	parsedDocument, _ := json.Marshal(parsed)
	var versionID uuid.UUID
	err = transaction.QueryRow(request.Context(), `
		INSERT INTO job_versions (
			workspace_id, job_id, version, raw_description, parsed_document,
			parser_version, created_by
		)
		VALUES ($1, $2, 1, $3, $4, $5, $6)
		RETURNING id
	`, principal.WorkspaceID, result.ID, input.Description, parsedDocument, parsed.ParserVersion, principal.UserID).Scan(&versionID)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	result.Description = input.Description
	result.Summary = parsed.Summary
	result.Seniority = parsed.Seniority
	result.Requirements, err = insertRequirements(
		request,
		transaction,
		principal,
		versionID,
		parsed.Requirements,
	)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	if err := audit.Write(
		request.Context(), transaction, principal.WorkspaceID, principal.UserID,
		"job.created", "job", &result.ID, request,
		map[string]any{"version": 1, "requirement_count": len(result.Requirements)},
	); err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	if err := transaction.Commit(request.Context()); err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	httpapi.WriteJSON(writer, http.StatusCreated, result)
}

func (handler *Handler) list(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	rows, err := handler.database.Query(request.Context(), `
		SELECT j.id, j.title, j.location, j.employment_type, j.status, j.created_at,
		       count(DISTINCT jc.candidate_id),
		       max(rr.finished_at)
		FROM jobs j
		LEFT JOIN job_candidates jc
		  ON jc.workspace_id = j.workspace_id AND jc.job_id = j.id
		LEFT JOIN ranking_runs rr
		  ON rr.workspace_id = j.workspace_id AND rr.job_id = j.id AND rr.status = 'completed'
		WHERE j.workspace_id = $1 AND j.deleted_at IS NULL
		GROUP BY j.id
		ORDER BY j.created_at DESC
	`, principal.WorkspaceID)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	defer rows.Close()
	items := make([]listItem, 0)
	for rows.Next() {
		var item listItem
		if err := rows.Scan(
			&item.ID, &item.Title, &item.Location, &item.EmploymentType, &item.Status,
			&item.CreatedAt, &item.CandidateCount, &item.LastRankingAt,
		); err != nil {
			httpapi.Internal(writer, request, handler.logger, err)
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	httpapi.WriteJSON(writer, http.StatusOK, map[string]any{"items": items})
}

func (handler *Handler) get(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	jobID, err := uuid.Parse(chi.URLParam(request, "jobId"))
	if err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The job ID is invalid.")
		return
	}
	result, err := handler.load(request, principal.WorkspaceID, jobID)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Problem(writer, request, http.StatusNotFound, "not_found", "The job was not found.")
		return
	}
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	httpapi.WriteJSON(writer, http.StatusOK, result)
}

type replaceRequirementsRequest struct {
	Requirements []ai.Requirement `json:"requirements"`
}

func (handler *Handler) replaceRequirements(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	if !canEdit(principal) {
		httpapi.Problem(writer, request, http.StatusForbidden, "forbidden", "Recruiter access is required.")
		return
	}
	jobID, err := uuid.Parse(chi.URLParam(request, "jobId"))
	if err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The job ID is invalid.")
		return
	}
	var input replaceRequirementsRequest
	if err := httpapi.DecodeJSON(writer, request, &input, 256<<10); err != nil || len(input.Requirements) == 0 || len(input.Requirements) > 100 {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "Provide 1 to 100 valid requirements.")
		return
	}
	for index := range input.Requirements {
		input.Requirements[index].Key = "R" + strconv.Itoa(index+1)
		if !validRequirement(input.Requirements[index]) {
			httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "One or more requirements are invalid.")
			return
		}
	}
	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	defer transaction.Rollback(request.Context())
	var currentVersion int
	var rawDescription string
	err = transaction.QueryRow(request.Context(), `
		SELECT j.current_version, jv.raw_description
		FROM jobs j
		JOIN job_versions jv
		  ON jv.workspace_id = j.workspace_id
		 AND jv.job_id = j.id
		 AND jv.version = j.current_version
		WHERE j.id = $1 AND j.workspace_id = $2 AND j.deleted_at IS NULL
		FOR UPDATE OF j
	`, jobID, principal.WorkspaceID).Scan(&currentVersion, &rawDescription)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Problem(writer, request, http.StatusNotFound, "not_found", "The job was not found.")
		return
	}
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	nextVersion := currentVersion + 1
	var versionID uuid.UUID
	err = transaction.QueryRow(request.Context(), `
		INSERT INTO job_versions (
			workspace_id, job_id, version, raw_description, parser_version, created_by
		)
		VALUES ($1, $2, $3, $4, 'manual-v1', $5)
		RETURNING id
	`, principal.WorkspaceID, jobID, nextVersion, rawDescription, principal.UserID).Scan(&versionID)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	if _, err = insertRequirements(request, transaction, principal, versionID, input.Requirements); err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	_, err = transaction.Exec(request.Context(), `
		UPDATE jobs SET current_version = $3, updated_at = now()
		WHERE id = $1 AND workspace_id = $2
	`, jobID, principal.WorkspaceID, nextVersion)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	if err := audit.Write(
		request.Context(), transaction, principal.WorkspaceID, principal.UserID,
		"job.requirements_replaced", "job", &jobID, request,
		map[string]any{"version": nextVersion, "requirement_count": len(input.Requirements)},
	); err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	if err := transaction.Commit(request.Context()); err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	result, err := handler.load(request, principal.WorkspaceID, jobID)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	httpapi.WriteJSON(writer, http.StatusOK, result)
}

func (handler *Handler) load(request *http.Request, workspaceID, jobID uuid.UUID) (jobResponse, error) {
	var result jobResponse
	var parsedDocument []byte
	var versionID uuid.UUID
	err := handler.database.QueryRow(request.Context(), `
		SELECT j.id, j.title, j.location, j.employment_type, j.status, j.current_version,
		       j.created_at, j.updated_at, jv.id, jv.raw_description,
		       COALESCE(jv.parsed_document, '{}'::jsonb),
		       (SELECT count(*) FROM job_candidates jc
		        WHERE jc.workspace_id = j.workspace_id AND jc.job_id = j.id),
		       (SELECT max(rr.finished_at) FROM ranking_runs rr
		        WHERE rr.workspace_id = j.workspace_id AND rr.job_id = j.id AND rr.status = 'completed')
		FROM jobs j
		JOIN job_versions jv
		  ON jv.workspace_id = j.workspace_id
		 AND jv.job_id = j.id
		 AND jv.version = j.current_version
		WHERE j.id = $1 AND j.workspace_id = $2 AND j.deleted_at IS NULL
	`, jobID, workspaceID).Scan(
		&result.ID, &result.Title, &result.Location, &result.EmploymentType,
		&result.Status, &result.CurrentVersion, &result.CreatedAt, &result.UpdatedAt,
		&versionID, &result.Description, &parsedDocument, &result.CandidateCount,
		&result.LastRankingAt,
	)
	if err != nil {
		return jobResponse{}, err
	}
	var parsed ai.JobParseResult
	if err := json.Unmarshal(parsedDocument, &parsed); err == nil {
		result.Summary = parsed.Summary
		result.Seniority = parsed.Seniority
	}
	result.Requirements, err = loadRequirements(request, handler.database, workspaceID, versionID)
	return result, err
}

type queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func loadRequirements(request *http.Request, database queryer, workspaceID, versionID uuid.UUID) ([]requirementResponse, error) {
	rows, err := database.Query(request.Context(), `
		SELECT id, requirement_key, name, requirement_type, priority, weight,
		       minimum_years, is_hard_constraint, description, source_evidence
		FROM job_requirements
		WHERE workspace_id = $1 AND job_version_id = $2
		ORDER BY requirement_key
	`, workspaceID, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]requirementResponse, 0)
	for rows.Next() {
		var item requirementResponse
		var sourceEvidence []byte
		if err := rows.Scan(
			&item.ID, &item.Key, &item.Name, &item.Type, &item.Priority, &item.Weight,
			&item.MinimumYears, &item.IsHardConstraint, &item.Description, &sourceEvidence,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(sourceEvidence, &item.SourceEvidence); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func insertRequirements(
	request *http.Request,
	transaction pgx.Tx,
	principal auth.Principal,
	versionID uuid.UUID,
	requirements []ai.Requirement,
) ([]requirementResponse, error) {
	result := make([]requirementResponse, 0, len(requirements))
	for _, requirement := range requirements {
		if !validRequirement(requirement) {
			continue
		}
		sourceEvidence, _ := json.Marshal(requirement.SourceEvidence)
		var item requirementResponse
		item.Requirement = requirement
		err := transaction.QueryRow(request.Context(), `
			INSERT INTO job_requirements (
				workspace_id, job_version_id, requirement_key, name, requirement_type,
				priority, weight, minimum_years, is_hard_constraint, description,
				source_evidence, created_by
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			RETURNING id
		`, principal.WorkspaceID, versionID, requirement.Key, requirement.Name,
			requirement.Type, requirement.Priority, requirement.Weight,
			requirement.MinimumYears, requirement.IsHardConstraint, requirement.Description,
			sourceEvidence, principal.UserID).Scan(&item.ID)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}

func validEmploymentType(value string) bool {
	return value == "full_time" || value == "part_time" || value == "contract" || value == "internship"
}

func validRequirement(value ai.Requirement) bool {
	validType := value.Type == "skill" || value.Type == "experience" || value.Type == "education" ||
		value.Type == "certification" || value.Type == "language" || value.Type == "location" || value.Type == "other"
	validPriority := value.Priority == "must_have" || value.Priority == "nice_to_have"
	return strings.TrimSpace(value.Key) != "" && strings.TrimSpace(value.Name) != "" &&
		validType && validPriority && value.Weight > 0 && value.Weight <= 10
}
