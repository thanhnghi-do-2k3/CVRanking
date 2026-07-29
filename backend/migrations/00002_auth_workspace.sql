-- +goose Up
ALTER TABLE users
    ADD COLUMN email_verified_at timestamptz;

ALTER TABLE workspace_members
    ADD COLUMN status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended')),
    ADD COLUMN last_accessed_at timestamptz;

CREATE INDEX workspace_members_recent_idx
    ON workspace_members (user_id, last_accessed_at DESC NULLS LAST)
    WHERE deleted_at IS NULL AND status = 'active';

ALTER TABLE refresh_tokens
    ADD COLUMN remember_me boolean NOT NULL DEFAULT false;

CREATE INDEX refresh_tokens_family_idx
    ON refresh_tokens (family_id, created_at DESC);

CREATE TABLE email_verification_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    token_hash bytea NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_verification_tokens_expiry_valid CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX email_verification_tokens_hash_unique
    ON email_verification_tokens (token_hash);
CREATE INDEX email_verification_tokens_user_active_idx
    ON email_verification_tokens (user_id, expires_at DESC)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE workspace_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    email text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'recruiter', 'hiring_manager')),
    token_hash bytea NOT NULL,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'revoked')),
    invited_by uuid NOT NULL REFERENCES users(id),
    accepted_by uuid REFERENCES users(id),
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT workspace_invitations_email_not_blank CHECK (length(trim(email)) > 3),
    CONSTRAINT workspace_invitations_expiry_valid CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX workspace_invitations_hash_unique
    ON workspace_invitations (token_hash);
CREATE UNIQUE INDEX workspace_invitations_email_pending_unique
    ON workspace_invitations (workspace_id, lower(email))
    WHERE status = 'pending';
CREATE INDEX workspace_invitations_workspace_idx
    ON workspace_invitations (workspace_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS workspace_invitations;
DROP TABLE IF EXISTS email_verification_tokens;
DROP INDEX IF EXISTS refresh_tokens_family_idx;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS remember_me;
DROP INDEX IF EXISTS workspace_members_recent_idx;
ALTER TABLE workspace_members
    DROP COLUMN IF EXISTS last_accessed_at,
    DROP COLUMN IF EXISTS status;
ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at;
