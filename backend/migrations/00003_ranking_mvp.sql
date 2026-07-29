-- +goose Up
CREATE TABLE job_candidates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    job_id uuid NOT NULL REFERENCES jobs(id),
    candidate_id uuid NOT NULL REFERENCES candidates(id),
    resume_id uuid NOT NULL REFERENCES resumes(id),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT job_candidates_unique UNIQUE (workspace_id, job_id, candidate_id)
);

CREATE INDEX job_candidates_job_idx
    ON job_candidates (workspace_id, job_id, created_at DESC);
CREATE INDEX job_candidates_candidate_idx
    ON job_candidates (workspace_id, candidate_id);

-- +goose Down
DROP TABLE IF EXISTS job_candidates;
