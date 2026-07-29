// Package ranking owns immutable ranking runs, scores, and evidence-backed explanations.
package ranking

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
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
	router.Post(basePath+"/jobs/{jobId}/ranking-runs", handler.create)
	router.Get(basePath+"/jobs/{jobId}/ranking-runs", handler.listRuns)
	router.Get(basePath+"/ranking-runs/{runId}", handler.getRun)
	router.Get(basePath+"/ranking-runs/{runId}/results", handler.listResults)
	router.Get(basePath+"/ranking-runs/{runId}/results/{candidateId}", handler.getResult)
}

type runResponse struct {
	ID                   uuid.UUID        `json:"id"`
	JobID                uuid.UUID        `json:"job_id"`
	JobVersionID         uuid.UUID        `json:"job_version_id"`
	Status               string           `json:"status"`
	Progress             int              `json:"progress"`
	ModelVersion         string           `json:"model_version"`
	FeatureSchemaVersion string           `json:"feature_schema_version"`
	CandidateCount       int              `json:"candidate_count"`
	StartedAt            *time.Time       `json:"started_at,omitempty"`
	FinishedAt           *time.Time       `json:"finished_at,omitempty"`
	CreatedAt            time.Time        `json:"created_at"`
	Results              []resultResponse `json:"results,omitempty"`
}

type resultResponse struct {
	ID                uuid.UUID              `json:"id"`
	RankingRunID      uuid.UUID              `json:"ranking_run_id"`
	Candidate         candidateSummary       `json:"candidate"`
	Rank              int                    `json:"rank"`
	FinalScore        float64                `json:"final_score"`
	Confidence        float64                `json:"confidence"`
	EligibilityStatus string                 `json:"eligibility_status"`
	Strengths         []string               `json:"strengths"`
	Gaps              []string               `json:"gaps"`
	Unknowns          []string               `json:"unknowns"`
	RequirementScores []requirementScoreItem `json:"requirement_scores"`
}

type candidateSummary struct {
	ID                   uuid.UUID `json:"id"`
	ResumeID             uuid.UUID `json:"resume_id"`
	FullName             string    `json:"full_name"`
	CurrentTitle         string    `json:"current_title"`
	TotalYearsExperience *float64  `json:"total_years_experience,omitempty"`
	Status               string    `json:"status"`
	Filename             string    `json:"filename"`
}

type requirementScoreItem struct {
	RequirementKey string         `json:"requirement_key"`
	Status         string         `json:"status"`
	Score          float64        `json:"score"`
	Confidence     float64        `json:"confidence"`
	EvidenceIDs    []uuid.UUID    `json:"evidence_ids"`
	Evidences      []evidenceItem `json:"evidences,omitempty"`
}

type evidenceItem struct {
	ID          uuid.UUID `json:"id"`
	Text        string    `json:"text"`
	Page        *int      `json:"page,omitempty"`
	StartOffset *int      `json:"start_offset,omitempty"`
	EndOffset   *int      `json:"end_offset,omitempty"`
}

type jobSnapshot struct {
	JobID          uuid.UUID
	JobVersionID   uuid.UUID
	Requirements   []ai.Requirement
	RawDescription string
}

type candidateForScoring struct {
	CandidateID          uuid.UUID
	ResumeID             uuid.UUID
	FullName             string
	CurrentTitle         string
	TotalYearsExperience *float64
	Status               string
	Filename             string
	Skills               []ai.RankingSkill
	Educations           []ai.RankingEducation
	Certifications       []ai.RankingCertification
	Languages            []ai.RankingLanguage
}

func canRun(principal auth.Principal) bool {
	return principal.Role == auth.RoleAdmin || principal.Role == auth.RoleRecruiter
}

