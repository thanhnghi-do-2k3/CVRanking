# Background Job Design

## Queues

| Queue | Job types | Default timeout | Retry policy |
|---|---|---:|---|
| `documents` | `resume.parse`, `resume.extract`, `resume.normalize`, `resume.embed`, `job.parse`, `job.embed` | 5–15 min | exponential, max 5 |
| `ranking` | `ranking.retrieve`, `ranking.feature_generate`, `ranking.score`, `ranking.rerank` | 5–30 min | exponential, max 3 |
| `evaluation` | `evaluation.run`, `fairness.audit` | 60 min | exponential, max 2 |

## Lifecycle

```text
pending -> queued -> running -> succeeded
                         \-> retrying -> queued
                         \-> failed -> dead_letter
```

Each database row stores job type, versioned payload, stage, progress,
attempt/max attempts, timeout, idempotency key, correlation ID, timestamps,
sanitized error code/message, and result reference.

## Idempotency

- Producers calculate a semantic key, for example:
  `resume.parse:{resume_id}:{checksum}:{parser_version}`.
- The database has a unique `(workspace_id, idempotency_key)` constraint.
- A handler checks both the business output and job state before work begins.
- Stages write output and terminal state transactionally where possible.
- Reprocessing uses a new parser/model version, which creates a new key.
- Retries never create a second candidate or ranking run.

## Delivery and failure handling

- API commits the `background_jobs` row before queue publication.
- A dispatcher republishes pending rows, providing recovery from a Redis outage.
- Workers use leases/heartbeats; abandoned `running` work is reclaimed.
- Retryable provider/network errors use exponential backoff with jitter.
- Validation, unsupported file, or evidence-integrity errors are non-retryable.
- Exhausted jobs enter `dead_letter`; the UI shows a safe error and permits an
  authorized retry with an audit event.
- Payloads contain object references, never raw CV text.
- Cancellation is cooperative between stages and does not remove prior audit
  or parse-run records.

## Progress and status delivery

MVP uses polling through `/resumes/{id}/status` and
`/ranking-runs/{id}`. Responses include current stage, percent, timestamps, and
an error code. The schema is compatible with a later SSE endpoint.

