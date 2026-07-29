# Risk Register

| Risk | Likelihood | Impact | Mitigation / trigger |
|---|---|---|---|
| Parser quality varies by CV layout | High | High | Preserve text/page offsets, confidence, fixtures, fallback OCR only when needed |
| Model fabricates a claim or evidence | Medium | Critical | Closed schemas, quote/offset verification, reject unverifiable output, never store invalid output |
| Protected attributes leak into rank features | Medium | Critical | Blind profile type, feature allowlist, regression tests, provenance audit |
| Recruiters over-trust scores | High | High | Decision-support disclaimer, labels + explanation, human action required |
| Workspace data leakage | Low | Critical | Workspace-scoped repositories, auth tests, opaque object keys, audit logs |
| External provider receives data without consent | Medium | Critical | Provider policy gate, default off, minimized payload and audited configuration |
| Redis outage loses requested work | Medium | High | Durable background job row and recovery dispatcher |
| Ranking changes without traceability | Medium | High | Immutable runs, requirement/weight/model/prompt/feature snapshots |
| Duplicate upload creates duplicate candidates | High | Medium | Checksum + parser-version idempotency and user-visible duplicate state |
| pgvector/FTS recall degrades at scale | Medium | High | Offline Recall@K, filtered indexes, HNSW tuning, measured OpenSearch escape hatch |
| Dependency/model image is too large | Medium | Medium | Separate service images, optional model profiles and cached downloads |
| Local compose is resource-heavy | Medium | Medium | Health checks, conservative defaults, optional MLflow/observability profiles later |
| Feedback learns historical bias | High | High | Separate observed action from relevance label, audits and human review of datasets |
| Legal retention requirements conflict | Medium | High | Workspace policy abstraction, deletion/export workflows, jurisdiction review before production |

The owner for each product/security risk must be assigned before a production
pilot. A Critical risk blocks release when its mitigating test or control is not
operational.

