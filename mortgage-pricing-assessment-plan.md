# Blue Harvest mortgage pricing exceptions

## Summary and defaults

Build a small, runnable assessment following [the existing implementation document](mortgage-pricing-implementation-plan.md) and the requested 12-step order. This document supplements the existing plan; it does not replace it.

**Success:** a reviewer can install, seed, create a request, approve it, retrieve its discount, revise it, confirm the previous approval is unavailable, approve the revision, and inspect the complete history.

Confirmed scope: local demo authentication, production builds, optional Postgres, and an explicit production release checklist. Public deployment and real authentication remain future work.

Use npm workspaces with only `frontend/` and `backend/` as application directories. Keep supporting documentation inside `backend/docs/`.

Version baseline checked during planning on 2026-09-25:

| Dependency | Planned version |
|---|---|
| Node.js | 24.21.0 |
| React | 19.3.0 |
| Vite | 8.3.1 |
| NestJS | 12.1.0 |
| TypeScript | 6.0.3, compatible with Nest Swagger |
| Prisma CLI, client and adapters | 7.10.0 stable |
| Nest Swagger | 12.0.2 |

Commit the lockfile and pin Node. Avoid Prisma's currently prerelease `latest` tag and unsupported TypeScript peer combinations.

## Business decisions

- One request per mortgage application; subsequent changes create immutable versions.
- Managers create requests for assigned applications and revise their own requests.
- Reviewers approve or decline exactly the current submitted version. Self-approval is prohibited.
- Every version receives at most one decision, recording the reviewer and server-generated UTC timestamp.
- Changing either discount or reason creates a new pending version. Reject unchanged submissions.
- A revision immediately makes any previous approval unusable. Historical decisions remain visible.
- Only an approved **current** version supplies a usable discount; never fall back to an older approval.
- Discounts and standard rates use integer basis points. Require `0 < discountBps < standardRateBps`.
- Request reasons contain 1–1,000 characters after trimming. Decision comments have the same maximum; declining requires a non-empty comment.
- Applications remain in the pricing stage. Applying or consuming an approval during mortgage finalisation is outside this assessment.

## Implementation order

### 1. Setup

- Scaffold React/TypeScript/Vite and NestJS/TypeScript in the existing folders.
- Add root workspace scripts, `.env.example`, `.gitignore`, Node pin, linting, formatting and strict type checking.
- Provide the intended quick start: `npm ci`, `npm run setup:local`, `npm run dev`.
- `setup:local` prepares missing local configuration, generates Prisma, applies migrations and seeds without resetting existing data.
- Run frontend on port 5173 and backend on 3000; keep configuration environment-driven.
- Initialize Git during implementation. Use conventional commits and the supplied `develop` workflow; no automatic remote publication.

### 2. Architecture

- Frontend: request feature folder, typed HTTP client, and small reusable components.
- Backend: domain, application, infrastructure and HTTP presentation layers.
- Domain contains plain TypeScript rules and errors. Application code coordinates permissions and transactions. Prisma remains in infrastructure.
- Use narrow persistence/transaction ports only where required to preserve these boundaries.
- Keep controllers thin and files focused. Avoid generic repositories, CQRS, event sourcing, shared-package scaffolding and speculative abstractions.

### 3. Database

