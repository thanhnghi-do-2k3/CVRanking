# ADR 0001: Modular Monolith for the Core API

Status: Accepted

## Decision

Implement the Go backend as one modular monolith with separate API and worker
processes. Each business module owns its application interfaces and data access.

## Consequences

Transactions, local development, and schema evolution remain simple. Module
boundaries and queue contracts provide an extraction path if measured scale or
ownership later requires services. Cross-module direct database writes are not
allowed.

