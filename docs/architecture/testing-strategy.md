# Testing Strategy

## Test pyramid

- Go unit tests cover configuration, middleware, domain scoring and job
  idempotency. Handler tests use `httptest`; repository/migration tests use a
  disposable PostgreSQL instance.
- Python unit tests cover Pydantic schemas, parsing fixtures, normalization,
  feature generation, deterministic scoring, evidence rejection, and fairness
  regressions. Provider integrations are mocked.
- Frontend component tests cover forms, tables, uploads, detail evidence and
  accessibility. Playwright covers the required recruiter journey.
- Contract tests validate OpenAPI and the Go-to-AI internal payload schemas.
- Docker smoke tests require every service health check to become ready.

## Required E2E journey

```text
Login -> Create Job -> Parse JD -> Edit requirements -> Upload CVs
-> Wait for processing -> Run ranking -> Open result -> View PDF evidence
-> Shortlist -> Submit feedback
```

The journey uses synthetic data only. It asserts audit events and workspace
isolation in addition to visible UI state.

## Quality gates

- Format/lint, type checks, unit tests, migration up/down validation
- No external AI calls in tests
- Deterministic baseline scoring fixtures
- Hallucinated/misaligned evidence must be rejected
- Every new tenant repository has a negative cross-workspace test
- OpenAPI breaking changes require an explicit versioning decision
- Ranking changes require offline Recall@K/nDCG regression results
- Accessibility checks cover focus, labels, contrast, and non-color status cues

## Phase 1 test scope

- Go API and worker configuration/health tests
- Python health and request schema tests
- Frontend type/lint/build checks
- Migration up/down smoke test in CI
- Compose configuration validation and service health smoke path

