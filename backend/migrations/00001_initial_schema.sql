-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    password_hash text NOT NULL,
    display_name text NOT NULL DEFAULT '',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT users_email_not_blank CHECK (length(trim(email)) > 3)
);
CREATE UNIQUE INDEX users_email_unique_active
    ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text NOT NULL,
    external_ai_consent boolean NOT NULL DEFAULT false,
    retention_days integer,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT workspaces_retention_days_valid CHECK (retention_days IS NULL OR retention_days > 0)
);
CREATE UNIQUE INDEX workspaces_slug_unique_active
    ON workspaces (lower(slug)) WHERE deleted_at IS NULL;

CREATE TABLE workspace_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    user_id uuid NOT NULL REFERENCES users(id),
    role text NOT NULL CHECK (role IN ('admin', 'recruiter', 'hiring_manager')),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE UNIQUE INDEX workspace_members_unique_active
    ON workspace_members (workspace_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX workspace_members_user_idx ON workspace_members (user_id, workspace_id);

CREATE TABLE refresh_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    user_id uuid NOT NULL REFERENCES users(id),
    token_hash bytea NOT NULL,
    family_id uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    replaced_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT refresh_tokens_expiry_valid CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX refresh_tokens_hash_unique ON refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_user_active_idx
    ON refresh_tokens (workspace_id, user_id, expires_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    title text NOT NULL,
    location text NOT NULL DEFAULT '',
    employment_type text NOT NULL CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'internship')),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'closed', 'archived')),
    current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE INDEX jobs_workspace_status_idx
    ON jobs (workspace_id, status, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE job_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    job_id uuid NOT NULL REFERENCES jobs(id),
    version integer NOT NULL CHECK (version > 0),
    raw_description text NOT NULL,
    parsed_document jsonb,
    parser_version text,
    prompt_version text,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT job_versions_unique UNIQUE (workspace_id, job_id, version)
);
CREATE INDEX job_versions_job_idx ON job_versions (workspace_id, job_id, version DESC);

CREATE TABLE job_requirements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    job_version_id uuid NOT NULL REFERENCES job_versions(id),
    requirement_key text NOT NULL,
    name text NOT NULL,
    requirement_type text NOT NULL CHECK (requirement_type IN ('skill', 'experience', 'education', 'certification', 'language', 'location', 'other')),
    priority text NOT NULL CHECK (priority IN ('must_have', 'nice_to_have')),
    weight numeric(8,4) NOT NULL CHECK (weight >= 0 AND weight <= 10),
    minimum_years numeric(5,2) CHECK (minimum_years IS NULL OR (minimum_years >= 0 AND minimum_years <= 80)),
    is_hard_constraint boolean NOT NULL DEFAULT false,
    description text NOT NULL DEFAULT '',
    source_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT job_requirements_key_unique UNIQUE (workspace_id, job_version_id, requirement_key)
);
CREATE INDEX job_requirements_version_idx ON job_requirements (workspace_id, job_version_id, priority);

CREATE TABLE candidates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    full_name text NOT NULL DEFAULT '',
    email text,
    phone text,
    current_title text NOT NULL DEFAULT '',
    summary text NOT NULL DEFAULT '',
    total_years_experience numeric(5,2),
    blind_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
    blind_search_text text NOT NULL DEFAULT '',
    search_document tsvector GENERATED ALWAYS AS (to_tsvector('simple', blind_search_text)) STORED,
    profile_embedding vector(768),
    profile_version text NOT NULL DEFAULT 'profile-v1',
    status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'shortlisted', 'rejected', 'saved', 'hired', 'withdrawn')),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT candidates_experience_valid CHECK (total_years_experience IS NULL OR total_years_experience >= 0)
);
CREATE INDEX candidates_workspace_status_idx
    ON candidates (workspace_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX candidates_search_document_idx ON candidates USING gin (search_document);
CREATE INDEX candidates_embedding_hnsw_idx
    ON candidates USING hnsw (profile_embedding vector_cosine_ops);

CREATE TABLE resumes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    candidate_id uuid REFERENCES candidates(id),
    status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'queued', 'parsing', 'extracting', 'embedding', 'ready', 'failed')),
    current_parse_run_id uuid,
    failure_code text,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE INDEX resumes_workspace_status_idx
    ON resumes (workspace_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX resumes_candidate_idx ON resumes (workspace_id, candidate_id);

CREATE TABLE resume_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    resume_id uuid NOT NULL REFERENCES resumes(id),
    object_key text NOT NULL,
    original_filename text NOT NULL,
    media_type text NOT NULL CHECK (media_type IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
    byte_size bigint NOT NULL CHECK (byte_size > 0),
    checksum_sha256 bytea NOT NULL,
    scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'infected', 'error')),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE UNIQUE INDEX resume_files_object_key_unique ON resume_files (object_key);
