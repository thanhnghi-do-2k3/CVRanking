# TalentRank Architecture Pack

Status: Accepted for Phase 1  
Scope: Phase 0 architecture and delivery plan

TalentRank is a decision-support system for recruiters and hiring managers. It
never performs unattended candidate rejection. A human must review the
candidate evidence before a hiring decision is recorded.

## Contents

1. [System architecture](system-architecture.md)
2. [Data model and ERD](data-model.md)
3. [REST API contract](../api/openapi.yaml)
4. [Background job design](background-jobs.md)
5. [Security and privacy assumptions](security.md)
6. [MVP backlog and implementation order](delivery-plan.md)
7. [Risk register](risk-register.md)
8. [Testing strategy](testing-strategy.md)
9. [Definition of Done](definition-of-done.md)
10. [Architecture Decision Records](../adr/)

## Phase 0 checklist

- [x] Overall architecture and service boundaries
- [x] Technology selection and rationale
- [x] Monorepo structure
- [x] Entity relationship diagram
- [x] System and data flow diagrams
- [x] Ranking pipeline
- [x] Database table inventory
- [x] Versioned REST API contract
- [x] Background job lifecycle and idempotency design
- [x] MVP backlog and implementation sequence
- [x] Security and privacy assumptions
- [x] AI provider abstractions
- [x] Risk register
- [x] Testing strategy
- [x] Definition of Done

## Architecture principles

- Start as a modular monolith with explicit module ownership.
- Keep document intelligence in a separately deployable Python service.
- Put workspace identity in every tenant-owned query and record.
- Run expensive or failure-prone work asynchronously.
- Store immutable input snapshots for every ranking run.
- Rank only on a blind candidate profile.
- Attach evidence and provenance to extracted and ranked claims.
- Treat `not_found`, `unknown`, and `not_met` as different states.
- Version parser, feature schema, model, prompt, and ranking output.
- Keep provider interfaces local-first and external-provider consent-aware.

