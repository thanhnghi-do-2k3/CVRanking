# ADR 0005: Durable Job Lifecycle

Status: Accepted

## Decision

PostgreSQL stores the authoritative background job state and idempotency key;
Redis/Asynq delivers execution.

## Consequences

A dispatcher can recover publication after Redis failure. Handlers remain
idempotent and payloads use object/database references rather than CV text.