func (handler *Handler) create(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	if !canRun(principal) {
		httpapi.Problem(writer, request, http.StatusForbidden, "forbidden", "Recruiter access is required.")
		return
	}
	jobID, err := uuid.Parse(chi.URLParam(request, "jobId"))
	if err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The job ID is invalid.")
		return
	}
	snapshot, err := handler.loadJobSnapshot(request.Context(), principal.WorkspaceID, jobID)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Problem(writer, request, http.StatusNotFound, "not_found", "The job was not found.")
		return
	}
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	if len(snapshot.Requirements) == 0 {
		httpapi.Problem(writer, request, http.StatusConflict, "no_requirements", "The job has no requirements to rank against.")
		return
	}
	candidates, err := handler.loadCandidatesForScoring(request.Context(), principal.WorkspaceID, jobID)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	if len(candidates) == 0 {
		httpapi.Problem(writer, request, http.StatusConflict, "no_candidates", "Upload at least one ready CV before running ranking.")
		return
	}
	payloadCandidates := make([]ai.RankingCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		payloadCandidates = append(payloadCandidates, ai.RankingCandidate{
			CandidateID:          candidate.CandidateID.String(),
			CurrentTitle:         candidate.CurrentTitle,
			TotalYearsExperience: candidate.TotalYearsExperience,
			Skills:               candidate.Skills,
			Educations:           candidate.Educations,
			Certifications:       candidate.Certifications,
			Languages:            candidate.Languages,
		})
	}
	scored, err := handler.ai.Score(request.Context(), snapshot.Requirements, payloadCandidates)
	if err != nil {
		handler.logger.ErrorContext(request.Context(), "ranking_score_failed", "error", err, "job_id", jobID)
		httpapi.Problem(writer, request, http.StatusBadGateway, "ai_service_error", "The CV ranking could not be scored.")
		return
	}
	runID, err := handler.persistRanking(request, principal, snapshot, scored)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	run, err := handler.loadRun(request.Context(), principal.WorkspaceID, runID, true)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	httpapi.WriteJSON(writer, http.StatusCreated, run)
}

func (handler *Handler) listRuns(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	jobID, err := uuid.Parse(chi.URLParam(request, "jobId"))
	if err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The job ID is invalid.")
		return
	}
	rows, err := handler.database.Query(request.Context(), `
		SELECT id, job_id, job_version_id, status, progress, model_version,
		       feature_schema_version, candidate_count, started_at, finished_at, created_at
		FROM ranking_runs
		WHERE workspace_id = $1 AND job_id = $2
		ORDER BY created_at DESC
		LIMIT 25
	`, principal.WorkspaceID, jobID)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	defer rows.Close()
	runs := make([]runResponse, 0)
	for rows.Next() {
		var run runResponse
		if err := rows.Scan(
			&run.ID, &run.JobID, &run.JobVersionID, &run.Status, &run.Progress,
			&run.ModelVersion, &run.FeatureSchemaVersion, &run.CandidateCount,
			&run.StartedAt, &run.FinishedAt, &run.CreatedAt,
		); err != nil {
			httpapi.Internal(writer, request, handler.logger, err)
			return
		}
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	httpapi.WriteJSON(writer, http.StatusOK, map[string]any{"runs": runs})
}

func (handler *Handler) getRun(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	runID, err := uuid.Parse(chi.URLParam(request, "runId"))
	if err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The ranking run ID is invalid.")
		return
	}
	run, err := handler.loadRun(request.Context(), principal.WorkspaceID, runID, false)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Problem(writer, request, http.StatusNotFound, "not_found", "The ranking run was not found.")
		return
	}
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	httpapi.WriteJSON(writer, http.StatusOK, run)
}

func (handler *Handler) listResults(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	runID, err := uuid.Parse(chi.URLParam(request, "runId"))
	if err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The ranking run ID is invalid.")
		return
	}
	results, err := handler.loadResults(request.Context(), principal.WorkspaceID, runID, false)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	httpapi.WriteJSON(writer, http.StatusOK, map[string]any{"results": results})
}

func (handler *Handler) getResult(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	runID, err := uuid.Parse(chi.URLParam(request, "runId"))
	if err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The ranking run ID is invalid.")
		return
	}
	candidateID, err := uuid.Parse(chi.URLParam(request, "candidateId"))
	if err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The candidate ID is invalid.")
		return
	}
	results, err := handler.loadResults(request.Context(), principal.WorkspaceID, runID, true)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	for _, result := range results {
		if result.Candidate.ID == candidateID {
			httpapi.WriteJSON(writer, http.StatusOK, result)
			return
		}
	}
	httpapi.Problem(writer, request, http.StatusNotFound, "not_found", "The ranking result was not found.")
}

