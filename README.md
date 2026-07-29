# TalentRank

TalentRank is an evidence-first, human-in-the-loop system for matching
candidate resumes to job requirements. This repository currently delivers the
Phase 0 architecture, Phase 1 runnable foundation, and Phase 2 authentication
and workspace lifecycle, plus a working MVP flow for JD creation, bulk CV
upload, deterministic ranking, and evidence-backed explanations.

> AI-generated ranking is decision support only. Review candidate evidence
> before making hiring decisions. TalentRank never performs unattended
> candidate rejection.

## What is included

- Architecture pack, ADRs, Mermaid ERD/flows, OpenAPI 3.1 contract and delivery plan
- Go API and Asynq worker with structured logs, request/correlation IDs,
  graceful shutdown and OpenTelemetry traces
- Python FastAPI AI boundary with strict Pydantic extraction/ranking schemas
- Next.js B2B application shell with responsive layout, dark mode and live
  service readiness state
- Argon2id credentials, mandatory email verification, short-lived access JWTs,
  rotating HttpOnly refresh sessions, Redis rate limits, and database-backed RBAC
- Workspace invitations, switching, role/suspension/removal lifecycle, audit
  events, Mailpit locally, and a TLS-capable SMTP production adapter
- MVP CV ranking: create a job from a JD, parse PDF/DOCX resumes, upload up to
  50 CVs per batch, run a deterministic evidence-based scorer, and
  shortlist/reject candidates with human review
- PostgreSQL 17 + pgvector schema, Redis, MinIO, MLflow and OpenTelemetry
  Collector
- Reversible Goose migration, unit tests and CI quality gates

Start with the [architecture pack](docs/architecture/README.md) and
[OpenAPI contract](docs/api/openapi.yaml).

## Prerequisites

- Docker Desktop with Compose v2
- About 6 GB of available memory for the complete local service graph
- Optional for host-side development: Go 1.24, Python 3.12, Node.js 22

## Run locally

```bash
cp .env.example .env
docker compose up --build
```

First startup downloads container images and language dependencies. Wait until
the services are healthy, then open:

| Service | URL |
|---|---|
| TalentRank web | http://localhost:3000 |
| Go API health | http://localhost:8080/api/v1/healthz |
| Go API readiness | http://localhost:8080/api/v1/readyz |
| AI OpenAPI | http://localhost:8000/docs |
| MinIO console | http://localhost:9001 |
| MLflow | http://localhost:5001 |
| Mailpit | http://localhost:8025 |

Development-only MinIO credentials are read from `.env`; the defaults are
documented in `.env.example`. Do not reuse them outside local development.
Verification and invitation emails are captured by Mailpit. Their links place
tokens in the URL fragment so the token is posted to the API in JSON and is not
sent in an HTTP request URL.

Stop the stack without deleting local volumes:

```bash
docker compose down
```

## Develop and test on the host

```bash
make bootstrap
make test
make compose-config
```

Individual suites:

```bash
make test-go
make test-ai
make test-web
```

The browser E2E suite expects the Compose stack:

```bash
cd frontend
npm run test:e2e
```

To try the CV ranking MVP manually, open `http://localhost:3000`, register,
verify the email in Mailpit at `http://localhost:8025`, then go to **CV
ranking**. Create a job from a JD, upload several PDF or DOCX CVs, and click
**Chạy ranking** to see scores, strengths, gaps, unknowns, and evidence snippets.

The Go services require PostgreSQL, Redis, MinIO, and the AI service only for
runtime readiness. Their unit tests do not require external services.

## Database migration

The `migrate` Compose service applies migrations before the API and worker can
start. To roll back one migration:

```bash
make migrate-down
```

The initial schema includes the complete MVP table inventory so later phases
can add behavior without destructive data-model shortcuts. Ranking tables are
append-only by design; job and requirement changes create new versions/runs.

## Repository layout

```text
backend/      Go API, worker, platform modules and Goose migrations
ai-service/   FastAPI boundary, strict schemas and future pipeline modules
frontend/     Next.js App Router application
docs/         Architecture, ADRs and OpenAPI
infra/        Local telemetry configuration
```

## Authentication lifecycle

- Self-registration creates a workspace and its first administrator, then
  returns `202 verification_pending`.
- Email verification issues the first 15-minute access token and a 7-day
  refresh cookie. “Remember me” extends refresh expiry to 30 days.
- A user with multiple active memberships signs in to the most recently used
  workspace and can switch from the sidebar.
- Only administrators can invite, resend/revoke invitations, change roles,
  suspend/reactivate, or remove members. The last active administrator is
  protected.
- Password reset is intentionally deferred; the login page marks it as a
  future capability.

Production must supply a random `JWT_SIGNING_KEY` of at least 32 bytes, set
`REFRESH_COOKIE_SECURE=true`, and configure SMTP with TLS and secrets from a
secret manager.

## Current milestone boundaries

The ranking MVP is intentionally deterministic and local-first. It ranks based
on parsed title, years of experience, skills, and text evidence; it does not use
candidate name or email as scoring input. OCR, LLM reranking, async workers,
password reset, global super-admin, and full search/evaluation workflows remain
future milestones. The ordered MVP plan is in
[delivery-plan.md](docs/architecture/delivery-plan.md).

## Security notes

- No API keys or production credentials are committed.
- CI rejects known production dependency vulnerabilities with
  `npm audit --omit=dev`.
- External AI consent is off by default in the data model.
- Raw CV/JD content must not be written to application logs.
- Ranking inputs will use `blind_profile`, never candidate identity fields.
- Object access will use opaque keys and short-lived signed URLs.

See [security.md](docs/architecture/security.md) for assumptions and controls.
