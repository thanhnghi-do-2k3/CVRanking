// Package resume owns bulk CV ingestion, structured profiles, evidence, and candidate status.
package resume

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"net/http"
	"path/filepath"
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
	"github.com/talentrank/talentrank/backend/internal/platform/objectstore"
)

const (
	maxFileSize = 10 << 20
	maxFiles    = 50
)

type Handler struct {
	database *pgxpool.Pool
	ai       *ai.Client
	storage  *objectstore.Storage
	logger   *slog.Logger
}

func NewHandler(
	database *pgxpool.Pool,
	aiClient *ai.Client,
	storage *objectstore.Storage,
	logger *slog.Logger,
) *Handler {
	return &Handler{database: database, ai: aiClient, storage: storage, logger: logger}
}

func (handler *Handler) RegisterRoutes(router chi.Router, basePath string) {
	router.Post(basePath+"/resumes/bulk-upload", handler.bulkUpload)
	router.Get(basePath+"/jobs/{jobId}/candidates", handler.listCandidates)
	router.Get(basePath+"/candidates/{candidateId}", handler.candidateDetail)
	router.Patch(basePath+"/candidates/{candidateId}/status", handler.updateCandidateStatus)
	router.Get(basePath+"/resumes/{resumeId}/file", handler.downloadFile)
}

type uploadItem struct {
	ResumeID     uuid.UUID `json:"resume_id"`
	CandidateID  uuid.UUID `json:"candidate_id"`
	Filename     string    `json:"filename"`
	Status       string    `json:"status"`
	FullName     string    `json:"full_name"`
	CurrentTitle string    `json:"current_title"`
	Skills       []string  `json:"skills"`
	Error        string    `json:"error,omitempty"`
}

func (handler *Handler) bulkUpload(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	if principal.Role != auth.RoleAdmin && principal.Role != auth.RoleRecruiter {
		httpapi.Problem(writer, request, http.StatusForbidden, "forbidden", "Recruiter access is required.")
		return
	}
	request.Body = http.MaxBytesReader(writer, request.Body, maxFiles*maxFileSize+(2<<20))
	if err := request.ParseMultipartForm(maxFiles * maxFileSize); err != nil {
		httpapi.Problem(writer, request, http.StatusRequestEntityTooLarge, "upload_too_large", "The upload exceeds the allowed size.")
		return
	}
	jobID, err := uuid.Parse(strings.TrimSpace(request.FormValue("job_id")))
	if err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "A valid job_id is required.")
		return
	}
	var jobExists bool
	err = handler.database.QueryRow(request.Context(), `
		SELECT EXISTS (
			SELECT 1 FROM jobs
			WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
		)
	`, jobID, principal.WorkspaceID).Scan(&jobExists)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	if !jobExists {
		httpapi.Problem(writer, request, http.StatusNotFound, "not_found", "The job was not found.")
		return
	}
	files := request.MultipartForm.File["files"]
	if len(files) == 0 || len(files) > maxFiles {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "Upload between 1 and 50 PDF or DOCX files.")
		return
	}
	items := make([]uploadItem, 0, len(files))
	accepted := 0
	failed := 0
	for _, file := range files {
		item, err := handler.processFile(request, principal, jobID, file)
		if err != nil {
			handler.logger.WarnContext(
				request.Context(),
				"resume_processing_failed",
				"filename", filepath.Base(file.Filename),
				"error", err,
			)
			items = append(items, uploadItem{
				Filename: filepath.Base(file.Filename),
				Status:   "failed",
				Error:    userFacingUploadError(err),
			})
			failed++
			continue
		}
		items = append(items, item)
		accepted++
	}
	httpapi.WriteJSON(writer, http.StatusCreated, map[string]any{
		"items": items, "accepted": accepted, "failed": failed,
	})
}