func (handler *Handler) loadJobSnapshot(ctx context.Context, workspaceID, jobID uuid.UUID) (jobSnapshot, error) {
	var snapshot jobSnapshot
	var parsedDocument []byte
	err := handler.database.QueryRow(ctx, `
		SELECT j.id, jv.id, jv.raw_description, COALESCE(jv.parsed_document, '{}'::jsonb)
		FROM jobs j
		JOIN job_versions jv
		  ON jv.workspace_id = j.workspace_id
		 AND jv.job_id = j.id
		 AND jv.version = j.current_version
		WHERE j.id = $1 AND j.workspace_id = $2 AND j.deleted_at IS NULL
	`, jobID, workspaceID).Scan(&snapshot.JobID, &snapshot.JobVersionID, &snapshot.RawDescription, &parsedDocument)
	if err != nil {
		return jobSnapshot{}, err
	}
	rows, err := handler.database.Query(ctx, `
		SELECT requirement_key, name, requirement_type, priority, weight,
		       minimum_years, is_hard_constraint, description, source_evidence
		FROM job_requirements
		WHERE workspace_id = $1 AND job_version_id = $2
		ORDER BY requirement_key
	`, workspaceID, snapshot.JobVersionID)
	if err != nil {
		return jobSnapshot{}, err
	}
	defer rows.Close()
	snapshot.Requirements = make([]ai.Requirement, 0)
	for rows.Next() {
		var requirement ai.Requirement
		var sourceEvidence []byte
		if err := rows.Scan(
			&requirement.Key, &requirement.Name, &requirement.Type, &requirement.Priority,
			&requirement.Weight, &requirement.MinimumYears, &requirement.IsHardConstraint,
			&requirement.Description, &sourceEvidence,
		); err != nil {
			return jobSnapshot{}, err
		}
		if len(sourceEvidence) > 0 {
			if err := json.Unmarshal(sourceEvidence, &requirement.SourceEvidence); err != nil {
				return jobSnapshot{}, err
			}
		}
		snapshot.Requirements = append(snapshot.Requirements, requirement)
	}
	if err := rows.Err(); err != nil {
		return jobSnapshot{}, err
	}
	_ = parsedDocument
	return snapshot, nil
}

