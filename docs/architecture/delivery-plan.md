# MVP Backlog and Implementation Order

## Milestones

### Phase 0 — Architecture

- [x] Architecture, data flow, ERD, contracts, security assumptions
- [x] ADRs, backlog, risk register, testing strategy, Definition of Done

### Phase 1 — Foundation

- [x] Monorepo and local environment
- [x] PostgreSQL/pgvector, Redis, MinIO, MLflow
- [x] Go API and worker health/readiness
- [x] Python AI service health/readiness and schema validation
- [x] Next.js application shell and API health presentation
- [x] Initial reversible migration
- [x] Structured logs, request/correlation IDs
- [x] CI and foundation tests

### Phase 2 — Authentication and workspace

- [x] Register/login/refresh/logout/me and mandatory email verification
- [x] Rotating refresh families, replay detection, RBAC, and workspace-scoped sessions
- [x] Invitation, role, suspension, removal, resend/revoke, and last-admin protection
- [x] Mailpit/SMTP adapter, authenticated frontend, and authorization tests

### Phase 3 — Job management

- [ ] Job CRUD, versioning, JD editor and parse lifecycle
- [ ] Requirement editor with priorities, weights, years and constraints

### Phase 4 — Resume ingestion

- [ ] Single/bulk upload up to 50 files
- [ ] Storage, checksum, scanner interface and async pipeline
- [ ] Validated profile/evidence extraction and progress UI

### Phase 5 — Search and retrieval

- [ ] Blind profile, PostgreSQL FTS, embeddings, pgvector and RRF

### Phase 6 — Ranking

- [ ] Versioned feature generation and deterministic baseline scorer
- [ ] Requirement assessments, snapshots and ranking results UI

### Phase 7 — Explanation

- [ ] Signed PDF viewer, evidence navigation, strengths/gaps/unknowns
- [ ] Up-to-four candidate comparison

### Phase 8 — Feedback and analytics

- [ ] Shortlist/reject/manual status, notes, reviews and feedback
- [ ] Dashboard and ranking metrics
- [ ] Synthetic seed dataset: 3 jobs and at least 20 varied candidates

### Phase 9 — LLM re-ranking

- [ ] Consent-aware provider, top-K re-rank, evidence validation and cost

### Phase 10 — Hardening

- [ ] E2E, audit/privacy workflows, rate limiting, observability
- [ ] Load tests and fairness regression suite

## Recommended implementation order

1. Establish contracts, configuration, health checks, migrations, and CI.
2. Build identity/workspace isolation before tenant business data.
3. Version jobs and requirements before parsing resumes.
4. Make ingestion durable and observable before retrieval.
5. Establish blind profiles and deterministic retrieval before scoring.
6. Persist immutable ranking snapshots before building explanations.
7. Add human decisions and feedback before learned ranking.
8. Add external/LLM providers only after evidence and consent enforcement.
9. Harden with production telemetry, load, security, and fairness regression.

Each phase begins with a file/goal checklist, ends with tests, and leaves the
repository runnable. A later phase may not mutate the semantics of historical
ranking results.
