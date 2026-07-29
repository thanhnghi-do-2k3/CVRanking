# ADR 0004: Immutable, Human-reviewed Ranking

Status: Accepted

## Decision

Every ranking run stores immutable job requirement/weight and
model/prompt/feature snapshots. Ranking uses blind candidate profiles and is
decision support only.

## Consequences

Edits require a new run, increasing storage but preserving reproducibility.
Constraint failures and low scores cannot automatically reject a candidate.
Every important explanation needs evidence and confidence.

