# Definition of Done

## Feature-level

A feature is done when:

- behavior and authorization rules match the versioned API contract;
- workspace isolation is enforced and negatively tested;
- error, loading, empty, and retry states are handled;
- logs contain request/correlation IDs but no raw PII;
- background work is idempotent, observable, retry-bounded, and recoverable;
- AI output is schema-validated and evidence is verifiable;
- protected attributes are absent from ranking inputs;
- tests pass at the appropriate unit, integration, component, and E2E layers;
- operational and user documentation is updated.

## MVP-level

The MVP is done when Docker Compose starts the full local system and the
required E2E journey succeeds with synthetic seed data. At least 50 CVs can be
accepted in one bulk upload, processing is asynchronous, ranking and evidence
are versioned, no automated rejection occurs, OpenAPI is published, and the
security/testing acceptance criteria in the master specification pass.

## Phase 1 exit criteria

- `docker compose up --build` has a valid, health-checked service graph.
- API, worker, AI service, and frontend build from pinned manifests.
- API and AI `/healthz` and `/readyz` endpoints are tested.
- PostgreSQL starts with pgvector and the initial migration applies.
- Redis, MinIO, and MLflow have local configuration without committed secrets.
- Request/correlation IDs cross API boundaries.
- CI validates Go, Python, frontend, migrations, and Compose configuration.
- README documents prerequisites, commands, URLs, credentials, and limitations.

## Phase 2 exit criteria

- Registration requires email verification before a session is issued.
- Passwords and all opaque tokens are stored only in hardened/hash form.
- Refresh tokens rotate transactionally, tolerate a five-second duplicate
  request without revoking the family, and revoke the family on later reuse.
- Every protected request resolves an active workspace membership from the
  access token scope and database; a client cannot select a workspace header.
- Admin-only invitation and member lifecycle endpoints enforce the last-active
  administrator invariant.
- The browser keeps access tokens in memory and recovers a session from the
  HttpOnly refresh cookie with at most one retry after a `401`.
- Mailpit supports the local verification/invitation journeys and production
  email is behind an SMTP adapter.
- Go race/vet, migration rollback/reapply, frontend lint/type/test/build,
  dependency audit, and the documented auth E2E journeys pass.