CREATE INDEX resume_files_checksum_idx ON resume_files (workspace_id, checksum_sha256);

CREATE TABLE resume_parse_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    resume_id uuid NOT NULL REFERENCES resumes(id),
    checksum_sha256 bytea NOT NULL,
    parser_version text NOT NULL,
    extraction_model_version text,
    prompt_version text,
    status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
    parsed_document jsonb,
    raw_provider_response_object_key text,
    started_at timestamptz,
    finished_at timestamptz,
    error_code text,
    error_message text,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT resume_parse_runs_idempotent UNIQUE (workspace_id, resume_id, checksum_sha256, parser_version)
);
ALTER TABLE resumes
    ADD CONSTRAINT resumes_current_parse_run_fk
    FOREIGN KEY (current_parse_run_id) REFERENCES resume_parse_runs(id);

CREATE TABLE skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES workspaces(id),
    normalized_name text NOT NULL,
    description text NOT NULL DEFAULT '',
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE UNIQUE INDEX skills_global_name_unique
    ON skills (lower(normalized_name)) WHERE workspace_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX skills_workspace_name_unique
    ON skills (workspace_id, lower(normalized_name)) WHERE workspace_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE skill_aliases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES workspaces(id),
    skill_id uuid NOT NULL REFERENCES skills(id),
    alias text NOT NULL,
    relation text NOT NULL DEFAULT 'exact_synonym' CHECK (relation IN ('exact_synonym', 'abbreviation')),
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT skill_aliases_unique UNIQUE (skill_id, alias)
);
CREATE INDEX skill_aliases_lookup_idx ON skill_aliases (lower(alias));

CREATE TABLE skill_relations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES workspaces(id),
    source_skill_id uuid NOT NULL REFERENCES skills(id),
    target_skill_id uuid NOT NULL REFERENCES skills(id),
    relation text NOT NULL CHECK (relation IN ('related_technology', 'parent', 'child', 'prerequisite', 'unrelated')),
    confidence numeric(5,4) NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT skill_relations_not_self CHECK (source_skill_id <> target_skill_id),
    CONSTRAINT skill_relations_unique UNIQUE (source_skill_id, target_skill_id, relation)
);

CREATE TABLE job_titles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES workspaces(id),
    normalized_name text NOT NULL,
    seniority text,
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE INDEX job_titles_name_idx ON job_titles (lower(normalized_name));

CREATE TABLE job_title_aliases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES workspaces(id),
    job_title_id uuid NOT NULL REFERENCES job_titles(id),
    alias text NOT NULL,
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT job_title_aliases_unique UNIQUE (job_title_id, alias)
);
CREATE INDEX job_title_aliases_lookup_idx ON job_title_aliases (lower(alias));

CREATE TABLE candidate_evidences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    candidate_id uuid NOT NULL REFERENCES candidates(id),
    resume_parse_run_id uuid NOT NULL REFERENCES resume_parse_runs(id),
    evidence_type text NOT NULL,
    text_excerpt text NOT NULL,
    page_number integer CHECK (page_number IS NULL OR page_number > 0),
    start_offset integer CHECK (start_offset IS NULL OR start_offset >= 0),
    end_offset integer CHECK (end_offset IS NULL OR end_offset >= start_offset),
    confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    extraction_method text NOT NULL CHECK (extraction_method IN ('rule', 'model', 'llm', 'human')),
    model_version text,
    prompt_version text,
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidate_evidences_candidate_idx
    ON candidate_evidences (workspace_id, candidate_id, evidence_type);

CREATE TABLE candidate_skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    candidate_id uuid NOT NULL REFERENCES candidates(id),
    skill_id uuid REFERENCES skills(id),
    stated_name text NOT NULL,
    match_kind text NOT NULL CHECK (match_kind IN ('explicit', 'related', 'inferred', 'unknown')),
    estimated_years numeric(5,2),
    last_used_at date,
    confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT candidate_skills_years_valid CHECK (estimated_years IS NULL OR estimated_years >= 0)
);
CREATE INDEX candidate_skills_candidate_idx ON candidate_skills (workspace_id, candidate_id);
CREATE INDEX candidate_skills_skill_idx ON candidate_skills (workspace_id, skill_id, candidate_id);

CREATE TABLE candidate_experiences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    candidate_id uuid NOT NULL REFERENCES candidates(id),
    company text NOT NULL DEFAULT '',
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    started_on date,
    ended_on date,
    is_current boolean NOT NULL DEFAULT false,
    evidence_id uuid REFERENCES candidate_evidences(id),
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT candidate_experiences_dates_valid CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on)
);
CREATE INDEX candidate_experiences_candidate_idx ON candidate_experiences (workspace_id, candidate_id, started_on DESC);

