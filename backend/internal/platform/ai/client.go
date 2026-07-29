package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"time"
)

type Evidence struct {
	ID          string `json:"id"`
	Text        string `json:"text"`
	Page        *int   `json:"page,omitempty"`
	StartOffset *int   `json:"start_offset,omitempty"`
	EndOffset   *int   `json:"end_offset,omitempty"`
}

type Requirement struct {
	Key              string     `json:"requirement_key"`
	Name             string     `json:"name"`
	Type             string     `json:"requirement_type"`
	Priority         string     `json:"priority"`
	Weight           float64    `json:"weight"`
	MinimumYears     *float64   `json:"minimum_years,omitempty"`
	IsHardConstraint bool       `json:"is_hard_constraint"`
	Description      string     `json:"description"`
	SourceEvidence   []Evidence `json:"source_evidence"`
}

type JobParseResult struct {
	Title         string        `json:"title"`
	Summary       string        `json:"summary"`
	Seniority     *string       `json:"seniority"`
	Requirements  []Requirement `json:"requirements"`
	ParserVersion string        `json:"parser_version"`
}

type DocumentPage struct {
	Number      int    `json:"number"`
	Text        string `json:"text"`
	StartOffset int    `json:"start_offset"`
	EndOffset   int    `json:"end_offset"`
}

type ParsedDocument struct {
	Text          string         `json:"text"`
	Pages         []DocumentPage `json:"pages"`
	Metadata      map[string]any `json:"metadata"`
	ParserVersion string         `json:"parser_version"`
	UsedOCR       bool           `json:"used_ocr"`
}

type StringField struct {
	Value      string     `json:"value"`
	Confidence float64    `json:"confidence"`
	Evidences  []Evidence `json:"evidences"`
}

type NumberField struct {
	Value      float64    `json:"value"`
	Confidence float64    `json:"confidence"`
	Evidences  []Evidence `json:"evidences"`
}

type ExtractedSkill struct {
	Name           string     `json:"name"`
	NormalizedName *string    `json:"normalized_name"`
	MatchKind      string     `json:"match_kind"`
	EstimatedYears *float64   `json:"estimated_years"`
	Confidence     float64    `json:"confidence"`
	Evidences      []Evidence `json:"evidences"`
}

type CandidateExtraction struct {
	FullName             *StringField     `json:"full_name"`
	Email                *StringField     `json:"email"`
	Phone                *StringField     `json:"phone"`
	CurrentTitle         *StringField     `json:"current_title"`
	Summary              *StringField     `json:"summary"`
	TotalYearsExperience *NumberField     `json:"total_years_experience"`
	Skills               []ExtractedSkill `json:"skills"`
	ExtractionVersion    string           `json:"extraction_model_version"`
	PromptVersion        *string          `json:"prompt_version"`
}

type ResumeAnalysis struct {
	Document  ParsedDocument      `json:"document"`
	Candidate CandidateExtraction `json:"candidate"`
}

type RankingSkill struct {
	Name           string     `json:"name"`
	EstimatedYears *float64   `json:"estimated_years,omitempty"`
	Evidences      []Evidence `json:"evidences"`
}

type RankingCandidate struct {
	CandidateID          string         `json:"candidate_id"`
	CurrentTitle         string         `json:"current_title"`
	TotalYearsExperience *float64       `json:"total_years_experience,omitempty"`
	Skills               []RankingSkill `json:"skills"`
}

type RequirementAssessment struct {
	RequirementID string     `json:"requirement_id"`
	Status        string     `json:"status"`
	Score         float64    `json:"score"`
	Confidence    float64    `json:"confidence"`
	Evidences     []Evidence `json:"evidences"`
}

type RankedCandidate struct {
	CandidateID            string                  `json:"candidate_id"`
	Rank                   int                     `json:"rank"`
	FinalScore             float64                 `json:"final_score"`
	Confidence             float64                 `json:"confidence"`
	EligibilityStatus      string                  `json:"eligibility_status"`
	Strengths              []string                `json:"strengths"`
	Gaps                   []string                `json:"gaps"`
	Unknowns               []string                `json:"unknowns"`
	RequirementAssessments []RequirementAssessment `json:"requirement_assessments"`
	ModelVersion           string                  `json:"model_version"`
	FeatureSchemaVersion   string                  `json:"feature_schema_version"`
}

type RankingResponse struct {
	Results              []RankedCandidate `json:"results"`
	ModelVersion         string            `json:"model_version"`
	FeatureSchemaVersion string            `json:"feature_schema_version"`
}

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 45 * time.Second,
		},
	}
}

func (client *Client) ParseJob(ctx context.Context, title, description string) (JobParseResult, error) {
	var result JobParseResult
	err := client.doJSON(ctx, http.MethodPost, "/internal/v1/jobs/parse", map[string]string{
		"title": title, "description": description,
	}, &result)
	return result, err
}

func (client *Client) AnalyzeResume(ctx context.Context, filename, mediaType string, data []byte) (ResumeAnalysis, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return ResumeAnalysis{}, fmt.Errorf("create AI multipart file: %w", err)
	}
	if _, err := part.Write(data); err != nil {
		return ResumeAnalysis{}, fmt.Errorf("write AI multipart file: %w", err)
	}
	if err := writer.Close(); err != nil {
		return ResumeAnalysis{}, fmt.Errorf("close AI multipart body: %w", err)
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		client.baseURL+"/internal/v1/documents/analyze",
		&body,
	)
	if err != nil {
		return ResumeAnalysis{}, fmt.Errorf("create AI analysis request: %w", err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("X-File-Media-Type", mediaType)
	var result ResumeAnalysis
	if err := client.send(request, &result); err != nil {
		return ResumeAnalysis{}, err
	}
	return result, nil
}

func (client *Client) Score(ctx context.Context, requirements []Requirement, candidates []RankingCandidate) (RankingResponse, error) {
	var result RankingResponse
	err := client.doJSON(ctx, http.MethodPost, "/internal/v1/rankings/score", map[string]any{
		"requirements": requirements,
		"candidates":   candidates,
	}, &result)
	return result, err
}

func (client *Client) doJSON(ctx context.Context, method, path string, input, output any) error {
	encoded, err := json.Marshal(input)
	if err != nil {
		return fmt.Errorf("encode AI request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, method, client.baseURL+path, bytes.NewReader(encoded))
	if err != nil {
		return fmt.Errorf("create AI request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	return client.send(request, output)
}

func (client *Client) send(request *http.Request, output any) error {
	response, err := client.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("call AI service: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("AI service returned %d: %s", response.StatusCode, string(body))
	}
	if err := json.NewDecoder(response.Body).Decode(output); err != nil {
		return fmt.Errorf("decode AI response: %w", err)
	}
	return nil
}