func (handler *Handler) loadCandidatesForScoring(ctx context.Context, workspaceID, jobID uuid.UUID) ([]candidateForScoring, error) {
	rows, err := handler.database.Query(ctx, `
		SELECT c.id, jc.resume_id, c.full_name, c.current_title,
		       c.total_years_experience, c.status, rf.original_filename
		FROM job_candidates jc
		JOIN candidates c
		  ON c.id = jc.candidate_id AND c.workspace_id = jc.workspace_id AND c.deleted_at IS NULL
		JOIN resumes r
		  ON r.id = jc.resume_id AND r.workspace_id = jc.workspace_id AND r.status = 'ready'
		JOIN resume_files rf
		  ON rf.resume_id = r.id AND rf.workspace_id = r.workspace_id AND rf.deleted_at IS NULL
		WHERE jc.workspace_id = $1 AND jc.job_id = $2
		ORDER BY jc.created_at
	`, workspaceID, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	candidates := make([]candidateForScoring, 0)
	candidateIDs := make([]uuid.UUID, 0)
	indexByID := map[uuid.UUID]int{}
	for rows.Next() {
		var candidate candidateForScoring
		if err := rows.Scan(
			&candidate.CandidateID, &candidate.ResumeID, &candidate.FullName,
			&candidate.CurrentTitle, &candidate.TotalYearsExperience, &candidate.Status,
			&candidate.Filename,
		); err != nil {
			return nil, err
		}
		candidates = append(candidates, candidate)
		candidateIDs = append(candidateIDs, candidate.CandidateID)
		indexByID[candidate.CandidateID] = len(candidates) - 1
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(candidateIDs) == 0 {
		return candidates, nil
	}
	evidences, err := handler.loadCandidateEvidences(ctx, workspaceID, candidateIDs)
	if err != nil {
		return nil, err
	}
	skillRows, err := handler.database.Query(ctx, `
		SELECT candidate_id, stated_name, estimated_years
		FROM candidate_skills
		WHERE workspace_id = $1 AND candidate_id = ANY($2)
		ORDER BY confidence DESC, stated_name
	`, workspaceID, candidateIDs)
	if err != nil {
		return nil, err
	}
	defer skillRows.Close()
	for skillRows.Next() {
		var candidateID uuid.UUID
		var skill ai.RankingSkill
		if err := skillRows.Scan(&candidateID, &skill.Name, &skill.EstimatedYears); err != nil {
			return nil, err
		}
		evidenceKey := candidateEvidenceKey(candidateID, skill.Name)
		skill.Evidences = evidences[evidenceKey]
		if index, ok := indexByID[candidateID]; ok {
			candidates[index].Skills = append(candidates[index].Skills, skill)
		}
	}
	if err := skillRows.Err(); err != nil {
		return nil, err
	}

	educationRows, err := handler.database.Query(ctx, `
		SELECT ce.candidate_id, ce.institution, ce.degree, ce.field_of_study,
		       ev.id, ev.text_excerpt, ev.page_number, ev.start_offset, ev.end_offset
		FROM candidate_educations ce
		LEFT JOIN candidate_evidences ev
		  ON ev.id = ce.evidence_id AND ev.workspace_id = ce.workspace_id
		WHERE ce.workspace_id = $1 AND ce.candidate_id = ANY($2)
	`, workspaceID, candidateIDs)
	if err != nil {
		return nil, err
	}
	defer educationRows.Close()
	for educationRows.Next() {
		var candidateID uuid.UUID
		var education ai.RankingEducation
		var evidenceID *uuid.UUID
		var evidenceText *string
		var evidence ai.Evidence
		if err := educationRows.Scan(
			&candidateID, &education.Institution, &education.Degree, &education.FieldOfStudy,
			&evidenceID, &evidenceText, &evidence.Page, &evidence.StartOffset, &evidence.EndOffset,
		); err != nil {
			return nil, err
		}
		if evidenceID != nil && evidenceText != nil {
			evidence.ID = evidenceID.String()
			evidence.Text = *evidenceText
			education.Evidences = []ai.Evidence{evidence}
		}
		if index, ok := indexByID[candidateID]; ok {
			candidates[index].Educations = append(candidates[index].Educations, education)
		}
	}
	if err := educationRows.Err(); err != nil {
		return nil, err
	}

	certificationRows, err := handler.database.Query(ctx, `
		SELECT cc.candidate_id, cc.name, cc.issuer,
		       ev.id, ev.text_excerpt, ev.page_number, ev.start_offset, ev.end_offset
		FROM candidate_certifications cc
		LEFT JOIN candidate_evidences ev
		  ON ev.id = cc.evidence_id AND ev.workspace_id = cc.workspace_id
		WHERE cc.workspace_id = $1 AND cc.candidate_id = ANY($2)
	`, workspaceID, candidateIDs)
	if err != nil {
		return nil, err
	}
	defer certificationRows.Close()
	for certificationRows.Next() {
		var candidateID uuid.UUID
		var certification ai.RankingCertification
		var evidenceID *uuid.UUID
		var evidenceText *string
		var evidence ai.Evidence
		if err := certificationRows.Scan(
			&candidateID, &certification.Name, &certification.Issuer,
			&evidenceID, &evidenceText, &evidence.Page, &evidence.StartOffset, &evidence.EndOffset,
		); err != nil {
			return nil, err
		}
		if evidenceID != nil && evidenceText != nil {
			evidence.ID = evidenceID.String()
			evidence.Text = *evidenceText
			certification.Evidences = []ai.Evidence{evidence}
		}
		if index, ok := indexByID[candidateID]; ok {
			candidates[index].Certifications = append(candidates[index].Certifications, certification)
		}
	}
	if err := certificationRows.Err(); err != nil {
		return nil, err
	}

	languageRows, err := handler.database.Query(ctx, `
		SELECT cl.candidate_id, cl.language, COALESCE(cl.proficiency, ''),
		       ev.id, ev.text_excerpt, ev.page_number, ev.start_offset, ev.end_offset
		FROM candidate_languages cl
		LEFT JOIN candidate_evidences ev
		  ON ev.id = cl.evidence_id AND ev.workspace_id = cl.workspace_id
		WHERE cl.workspace_id = $1 AND cl.candidate_id = ANY($2)
	`, workspaceID, candidateIDs)
	if err != nil {
		return nil, err
	}
	defer languageRows.Close()
	for languageRows.Next() {
		var candidateID uuid.UUID
		var language ai.RankingLanguage
		var evidenceID *uuid.UUID
		var evidenceText *string
		var evidence ai.Evidence
		if err := languageRows.Scan(
			&candidateID, &language.Language, &language.Proficiency,
			&evidenceID, &evidenceText, &evidence.Page, &evidence.StartOffset, &evidence.EndOffset,
		); err != nil {
			return nil, err
		}
		if evidenceID != nil && evidenceText != nil {
			evidence.ID = evidenceID.String()
			evidence.Text = *evidenceText
			language.Evidences = []ai.Evidence{evidence}
		}
		if index, ok := indexByID[candidateID]; ok {
			candidates[index].Languages = append(candidates[index].Languages, language)
		}
	}
	return candidates, languageRows.Err()
}

func (handler *Handler) loadCandidateEvidences(
	ctx context.Context,
	workspaceID uuid.UUID,
	candidateIDs []uuid.UUID,
) (map[string][]ai.Evidence, error) {
	rows, err := handler.database.Query(ctx, `
		SELECT candidate_id, evidence_type, id, text_excerpt, page_number, start_offset, end_offset
		FROM candidate_evidences
		WHERE workspace_id = $1 AND candidate_id = ANY($2)
		ORDER BY created_at
	`, workspaceID, candidateIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string][]ai.Evidence{}
	for rows.Next() {
		var candidateID uuid.UUID
		var evidenceType string
		var evidence ai.Evidence
		if err := rows.Scan(
			&candidateID, &evidenceType, &evidence.ID, &evidence.Text,
			&evidence.Page, &evidence.StartOffset, &evidence.EndOffset,
		); err != nil {
			return nil, err
		}
		key := candidateID.String() + "|" + strings.TrimSpace(strings.ToLower(evidenceType))
		result[key] = append(result[key], evidence)
	}
	return result, rows.Err()
}

func (handler *Handler) persistRanking(
	request *http.Request,
	principal auth.Principal,
	snapshot jobSnapshot,
	scored ai.RankingResponse,
) (uuid.UUID, error) {
	runID := uuid.New()
	requirementsJSON, _ := json.Marshal(snapshot.Requirements)
	weights := make(map[string]float64, len(snapshot.Requirements))
	for _, requirement := range snapshot.Requirements {
		weights[requirement.Key] = requirement.Weight
	}
	weightsJSON, _ := json.Marshal(weights)
	now := time.Now().UTC()
	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		return uuid.Nil, err
	}
	defer transaction.Rollback(request.Context())
	_, err = transaction.Exec(request.Context(), `
		INSERT INTO ranking_runs (
			id, workspace_id, job_id, job_version_id, status, progress,
			requirement_snapshot, weight_snapshot, model_version,
			feature_schema_version, candidate_count, started_at, finished_at, created_by
		)
		VALUES ($1, $2, $3, $4, 'completed', 100, $5, $6, $7, $8, $9, $10, $10, $11)
	`, runID, principal.WorkspaceID, snapshot.JobID, snapshot.JobVersionID,
		requirementsJSON, weightsJSON, scored.ModelVersion, scored.FeatureSchemaVersion,
		len(scored.Results), now, principal.UserID)
	if err != nil {
		return uuid.Nil, err
	}
	for _, result := range scored.Results {
		resultID := uuid.New()
		candidateID, err := uuid.Parse(result.CandidateID)
		if err != nil {
			return uuid.Nil, err
		}
		strengthsJSON, _ := json.Marshal(result.Strengths)
		gapsJSON, _ := json.Marshal(result.Gaps)
		unknownsJSON, _ := json.Marshal(result.Unknowns)
		_, err = transaction.Exec(request.Context(), `
			INSERT INTO ranking_results (
				id, workspace_id, ranking_run_id, candidate_id, rank, final_score,
				rule_score, confidence, eligibility_status, strengths, gaps,
				unknowns, created_by
			)
			VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12)
		`, resultID, principal.WorkspaceID, runID, candidateID, result.Rank,
			result.FinalScore, result.Confidence, result.EligibilityStatus,
			strengthsJSON, gapsJSON, unknownsJSON, principal.UserID)
		if err != nil {
			return uuid.Nil, err
		}
		for _, assessment := range result.RequirementAssessments {
			evidenceIDs := evidenceUUIDs(assessment.Evidences)
			_, err = transaction.Exec(request.Context(), `
				INSERT INTO ranking_requirement_scores (
					workspace_id, ranking_result_id, requirement_key, status, score,
					confidence, evidence_ids, created_by
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			`, principal.WorkspaceID, resultID, assessment.RequirementID,
				assessment.Status, assessment.Score, assessment.Confidence,
				evidenceIDs, principal.UserID)
			if err != nil {
				return uuid.Nil, err
			}
		}
		for _, item := range result.Strengths {
			if err := handler.insertExplanation(request.Context(), transaction, principal, resultID, "strength", item, result.ModelVersion); err != nil {
				return uuid.Nil, err
			}
		}
		for _, item := range result.Gaps {
			if err := handler.insertExplanation(request.Context(), transaction, principal, resultID, "gap", item, result.ModelVersion); err != nil {
				return uuid.Nil, err
			}
		}
		for _, item := range result.Unknowns {
			if err := handler.insertExplanation(request.Context(), transaction, principal, resultID, "unknown", item, result.ModelVersion); err != nil {
				return uuid.Nil, err
			}
		}
	}
	if err := audit.Write(
		request.Context(), transaction, principal.WorkspaceID, principal.UserID,
		"ranking.completed", "ranking_run", &runID, request,
		map[string]any{
			"job_id": snapshot.JobID, "candidate_count": len(scored.Results),
			"model_version": scored.ModelVersion,
		},
	); err != nil {
		return uuid.Nil, err
	}
	if err := transaction.Commit(request.Context()); err != nil {
		return uuid.Nil, err
	}
	return runID, nil
}

func (handler *Handler) insertExplanation(
	ctx context.Context,
	transaction pgx.Tx,
	principal auth.Principal,
	resultID uuid.UUID,
	explanationType string,
	text string,
	modelVersion string,
) error {
	encoded, _ := json.Marshal(map[string]string{"text": text})
	_, err := transaction.Exec(ctx, `
		INSERT INTO ranking_explanations (
			workspace_id, ranking_result_id, explanation_type,
			structured_explanation, model_version, created_by
		)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, principal.WorkspaceID, resultID, explanationType, encoded, modelVersion, principal.UserID)
	return err
}

func (handler *Handler) loadRun(
	ctx context.Context,
	workspaceID uuid.UUID,
	runID uuid.UUID,
	includeResults bool,
) (runResponse, error) {
	var run runResponse
	err := handler.database.QueryRow(ctx, `
		SELECT id, job_id, job_version_id, status, progress, model_version,
		       feature_schema_version, candidate_count, started_at, finished_at, created_at
		FROM ranking_runs
		WHERE workspace_id = $1 AND id = $2
	`, workspaceID, runID).Scan(
		&run.ID, &run.JobID, &run.JobVersionID, &run.Status, &run.Progress,
		&run.ModelVersion, &run.FeatureSchemaVersion, &run.CandidateCount,
		&run.StartedAt, &run.FinishedAt, &run.CreatedAt,
	)
	if err != nil {
		return runResponse{}, err
	}
	if includeResults {
		results, err := handler.loadResults(ctx, workspaceID, runID, false)
		if err != nil {
			return runResponse{}, err
		}
		run.Results = results
	}
	return run, nil
}

func (handler *Handler) loadResults(
	ctx context.Context,
	workspaceID uuid.UUID,
	runID uuid.UUID,
	includeEvidence bool,
) ([]resultResponse, error) {
	rows, err := handler.database.Query(ctx, `
		SELECT rr.id, rr.ranking_run_id, rr.rank, rr.final_score, rr.confidence,
		       rr.eligibility_status, rr.strengths, rr.gaps, rr.unknowns,
		       c.id, jc.resume_id, c.full_name, c.current_title,
		       c.total_years_experience, c.status, rf.original_filename
		FROM ranking_results rr
		JOIN ranking_runs run
		  ON run.id = rr.ranking_run_id AND run.workspace_id = rr.workspace_id
		JOIN candidates c
		  ON c.id = rr.candidate_id AND c.workspace_id = rr.workspace_id
		LEFT JOIN job_candidates jc
		  ON jc.workspace_id = rr.workspace_id
		 AND jc.job_id = run.job_id
		 AND jc.candidate_id = c.id
		LEFT JOIN resume_files rf
		  ON rf.resume_id = jc.resume_id AND rf.workspace_id = rr.workspace_id AND rf.deleted_at IS NULL
		WHERE rr.workspace_id = $1 AND rr.ranking_run_id = $2
		ORDER BY rr.rank
	`, workspaceID, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	results := make([]resultResponse, 0)
	resultIDs := make([]uuid.UUID, 0)
	for rows.Next() {
		var result resultResponse
		var strengths, gaps, unknowns []byte
		if err := rows.Scan(
			&result.ID, &result.RankingRunID, &result.Rank, &result.FinalScore,
			&result.Confidence, &result.EligibilityStatus, &strengths, &gaps,
			&unknowns, &result.Candidate.ID, &result.Candidate.ResumeID,
			&result.Candidate.FullName, &result.Candidate.CurrentTitle,
			&result.Candidate.TotalYearsExperience, &result.Candidate.Status,
			&result.Candidate.Filename,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(strengths, &result.Strengths)
		_ = json.Unmarshal(gaps, &result.Gaps)
		_ = json.Unmarshal(unknowns, &result.Unknowns)
		results = append(results, result)
		resultIDs = append(resultIDs, result.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(resultIDs) == 0 {
		return results, nil
	}
	scores, err := handler.loadRequirementScores(ctx, workspaceID, resultIDs, includeEvidence)
	if err != nil {
		return nil, err
	}
	for index := range results {
		results[index].RequirementScores = scores[results[index].ID]
	}
	return results, nil
}

func (handler *Handler) loadRequirementScores(
	ctx context.Context,
	workspaceID uuid.UUID,
	resultIDs []uuid.UUID,
	includeEvidence bool,
) (map[uuid.UUID][]requirementScoreItem, error) {
	rows, err := handler.database.Query(ctx, `
		SELECT ranking_result_id, requirement_key, status, score, confidence, evidence_ids
		FROM ranking_requirement_scores
		WHERE workspace_id = $1 AND ranking_result_id = ANY($2)
		ORDER BY requirement_key
	`, workspaceID, resultIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	scores := map[uuid.UUID][]requirementScoreItem{}
	evidenceIDs := make([]uuid.UUID, 0)
	for rows.Next() {
		var resultID uuid.UUID
		var item requirementScoreItem
		if err := rows.Scan(
			&resultID, &item.RequirementKey, &item.Status, &item.Score,
			&item.Confidence, &item.EvidenceIDs,
		); err != nil {
			return nil, err
		}
		evidenceIDs = append(evidenceIDs, item.EvidenceIDs...)
		scores[resultID] = append(scores[resultID], item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if includeEvidence && len(evidenceIDs) > 0 {
		evidences, err := handler.loadEvidenceDetails(ctx, workspaceID, evidenceIDs)
		if err != nil {
			return nil, err
		}
		for resultID, items := range scores {
			for index := range items {
				for _, evidenceID := range items[index].EvidenceIDs {
					if evidence, ok := evidences[evidenceID]; ok {
						items[index].Evidences = append(items[index].Evidences, evidence)
					}
				}
			}
			scores[resultID] = items
		}
	}
	return scores, nil
}

func (handler *Handler) loadEvidenceDetails(
	ctx context.Context,
	workspaceID uuid.UUID,
	evidenceIDs []uuid.UUID,
) (map[uuid.UUID]evidenceItem, error) {
	rows, err := handler.database.Query(ctx, `
		SELECT id, text_excerpt, page_number, start_offset, end_offset
		FROM candidate_evidences
		WHERE workspace_id = $1 AND id = ANY($2)
	`, workspaceID, evidenceIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[uuid.UUID]evidenceItem{}
	for rows.Next() {
		var item evidenceItem
		if err := rows.Scan(&item.ID, &item.Text, &item.Page, &item.StartOffset, &item.EndOffset); err != nil {
			return nil, err
		}
		result[item.ID] = item
	}
	return result, rows.Err()
}

func candidateEvidenceKey(candidateID uuid.UUID, skillName string) string {
	return candidateID.String() + "|skill:" + strings.TrimSpace(strings.ToLower(skillName))
}

func evidenceUUIDs(evidences []ai.Evidence) []uuid.UUID {
	result := make([]uuid.UUID, 0, len(evidences))
	seen := map[uuid.UUID]struct{}{}
	for _, evidence := range evidences {
		id, err := uuid.Parse(evidence.ID)
		if err != nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}