CREATE TABLE candidate_educations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    candidate_id uuid NOT NULL REFERENCES candidates(id),
    institution text NOT NULL,
    degree text NOT NULL DEFAULT '',
    field_of_study text NOT NULL DEFAULT '',
    started_on date,
    ended_on date,
    evidence_id uuid REFERENCES candidate_evidences(id),
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidate_educations_candidate_idx ON candidate_educations (workspace_id, candidate_id);

CREATE TABLE candidate_certifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    candidate_id uuid NOT NULL REFERENCES candidates(id),
    name text NOT NULL,
    issuer text NOT NULL DEFAULT '',
    issued_on date,
    expires_on date,
    evidence_id uuid REFERENCES candidate_evidences(id),
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidate_certifications_candidate_idx ON candidate_certifications (workspace_id, candidate_id);

CREATE TABLE candidate_languages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    candidate_id uuid NOT NULL REFERENCES candidates(id),
    language text NOT NULL,
    proficiency text,
    evidence_id uuid REFERENCES candidate_evidences(id),
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidate_languages_candidate_idx ON candidate_languages (workspace_id, candidate_id);

CREATE TABLE model_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES workspaces(id),
    model_name text NOT NULL,
    model_version text NOT NULL,
    feature_schema_version text NOT NULL,
    training_dataset_version text,
    evaluation_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT model_versions_unique UNIQUE (workspace_id, model_name, model_version)
);

CREATE TABLE prompt_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES workspaces(id),
    prompt_name text NOT NULL,
    prompt_version text NOT NULL,
    template_sha256 bytea NOT NULL,
    schema_version text NOT NULL,
    is_active boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT prompt_versions_unique UNIQUE (workspace_id, prompt_name, prompt_version)
);

CREATE TABLE feature_schema_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES workspaces(id),
    version text NOT NULL,
    schema_definition jsonb NOT NULL,
    is_active boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT feature_schema_versions_unique UNIQUE (workspace_id, version)
);

CREATE TABLE ranking_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    job_id uuid NOT NULL REFERENCES jobs(id),
    job_version_id uuid NOT NULL REFERENCES job_versions(id),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    requirement_snapshot jsonb NOT NULL,
    weight_snapshot jsonb NOT NULL,
    model_version text NOT NULL,
    prompt_version text,
    feature_schema_version text NOT NULL,
    candidate_count integer NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
    started_at timestamptz,
    finished_at timestamptz,
    error_code text,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ranking_runs_job_idx ON ranking_runs (workspace_id, job_id, created_at DESC);
CREATE INDEX ranking_runs_status_idx ON ranking_runs (workspace_id, status, created_at);

CREATE TABLE ranking_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    ranking_run_id uuid NOT NULL REFERENCES ranking_runs(id),
    candidate_id uuid NOT NULL REFERENCES candidates(id),
    rank integer NOT NULL CHECK (rank > 0),
    final_score numeric(7,6) NOT NULL CHECK (final_score >= 0 AND final_score <= 1),
    retrieval_score numeric(7,6),
    rule_score numeric(7,6),
    model_score numeric(7,6),
    llm_rerank_score numeric(7,6),
    confidence numeric(7,6) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    eligibility_status text NOT NULL CHECK (eligibility_status IN ('eligible', 'potentially_eligible', 'constraint_unknown', 'constraint_failed')),
    strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
    gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
    unknowns jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ranking_results_candidate_unique UNIQUE (workspace_id, ranking_run_id, candidate_id),
    CONSTRAINT ranking_results_rank_unique UNIQUE (workspace_id, ranking_run_id, rank)
);
CREATE INDEX ranking_results_candidate_idx
    ON ranking_results (workspace_id, candidate_id, created_at DESC);

CREATE TABLE ranking_requirement_scores (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    ranking_result_id uuid NOT NULL REFERENCES ranking_results(id),
    requirement_key text NOT NULL,
    status text NOT NULL CHECK (status IN ('met', 'partially_met', 'not_found', 'not_met', 'unknown')),
    score numeric(7,6) NOT NULL CHECK (score >= 0 AND score <= 1),
    confidence numeric(7,6) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    evidence_ids uuid[] NOT NULL DEFAULT '{}',
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ranking_requirement_scores_unique UNIQUE (workspace_id, ranking_result_id, requirement_key)
);

