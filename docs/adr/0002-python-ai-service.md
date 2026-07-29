# ADR 0002: Separate Python AI Service

Status: Accepted

## Decision

Document parsing and ML inference live in a schema-validated FastAPI service;
workflow ownership and durable state remain in the Go backend.

## Consequences

Python dependencies and accelerator scaling do not burden the core API.
Internal contracts and correlation IDs must be tested. The AI service cannot
make candidate status decisions or write tenant business tables.

