# Security and Privacy Assumptions

## Trust boundaries

- The browser is untrusted; all authorization is enforced by the API.
- Workspace membership is resolved from the authenticated subject, not a
  client-supplied role.
- Internal service calls use a dedicated credential in production.
- PostgreSQL, Redis, MinIO, and MLflow are private network services.
- TLS terminates at the production ingress and is required end to end for any
  external provider.

## Controls

- Short-lived JWT access tokens and rotating, hashed refresh tokens.
- Password hashing with Argon2id and rate-limited authentication endpoints.
- Repository calls require `workspace_id`; cross-workspace object IDs return
  not found.
- MIME sniffing, file size/count limits, checksum deduplication, and a
  replaceable virus-scanner interface.
- Opaque object keys and short-lived signed download URLs.
- CV view/download, status changes, ranking runs, requirement edits, consent
  changes, and administrator actions create audit records.
- Structured logs redact email, phone, raw CV/JD text, token values, and signed
  URLs.
- Secrets come from environment or a production secret manager.
- Retention and candidate deletion are explicit workflows; immutable audit
  events retain the minimum legally required metadata.
- External AI is disabled by default and requires workspace consent.

## Ranking privacy

`blind_candidate_profile` excludes name, contact details, gender, date of birth,
photo, marital status, race, religion, and exact address. Retrieval, feature
generation, scoring, and evaluation accept this type rather than the full
candidate record.

Fairness counterfactual tests operate in a controlled audit path and compare
score/rank displacement. No single metric is presented as proof of fairness.

## Authentication implementation

- Passwords use Argon2id with 64 MiB memory, three iterations, and a random salt.
- Access JWTs use HS256, expire after 15 minutes, and carry user, workspace,
  current role, and refresh-family identifiers. The API rechecks the active
  membership and family in PostgreSQL on every protected request.
- A random 256-bit refresh value is stored only as a SHA-256 hash. Rotation is
  transactional; reuse after the five-second concurrency grace period revokes
  the complete token family.
- Refresh cookies are `HttpOnly`, `SameSite=Lax`, scoped to `/api/v1/auth`, and
  must be `Secure` in production. Access tokens live only in browser memory.
- Verification and invitation values are random 256-bit tokens stored only as
  hashes. They expire after 24 hours and seven days respectively.
- Login, registration, resend, and invitation endpoints use Redis rate limits
  and emit `Retry-After` when rejecting requests.
- All membership mutations, auth lifecycle events, refresh reuse, and workspace
  switches are audited. Email addresses appear in the business database and
  email delivery only, not application log attributes.

## Local and production assumptions

Local Docker Compose uses development credentials in `.env.example` only.
Production deployment, TLS ingress, secret manager integration, and formal
retention periods are outside Phase 2, but interfaces and configuration must
not prevent them.