CREATE TABLE ranking_explanations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    ranking_result_id uuid NOT NULL REFERENCES ranking_results(id),
    explanation_type text NOT NULL CHECK (explanation_type IN ('strength', 'gap', 'unknown', 'constraint')),
    structured_explanation jsonb NOT NULL,
    evidence_ids uuid[] NOT NULL DEFAULT '{}',
    model_version text NOT NULL,
    prompt_version text,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ranking_explanations_result_idx ON ranking_explanations (workspace_id, ranking_result_id);

CREATE TABLE candidate_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    candidate_id uuid NOT NULL REFERENCES candidates(id),
    job_id uuid REFERENCES jobs(id),
    ranking_run_id uuid REFERENCES ranking_runs(id),
    label integer CHECK (label BETWEEN 0 AND 4),
    feedback_type text NOT NULL,
    comment text NOT NULL DEFAULT '',
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidate_feedback_candidate_idx ON candidate_feedback (workspace_id, candidate_id, created_at DESC);

CREATE TABLE candidate_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    candidate_id uuid NOT NULL REFERENCES candidates(id),
    job_id uuid REFERENCES jobs(id),
    vote text CHECK (vote IN ('approve', 'neutral', 'decline')),
    comment text NOT NULL DEFAULT '',
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidate_reviews_candidate_idx ON candidate_reviews (workspace_id, candidate_id, created_at DESC);

CREATE TABLE candidate_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    candidate_id uuid NOT NULL REFERENCES candidates(id),
    job_id uuid REFERENCES jobs(id),
    from_status text,
    to_status text NOT NULL,
    reason text NOT NULL DEFAULT '',
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidate_status_history_idx ON candidate_status_history (workspace_id, candidate_id, created_at DESC);

CREATE TABLE background_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    job_type text NOT NULL,
    payload_version integer NOT NULL DEFAULT 1 CHECK (payload_version > 0),
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'running', 'retrying', 'succeeded', 'failed', 'dead_letter')),
    stage text NOT NULL DEFAULT '',
    progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    max_attempts integer NOT NULL CHECK (max_attempts > 0),
    timeout_seconds integer NOT NULL CHECK (timeout_seconds > 0),
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    error_code text,
    error_message text,
    result_reference jsonb,
    run_after timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    heartbeat_at timestamptz,
    finished_at timestamptz,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT background_jobs_idempotent UNIQUE (workspace_id, idempotency_key)
);
CREATE INDEX background_jobs_pending_idx
    ON background_jobs (status, run_after, created_at) WHERE status IN ('pending', 'retrying');
CREATE INDEX background_jobs_workspace_idx ON background_jobs (workspace_id, status, created_at DESC);

CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    actor_user_id uuid REFERENCES users(id),
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid,
    request_id text NOT NULL,
    correlation_id text NOT NULL,
    ip_hash bytea,
    user_agent_hash bytea,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_workspace_time_idx ON audit_logs (workspace_id, created_at DESC);
CREATE INDEX audit_logs_resource_idx ON audit_logs (workspace_id, resource_type, resource_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS background_jobs;
DROP TABLE IF EXISTS candidate_status_history;
DROP TABLE IF EXISTS candidate_reviews;
DROP TABLE IF EXISTS candidate_feedback;
DROP TABLE IF EXISTS ranking_explanations;
DROP TABLE IF EXISTS ranking_requirement_scores;
DROP TABLE IF EXISTS ranking_results;
DROP TABLE IF EXISTS ranking_runs;
DROP TABLE IF EXISTS feature_schema_versions;
DROP TABLE IF EXISTS prompt_versions;
DROP TABLE IF EXISTS model_versions;
DROP TABLE IF EXISTS candidate_languages;
DROP TABLE IF EXISTS candidate_certifications;
DROP TABLE IF EXISTS candidate_educations;
DROP TABLE IF EXISTS candidate_experiences;
DROP TABLE IF EXISTS candidate_skills;
DROP TABLE IF EXISTS candidate_evidences;
DROP TABLE IF EXISTS job_title_aliases;
DROP TABLE IF EXISTS job_titles;
DROP TABLE IF EXISTS skill_relations;
DROP TABLE IF EXISTS skill_aliases;
DROP TABLE IF EXISTS skills;
ALTER TABLE IF EXISTS resumes DROP CONSTRAINT IF EXISTS resumes_current_parse_run_fk;
DROP TABLE IF EXISTS resume_parse_runs;
DROP TABLE IF EXISTS resume_files;
DROP TABLE IF EXISTS resumes;
DROP TABLE IF EXISTS candidates;
DROP TABLE IF EXISTS job_requirements;
DROP TABLE IF EXISTS job_versions;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS workspace_members;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS users;
DROP EXTENSION IF EXISTS vector;
DROP EXTENSION IF EXISTS pgcrypto;