func (handler *Handler) processFile(
	request *http.Request,
	principal auth.Principal,
	jobID uuid.UUID,
	fileHeader *multipart.FileHeader,
) (uploadItem, error) {
	filename := filepath.Base(strings.TrimSpace(fileHeader.Filename))
	mediaType, err := supportedMediaType(filename, fileHeader.Header.Get("Content-Type"))
	if err != nil {
		return uploadItem{}, err
	}
	if fileHeader.Size <= 0 || fileHeader.Size > maxFileSize {
		return uploadItem{}, errors.New("file_size_invalid")
	}
	file, err := fileHeader.Open()
	if err != nil {
		return uploadItem{}, fmt.Errorf("open upload: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxFileSize+1))
	if err != nil {
		return uploadItem{}, fmt.Errorf("read upload: %w", err)
	}
	if len(data) == 0 || len(data) > maxFileSize {
		return uploadItem{}, errors.New("file_size_invalid")
	}
	checksum := sha256.Sum256(data)

	var duplicate uploadItem
	err = handler.database.QueryRow(request.Context(), `
		SELECT r.id, c.id, rf.original_filename, c.full_name, c.current_title
		FROM resume_files rf
		JOIN resumes r ON r.id = rf.resume_id AND r.workspace_id = rf.workspace_id
		JOIN candidates c ON c.id = r.candidate_id AND c.workspace_id = r.workspace_id
		WHERE rf.workspace_id = $1
		  AND rf.checksum_sha256 = $2
		  AND rf.deleted_at IS NULL
		  AND r.deleted_at IS NULL
		  AND c.deleted_at IS NULL
		ORDER BY rf.created_at DESC
		LIMIT 1
	`, principal.WorkspaceID, checksum[:]).Scan(
		&duplicate.ResumeID, &duplicate.CandidateID, &duplicate.Filename,
		&duplicate.FullName, &duplicate.CurrentTitle,
	)
	if err == nil {
		_, err = handler.database.Exec(request.Context(), `
			INSERT INTO job_candidates (
				workspace_id, job_id, candidate_id, resume_id, created_by
			)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (workspace_id, job_id, candidate_id) DO NOTHING
		`, principal.WorkspaceID, jobID, duplicate.CandidateID, duplicate.ResumeID, principal.UserID)
		if err != nil {
			return uploadItem{}, err
		}
		duplicate.Status = "duplicate"
		duplicate.Skills = []string{}
		return duplicate, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uploadItem{}, err
	}

	analysis, err := handler.ai.AnalyzeResume(request.Context(), filename, mediaType, data)
	if err != nil {
		return uploadItem{}, fmt.Errorf("analyze resume: %w", err)
	}
	candidateID := uuid.New()
	resumeID := uuid.New()
	fileID := uuid.New()
	parseRunID := uuid.New()
	objectKey := fmt.Sprintf(
		"%s/%s/%s/%s%s",
		principal.WorkspaceID,
		jobID,
		resumeID,
		fileID,
		strings.ToLower(filepath.Ext(filename)),
	)
	if err := handler.storage.Put(
		request.Context(), objectKey, mediaType, bytes.NewReader(data), int64(len(data)),
	); err != nil {
		return uploadItem{}, err
	}

	fullName := fieldString(analysis.Candidate.FullName)
	if fullName == "" {
		fullName = strings.TrimSpace(strings.NewReplacer("_", " ", "-", " ").Replace(
			strings.TrimSuffix(filename, filepath.Ext(filename)),
		))
	}
	currentTitle := fieldString(analysis.Candidate.CurrentTitle)
	summary := fieldString(analysis.Candidate.Summary)
	email := nullableFieldString(analysis.Candidate.Email)
	phone := nullableFieldString(analysis.Candidate.Phone)
	totalYears := nullableFieldNumber(analysis.Candidate.TotalYearsExperience)
	skillNames := make([]string, 0, len(analysis.Candidate.Skills))
	blindSkills := make([]map[string]any, 0, len(analysis.Candidate.Skills))
	for _, skill := range analysis.Candidate.Skills {
		name := skill.Name
		if skill.NormalizedName != nil {
			name = *skill.NormalizedName
		}
		skillNames = append(skillNames, name)
		blindSkills = append(blindSkills, map[string]any{
			"name": name, "estimated_years": skill.EstimatedYears,
		})
	}
	blindProfile, _ := json.Marshal(map[string]any{
		"current_title":          currentTitle,
		"total_years_experience": totalYears,
		"skills":                 blindSkills,
	})
	parsedDocument, _ := json.Marshal(analysis.Document)
	blindSearchText := strings.Join(append([]string{currentTitle}, skillNames...), " ")

	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		return uploadItem{}, err
	}
	defer transaction.Rollback(request.Context())
	_, err = transaction.Exec(request.Context(), `
		INSERT INTO candidates (
			id, workspace_id, full_name, email, phone, current_title, summary,
			total_years_experience, blind_profile, blind_search_text, created_by
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, candidateID, principal.WorkspaceID, fullName, email, phone, currentTitle,
		summary, totalYears, blindProfile, blindSearchText, principal.UserID)
	if err != nil {
		return uploadItem{}, err
	}
	_, err = transaction.Exec(request.Context(), `
		INSERT INTO resumes (
			id, workspace_id, candidate_id, status, created_by
		)
		VALUES ($1, $2, $3, 'ready', $4)
	`, resumeID, principal.WorkspaceID, candidateID, principal.UserID)
	if err != nil {
		return uploadItem{}, err
	}
	_, err = transaction.Exec(request.Context(), `
		INSERT INTO resume_files (
			id, workspace_id, resume_id, object_key, original_filename,
			media_type, byte_size, checksum_sha256, scan_status, created_by
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'clean', $9)
	`, fileID, principal.WorkspaceID, resumeID, objectKey, filename, mediaType,
		len(data), checksum[:], principal.UserID)
	if err != nil {
		return uploadItem{}, err
	}
	_, err = transaction.Exec(request.Context(), `
		INSERT INTO resume_parse_runs (
			id, workspace_id, resume_id, checksum_sha256, parser_version,
			extraction_model_version, status, parsed_document, started_at,
			finished_at, created_by
		)
		VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', $7, now(), now(), $8)
	`, parseRunID, principal.WorkspaceID, resumeID, checksum[:],
		analysis.Document.ParserVersion, analysis.Candidate.ExtractionVersion,
		parsedDocument, principal.UserID)
	if err != nil {
		return uploadItem{}, err
	}
	_, err = transaction.Exec(request.Context(), `
		UPDATE resumes SET current_parse_run_id = $2, updated_at = now() WHERE id = $1
	`, resumeID, parseRunID)
	if err != nil {
		return uploadItem{}, err
	}
	_, err = transaction.Exec(request.Context(), `
		INSERT INTO job_candidates (
			workspace_id, job_id, candidate_id, resume_id, created_by
		)
		VALUES ($1, $2, $3, $4, $5)
	`, principal.WorkspaceID, jobID, candidateID, resumeID, principal.UserID)
	if err != nil {
		return uploadItem{}, err
	}
	for _, skill := range analysis.Candidate.Skills {
		name := skill.Name
		if skill.NormalizedName != nil {
			name = *skill.NormalizedName
		}
		for _, evidence := range skill.Evidences {
			evidenceID := uuid.New()
			_, err = transaction.Exec(request.Context(), `
				INSERT INTO candidate_evidences (
					id, workspace_id, candidate_id, resume_parse_run_id, evidence_type,
					text_excerpt, page_number, start_offset, end_offset, confidence,
					extraction_method, model_version, created_by
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'rule', $11, $12)
			`, evidenceID, principal.WorkspaceID, candidateID, parseRunID,
				"skill:"+strings.ToLower(name), evidence.Text, evidence.Page,
				evidence.StartOffset, evidence.EndOffset, skill.Confidence,
				analysis.Candidate.ExtractionVersion, principal.UserID)
			if err != nil {
				return uploadItem{}, err
			}
		}
		_, err = transaction.Exec(request.Context(), `
			INSERT INTO candidate_skills (
				workspace_id, candidate_id, stated_name, match_kind,
				estimated_years, confidence, created_by
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, principal.WorkspaceID, candidateID, name, skill.MatchKind,
			skill.EstimatedYears, skill.Confidence, principal.UserID)
		if err != nil {
			return uploadItem{}, err
		}
	}
	if err := audit.Write(
		request.Context(), transaction, principal.WorkspaceID, principal.UserID,
		"resume.uploaded", "resume", &resumeID, request,
		map[string]any{
			"job_id": jobID, "candidate_id": candidateID,
			"filename": filename, "skill_count": len(skillNames),
		},
	); err != nil {
		return uploadItem{}, err
	}
	if err := transaction.Commit(request.Context()); err != nil {
		return uploadItem{}, err
	}
	return uploadItem{
		ResumeID: resumeID, CandidateID: candidateID, Filename: filename,
		Status: "ready", FullName: fullName, CurrentTitle: currentTitle, Skills: skillNames,
	}, nil
}

type candidateListItem struct {
	ID                   uuid.UUID `json:"id"`
	ResumeID             uuid.UUID `json:"resume_id"`
	FullName             string    `json:"full_name"`
	CurrentTitle         string    `json:"current_title"`
	TotalYearsExperience *float64  `json:"total_years_experience,omitempty"`
	Status               string    `json:"status"`
	ResumeStatus         string    `json:"resume_status"`
	Filename             string    `json:"filename"`
	Skills               []string  `json:"skills"`
	CreatedAt            time.Time `json:"created_at"`
}

func (handler *Handler) listCandidates(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	jobID, err := uuid.Parse(chi.URLParam(request, "jobId"))
	if err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The job ID is invalid.")
		return
	}
	rows, err := handler.database.Query(request.Context(), `
		SELECT c.id, r.id, c.full_name, c.current_title, c.total_years_experience,
		       c.status, r.status, rf.original_filename, c.created_at,
		       COALESCE(array_agg(DISTINCT cs.stated_name)
		                FILTER (WHERE cs.stated_name IS NOT NULL), '{}')
		FROM job_candidates jc
		JOIN candidates c
		  ON c.id = jc.candidate_id AND c.workspace_id = jc.workspace_id
		JOIN resumes r
		  ON r.id = jc.resume_id AND r.workspace_id = jc.workspace_id
		JOIN resume_files rf
		  ON rf.resume_id = r.id AND rf.workspace_id = r.workspace_id AND rf.deleted_at IS NULL
		LEFT JOIN candidate_skills cs
		  ON cs.candidate_id = c.id AND cs.workspace_id = c.workspace_id
		WHERE jc.workspace_id = $1 AND jc.job_id = $2
		  AND c.deleted_at IS NULL AND r.deleted_at IS NULL
		GROUP BY c.id, r.id, rf.id
		ORDER BY c.created_at DESC
	`, principal.WorkspaceID, jobID)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	defer rows.Close()
	items := make([]candidateListItem, 0)
	for rows.Next() {
		var item candidateListItem
		if err := rows.Scan(
			&item.ID, &item.ResumeID, &item.FullName, &item.CurrentTitle,
			&item.TotalYearsExperience, &item.Status, &item.ResumeStatus,
			&item.Filename, &item.CreatedAt, &item.Skills,
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

type evidenceResponse struct {
	ID          uuid.UUID `json:"id"`
	Type        string    `json:"type"`
	Text        string    `json:"text"`
	Page        *int      `json:"page,omitempty"`
	StartOffset *int      `json:"start_offset,omitempty"`
	EndOffset   *int      `json:"end_offset,omitempty"`
	Confidence  float64   `json:"confidence"`
}

func (handler *Handler) candidateDetail(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	candidateID, err := uuid.Parse(chi.URLParam(request, "candidateId"))
	if err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The candidate ID is invalid.")
		return
	}
	var candidate candidateListItem
	var email, phone *string
	var summary string
	err = handler.database.QueryRow(request.Context(), `
		SELECT c.id, r.id, c.full_name, c.current_title, c.total_years_experience,
		       c.status, r.status, rf.original_filename, c.created_at,
		       c.email, c.phone, c.summary
		FROM candidates c
		JOIN resumes r
		  ON r.candidate_id = c.id AND r.workspace_id = c.workspace_id AND r.deleted_at IS NULL
		JOIN resume_files rf
		  ON rf.resume_id = r.id AND rf.workspace_id = r.workspace_id AND rf.deleted_at IS NULL
		WHERE c.id = $1 AND c.workspace_id = $2 AND c.deleted_at IS NULL
		ORDER BY r.created_at DESC
		LIMIT 1
	`, candidateID, principal.WorkspaceID).Scan(
		&candidate.ID, &candidate.ResumeID, &candidate.FullName, &candidate.CurrentTitle,
		&candidate.TotalYearsExperience, &candidate.Status, &candidate.ResumeStatus,
		&candidate.Filename, &candidate.CreatedAt, &email, &phone, &summary,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Problem(writer, request, http.StatusNotFound, "not_found", "The candidate was not found.")
		return
	}
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	skillRows, err := handler.database.Query(request.Context(), `
		SELECT stated_name FROM candidate_skills
		WHERE workspace_id = $1 AND candidate_id = $2
		ORDER BY confidence DESC, stated_name
	`, principal.WorkspaceID, candidateID)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	defer skillRows.Close()
	candidate.Skills = make([]string, 0)
	for skillRows.Next() {
		var skill string
		if err := skillRows.Scan(&skill); err != nil {
			httpapi.Internal(writer, request, handler.logger, err)
			return
		}
		candidate.Skills = append(candidate.Skills, skill)
	}
	evidenceRows, err := handler.database.Query(request.Context(), `
		SELECT id, evidence_type, text_excerpt, page_number, start_offset, end_offset, confidence
		FROM candidate_evidences
		WHERE workspace_id = $1 AND candidate_id = $2
		ORDER BY created_at
	`, principal.WorkspaceID, candidateID)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	defer evidenceRows.Close()
	evidences := make([]evidenceResponse, 0)
	for evidenceRows.Next() {
		var evidence evidenceResponse
		if err := evidenceRows.Scan(
			&evidence.ID, &evidence.Type, &evidence.Text, &evidence.Page,
			&evidence.StartOffset, &evidence.EndOffset, &evidence.Confidence,
		); err != nil {
			httpapi.Internal(writer, request, handler.logger, err)
			return
		}
		evidences = append(evidences, evidence)
	}
	httpapi.WriteJSON(writer, http.StatusOK, map[string]any{
		"candidate": candidate, "email": email, "phone": phone,
		"summary": summary, "evidences": evidences,
	})
}

type statusRequest struct {
	Status string    `json:"status"`
	JobID  uuid.UUID `json:"job_id"`
	Reason string    `json:"reason"`
}

func (handler *Handler) updateCandidateStatus(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	candidateID, err := uuid.Parse(chi.URLParam(request, "candidateId"))
	if err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The candidate ID is invalid.")
		return
	}
	var input statusRequest
	if err := httpapi.DecodeJSON(writer, request, &input, 16<<10); err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The status payload is invalid.")
		return
	}
	input.Status = strings.TrimSpace(input.Status)
	if !validCandidateStatus(input.Status) {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The candidate status is invalid.")
		return
	}
	transaction, err := handler.database.Begin(request.Context())
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	defer transaction.Rollback(request.Context())
	var previous string
	err = transaction.QueryRow(request.Context(), `
		SELECT status FROM candidates
		WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, candidateID, principal.WorkspaceID).Scan(&previous)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Problem(writer, request, http.StatusNotFound, "not_found", "The candidate was not found.")
		return
	}
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	_, err = transaction.Exec(request.Context(), `
		UPDATE candidates SET status = $3, updated_at = now()
		WHERE id = $1 AND workspace_id = $2
	`, candidateID, principal.WorkspaceID, input.Status)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	var jobID *uuid.UUID
	if input.JobID != uuid.Nil {
		jobID = &input.JobID
	}
	_, err = transaction.Exec(request.Context(), `
		INSERT INTO candidate_status_history (
			workspace_id, candidate_id, job_id, from_status, to_status, reason, created_by
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, principal.WorkspaceID, candidateID, jobID, previous, input.Status,
		strings.TrimSpace(input.Reason), principal.UserID)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	if err := audit.Write(
		request.Context(), transaction, principal.WorkspaceID, principal.UserID,
		"candidate.status_changed", "candidate", &candidateID, request,
		map[string]any{"from": previous, "to": input.Status, "job_id": jobID},
	); err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	if err := transaction.Commit(request.Context()); err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	httpapi.WriteJSON(writer, http.StatusOK, map[string]any{
		"candidate_id": candidateID, "status": input.Status,
	})
}

func (handler *Handler) downloadFile(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	resumeID, err := uuid.Parse(chi.URLParam(request, "resumeId"))
	if err != nil {
		httpapi.Problem(writer, request, http.StatusUnprocessableEntity, "validation_error", "The resume ID is invalid.")
		return
	}
	var objectKey, filename, mediaType string
	err = handler.database.QueryRow(request.Context(), `
		SELECT rf.object_key, rf.original_filename, rf.media_type
		FROM resume_files rf
		JOIN resumes r ON r.id = rf.resume_id AND r.workspace_id = rf.workspace_id
		WHERE r.id = $1 AND r.workspace_id = $2
		  AND r.deleted_at IS NULL AND rf.deleted_at IS NULL
		ORDER BY rf.created_at DESC
		LIMIT 1
	`, resumeID, principal.WorkspaceID).Scan(&objectKey, &filename, &mediaType)
	if errors.Is(err, pgx.ErrNoRows) {
		httpapi.Problem(writer, request, http.StatusNotFound, "not_found", "The resume file was not found.")
		return
	}
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	object, err := handler.storage.Get(request.Context(), objectKey)
	if err != nil {
		httpapi.Internal(writer, request, handler.logger, err)
		return
	}
	defer object.Close()
	writer.Header().Set("Content-Type", mediaType)
	writer.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": filename}))
	writer.Header().Set("Cache-Control", "private, no-store")
	if _, err := io.Copy(writer, object); err != nil {
		handler.logger.ErrorContext(request.Context(), "resume_stream_failed", "error", err, "resume_id", resumeID)
	}
}

func supportedMediaType(filename, header string) (string, error) {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".pdf":
		return "application/pdf", nil
	case ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document", nil
	default:
		_ = header
		return "", errors.New("unsupported_file_type")
	}
}

func fieldString(field *ai.StringField) string {
	if field == nil {
		return ""
	}
	return strings.TrimSpace(field.Value)
}

func nullableFieldString(field *ai.StringField) *string {
	value := fieldString(field)
	if value == "" {
		return nil
	}
	return &value
}

func nullableFieldNumber(field *ai.NumberField) *float64 {
	if field == nil {
		return nil
	}
	return &field.Value
}

func validCandidateStatus(value string) bool {
	return value == "new" || value == "reviewing" || value == "shortlisted" ||
		value == "rejected" || value == "saved" || value == "hired" ||
		value == "withdrawn"
}

func userFacingUploadError(err error) string {
	switch {
	case errors.Is(err, errors.New("unsupported_file_type")) || strings.Contains(err.Error(), "unsupported_file_type"):
		return "Chỉ hỗ trợ tệp PDF hoặc DOCX."
	case strings.Contains(err.Error(), "file_size_invalid"):
		return "Tệp phải có dung lượng từ 1 byte đến 10 MiB."
	case strings.Contains(err.Error(), "extractable text layer"):
		return "Không đọc được lớp văn bản trong CV."
	default:
		return "Không thể xử lý CV này."
	}
}
