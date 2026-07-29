# ADR 0003: PostgreSQL Hybrid Retrieval for MVP

Status: Accepted

## Decision

Use PostgreSQL full-text search plus pgvector cosine similarity and Reciprocal
Rank Fusion for MVP retrieval.

## Consequences

The operational footprint is small and filters remain transactional. Recall and
latency are measured; OpenSearch is introduced only if data shows PostgreSQL
cannot meet the target.