- SQLite is the default and requires no Docker or external account.
- Provide a separate optional Postgres profile with Docker Compose, Prisma configuration and committed migrations.
- Use matching Prisma driver adapters and regenerate the client when selecting a provider.
- Share repository behaviour and seed logic; verify model consistency across both schemas.
- Never use `db push` as a replacement for migration history.
- Document Supabase connection and migration setup using its [official Prisma guidance](https://supabase.com/docs/guides/database/prisma). No cloud resources are provisioned.

### 4. Tables

Implement the six models already specified in the source document:

| Model | Responsibility |
|---|---|
| User | Identity and role |
| MortgageApplication | Assigned manager and standard rate |
| PricingRequest | Application association, current version and concurrency counter |
| RequestVersion | Immutable discount, reason, author and timestamp |
| Decision | One outcome per version, reviewer, comment and timestamp |
| IdempotencyRecord | Actor-scoped key, payload hash and original response |

Enforce unique application/request association, version numbering, decision-per-version and idempotency keys with database constraints.

Derive status from the current version's decision. Preserve foreign-key relationships and history; provide no deletion endpoints.

### 5. Permissions

- Enable seeded `X-User-Id` identity only in explicit local demo mode.
- Resolve roles on the server; never trust browser-supplied roles or actor fields.
- Managers see their own requests; reviewers see all demo-bank requests.
- The system identity can retrieve approved discounts.
- Missing or unknown identity returns 401; forbidden actions return 403. Inaccessible request lookups return 404.
- Reject production startup with demo authentication. Display a persistent demo label in the UI.

### 6. REST API and Swagger

Implement these routes:

| Method and route | Behaviour |
|---|---|
| `GET /health` | Liveness |
| `GET /demo/users` | Local demo picker |
| `GET /applications` | Applications visible to the actor |
| `POST /requests` | Create; requires `Idempotency-Key` |
| `GET /requests` | Scoped list with status filter and pagination |
| `GET /requests/:id` | Current details and full history |
| `POST /requests/:id/versions` | Revise using expected version and revision |
| `POST /requests/:id/versions/:version/decision` | Decide using expected revision |
| `GET /requests/:id/approved-discount` | System-only current approval lookup |

- Creation and revision return 201; decisions return 200, preserving the source document's contract.
- Validate DTOs at the HTTP boundary and reject unexpected fields.
- Return consistent `{ code, message, correlationId }` errors with appropriate HTTP statuses.
- Return 409 `NO_CURRENT_APPROVAL` when an existing request lacks a usable approval.
- Approval responses include application, request, version and decision identifiers, discount, reviewer and decision timestamp.
- Publish Swagger at `/docs` and OpenAPI JSON at `/docs-json`, including DTOs, headers, examples, permissions and errors using [Nest's Swagger integration](https://docs.nestjs.com/openapi/introduction).
- Use page-based pagination, default 20 and maximum 100, with deterministic ordering.

### 7. Reliability

- Persist creation, version one and its completed idempotency record in one transaction.
- Same actor/key/payload returns the original status and body, even after later revisions.
- Same key with changed content returns 409. A different key cannot bypass the one-request-per-application constraint.
- Both revisions and decisions conditionally update the same request row using current version and `rowRevision`.
- A stale update rolls back entirely and returns 409.
- Enforce one decision per version at database level.
- Retry only recognized transient database failures, with a maximum of three attempts. Return an explicit temporary-unavailability error if contention remains.
- Revision and decision retries may return 409; clients reload and require a fresh action.
- Approved-discount lookup reads one consistent snapshot. Document that mortgage finalisation requires later atomic consumption or revalidation.

### 8. Seed data

Use fixed synthetic identifiers and deterministic historical timestamps.

Users: Ali and Deniz as managers; Emma and Noah as reviewers; Mortgage Processor as the system identity.

| Application | Owner | Standard rate | Initial state |
|---|---|---:|---|
| APP-100 | Ali | 400 bps | No request; walkthrough fixture |
| APP-101 | Ali | 400 bps | Pending, 25 bps |
| APP-102 | Ali | 400 bps | Version 1 approved at 25 bps; version 2 pending at 40 bps |
| APP-103 | Ali | 400 bps | Current approval at 30 bps |
| APP-200 | Deniz | 400 bps | Declined, 35 bps |

APP-103 fills the missing usable-approval example in the original document.

Seeding inserts missing fixtures without overwriting subsequent user changes. A separately named local-only reset command restores the complete demo dataset.

### 9. Simple UI

- Build one request workspace: user picker, request list, create form and selected-request detail/history.
- Use native form controls, local React state, `fetch`, and semantic CSS tokens.
- Show standard rate, requested discount and resulting rate clearly.
- Reuse the create/revise form where behaviour overlaps.
- Show role-appropriate revision and review controls, with a required decline comment.
- Preserve earlier decisions while labelling older versions as superseded.
- Reuse the same creation key and payload after uncertain network failures.
- On conflict, show the error and refresh authoritative data; never resubmit an approval automatically.
- Clear actor-specific state when switching users and ignore stale responses.
- Include accessible labels, keyboard navigation and visible loading, empty, success and error states.

### 10. Tests

Write tests alongside each behaviour; this step consolidates and runs the full suite.

- **Backend unit tests:** basis-point rules, reason validation, no-op revisions, ownership, self-approval and current-version approval rules.
- **Real database/API tests:** complete workflow, idempotency replay, changed-payload conflict, permissions, history, rollback and persistence across restart.
- **Concurrency tests:** simultaneous creation retries, competing reviewers, competing revisions, and decision/revision races using distinct transactions and controlled scheduling.
- Run the important database suite against SQLite and optional local Postgres.
- **Frontend tests:** form validation, retry-key behaviour, actor switching and conflict recovery.
- **One Playwright workflow:** create → approve → revise → unavailable approval → approve again → inspect history.
- Use Nest's Jest setup, frontend Vitest/Testing Library and Playwright. Test critical backend rules and mutation paths through observable behaviour.

### 11. AI demonstration

- Ask an agent to review the implemented rules, API and tests for missing edge cases.
- Record actual findings, source references, uncertainty and accepted/rejected decisions.
- Turn at least one accepted finding into a regression test.
- Demonstrate that test failing after an isolated temporary guard removal, then passing after restoration.
- Keep prompts, findings and verification evidence under `backend/docs/ai/`.
- Keep AI outside financial decisions and runtime dependencies; document human review and residual risks.

### 12. Documentation and handover

- Keep README concise: prerequisites, quick start, seed users, Swagger, test commands and the copyable API walkthrough.
- Include a clear **“Before production”** section separating completed behaviour from remaining work.
- Put detailed decisions, architecture diagram, operational guidance, validation evidence and AI records under `backend/docs/`.
- Record actual test commands, outcomes, assessed commit and any unverified Postgres checks.
- Include an honest time-spent field for the candidate to complete.

## Acceptance and production follow-up

Before submission:

- Run the README workflow from a fresh local database.
- Pass lint, type checking, builds and focused tests.
- Confirm reseeding preserves user history.
- Review Clean Architecture boundaries, component size, semantic colors and duplication.
- Capture a UI screenshot and verify no credentials, database files, build artifacts or deliberate test defects enter Git.

Document these remaining production tasks: verified user and service authentication, production Postgres validation, deployment configuration, restricted database access, approval consumption at mortgage finalisation, audit retention and tamper protection, rate limiting, monitoring, backup restoration and reviewed migration procedures.

Completion means a verified assessment with an explicit release checklist. It does not claim the demo authentication is suitable for a public production service.
