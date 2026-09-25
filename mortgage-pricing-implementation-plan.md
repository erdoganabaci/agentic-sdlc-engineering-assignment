# Mortgage pricing exceptions — implementation instructions for a coding LLM

Build a small, working technical-assessment solution. Implement the steps below in order. Deliver runnable code, seed data, tests, and clear documentation. Keep the scope small. Do not merely return another plan.

## 1. Fixed choices and scope

- Two top-level application directories: `frontend/` and `backend/`. Root files such as README, package scripts, lockfile, and compose configuration are allowed. Put documentation in `backend/docs/`; do not add an `apps/` or shared-packages directory. A CI configuration directory is allowed if needed.
- Frontend: current stable React, TypeScript, Vite. Backend: current stable NestJS and TypeScript. Persistence: Prisma ORM.
- Check current official documentation for compatible Node.js, Prisma, driver adapters, and framework versions. Pin a supported Node.js version, commit the lockfile, and use reproducible installation commands. Do not assume older Prisma setup examples still apply.
- Default local database: SQLite, requiring no account or database server. Optional Postgres profile: local Docker Postgres for verification and Supabase Postgres for hosted data.
- Use lightweight Clean Architecture. No microservices, event broker, generic CRUD framework, or elaborate abstractions. Build the API and its tests before the optional UI polish.
- Local use, tests, and the core application must need no paid service, AI API key, or private infrastructure.
- Supabase is the hosted database in this design. The React frontend and NestJS API require their own compatible hosting. Browser requests must go through NestJS; do not bypass its approval rules through Supabase's Data API.
- Do not publish or provision cloud resources as part of implementation unless separately instructed. Provide deployment instructions and report what was actually verified.

Done when a reviewer can install, seed, start, create a request, approve it, revise it, see approval become unavailable, approve the new version, and inspect the full history.

## 2. Record business decisions first

Create `backend/docs/decisions.md` with these exercise assumptions:

1. Users act in one bank; no multi-tenant organisation system.
2. Managers may create requests only for mortgage applications assigned to them, and revise their own requests. Reviewers can view and review all requests in this demo bank. A dedicated system identity can retrieve approved discounts.
3. Prevent self-approval even if a future user has both manager and reviewer permissions.
4. One pricing request per mortgage application for this exercise. Later attempts use new versions of that request. Enforce this with a database constraint, not only a pre-check.
5. Submitted version content is immutable: discount and reason never get overwritten. Every actual change creates a new version. Changing the reason also requires review. Reject a no-op revision with a clear validation error.
6. Only the current version can receive a decision. Each version gets at most one final decision: APPROVED or DECLINED. A current version with no decision is PENDING.
7. Revising a pending, approved, or declined request creates a new PENDING version. All earlier content and decisions remain in history. An older pending version is shown as superseded, not as still awaiting review.
8. Only an APPROVED current version provides a usable discount. No fallback to an older approval, including when the newest version is declined.
9. The mortgage application is assumed to remain in its pricing stage. Actually finalising a mortgage, reserving or consuming an approval, and changing already-finalised loans are out of scope. Explain that a lookup is a snapshot at read time; production integration needs atomic consumption or revalidation when applying it.
10. Discount is an integer number of basis points. For this exercise require `0 < discountBps < standardRateBps` so the resulting rate stays positive. This is a chosen demo rule, not an asserted banking policy. Store both values as integers. Require a trimmed, non-empty reason with a documented length limit, such as 1,000 characters.
11. Reviewer approves or declines exactly the submitted discount; they cannot silently approve a different amount. A decline requires a short decision reason; an approval comment is optional.
12. Backend supplies actor identity and UTC timestamps; clients cannot choose them in request bodies.

Example: 400 bps standard rate = 4.00%; 25 bps discount = 0.25 percentage points; result = 3.75%.

## 3. Scaffold the repository and architecture

Frontend paths:

- `frontend/src/features/requests/`: list, create, detail/history, revise, review.
- `frontend/src/components/`: small reusable UI components.
- `frontend/src/api/`: typed HTTP client and request/response types.
- Keep state simple; use local component state unless a concrete need justifies another library.

Backend paths:

- `backend/src/domain/`: plain TypeScript request/version rules and domain errors. No imports from NestJS or Prisma.
- `backend/src/application/`: create, revise, decide, list, inspect, and approved-discount use cases; persistence and transaction interfaces.
- `backend/src/infrastructure/`: Prisma repositories, database transaction implementation, environment configuration.
- `backend/src/presentation/`: HTTP controllers, validation DTOs, authentication adapter, role guards, error mapping.
- NestJS wiring/composition connects interfaces to concrete implementations. Keep transactions under application control through a narrow interface; do not pass Prisma clients into the domain.
- `backend/prisma/`: provider configuration, schemas, migrations, seed logic.
- `backend/test/` and `backend/docs/`: integration tests and supporting documentation.

Controllers delegate to use cases. Guards enforce broad roles; use cases also enforce ownership and self-approval rules. Prisma handles persistence, not the business policy.

## 4. Configure SQLite and Postgres honestly

Prisma migrations are database-specific. Changing only a connection URL cannot turn SQLite migrations into Postgres migrations.

- Maintain explicit SQLite and Postgres Prisma configurations and separate migration histories, e.g. `backend/prisma/sqlite/` and `backend/prisma/postgres/`.
- Keep the domain model identical across providers. Share seed logic and repository behaviour where possible. Explicitly document any adapter-specific differences.
- Generate the correct Prisma client for the selected profile. Use the driver adapter required by the installed Prisma version. Ensure switching profiles regenerates the client; avoid stale generated imports.
- Provide scripts that select the schema/config, generate the client, apply that profile's committed migrations, and seed it. Check scripts against the actual installed version.
- Commit real migrations. Do not substitute `db push` for a migration history.
- Keep local `.env` and SQLite database files out of Git. Supply `.env.example` with safe placeholders.
- Provide optional Docker Compose Postgres inside `backend/` so the hosted provider can be tested locally without Supabase credentials.
- Run the same important repository/API tests against SQLite and local Postgres. If Postgres cannot be run in the available environment, clearly report it as unverified; do not claim Supabase readiness.
- Supabase setup must use the connection mode recommended in its current Prisma documentation. Migration connections must support required session semantics; do not blindly use transaction-pooling URLs for migrations. Keep all database credentials on the server.
- Use deployment migrations for hosted environments. Never run reset or demo seed automatically against a hosted production database.

Trade-off to document: two database providers increase maintenance and testing. A future simplification is Postgres locally and in deployment, sharing one migration history.

## 5. Implement the data model and constraints

| Model | Important fields and relationships |
|---|---|
| User | ID, name, role; referenced by application ownership, request creation, revisions and decisions |
| MortgageApplication | ID, synthetic customer label, assigned manager ID, standardRateBps |
| PricingRequest | ID, unique application ID, creator ID, currentVersionNumber, rowRevision, createdAt |
| RequestVersion | ID, request ID, versionNumber, discountBps, reason, createdBy, createdAt |
| Decision | ID, unique version ID, reviewer ID, outcome, optional/required comment according to outcome, decidedAt |
| IdempotencyRecord | Actor ID, operation scope, key, canonical payload hash, original HTTP status/body, createdAt |

- Unique `(requestId, versionNumber)`; unique `Decision.versionId`; unique `(actorId, operationScope, key)`; unique application ID on PricingRequest.
- Foreign keys preserve relationships. No delete endpoints; do not cascade away decision history.
- Use a composite relation/constraint for the current version where practical; otherwise enforce that the current version belongs to the same request inside transactions and validate it in integration tests.
- `rowRevision` is an optimistic-concurrency counter, distinct from the business version number. Increment it for every revision or decision.
- Derive current status from the current version's decision. Avoid independently stored status fields that can disagree.
- History can be assembled from immutable versions and decisions; a separate event store is unnecessary for this scope.

## 6. Add identity and permissions

For the local exercise, allow a seeded user picker backed by `X-User-Id`. Resolve the user and role on the server; do not accept a role supplied by the browser.

- Unknown or missing identity: 401. Known identity without permission: 403. Avoid exposing inaccessible resources through lists or detail endpoints.
- Enable header-based identity only with an explicit local demo mode. Clearly label the UI as a demo.
- Refuse normal production startup with this demo authentication mode. A public hosted API needs real authentication before release; writing a deployment guide does not make the demo header secure.
- Keep auth replaceable with verified OIDC/JWT identity later. The approval, ownership, and version rules must remain server-side regardless of the auth adapter.
- Tests must call the API directly to prove UI button visibility is not the security boundary.

## 7. Implement HTTP endpoints and API documentation

| Endpoint | Permission / behaviour |
|---|---|
| GET /health | Simple liveness response; no secret details |
| GET /demo/users | Local demo only; picker identities |
| GET /applications | Managers see assigned applications; reviewers see demo-bank applications |
| POST /requests | Manager; Idempotency-Key required; applicationId, discountBps, reason |
| GET /requests | Manager-owned or reviewer-visible list; simple status filter and pagination |
| GET /requests/:id | Request details, current version, rowRevision, all versions and decisions |
| POST /requests/:id/versions | Owning manager; expectedVersion, expectedRevision, discountBps, reason |
| POST /requests/:id/versions/:version/decision | Reviewer; expectedRevision, outcome, optional/required comment |
| GET /requests/:id/approved-discount | System identity; usable current approval only |

Create returns 201 with request/version identifiers. Revision returns 201. Decision returns 200. Use consistent errors with a stable code, human-readable message, and request correlation ID. Typical statuses: 400 invalid input; 401 unauthenticated; 403 forbidden; 404 unknown resource; 409 stale version/revision, already decided, application already has a request, or key reused with a different payload.

For an existing request without a current approval, the approved-discount endpoint returns 409 with code `NO_CURRENT_APPROVAL`; never represent it as an approved zero discount. Success includes applicationId, requestId, versionNumber, decisionId, discountBps, reviewerId, and decidedAt. Retrieve these consistently in one query/transaction.

Add Swagger/OpenAPI with examples, identity and idempotency headers, permissions, and error responses. Document it as part of the runnable backend.

## 8. Protect duplicate calls and concurrent actions

Creation idempotency:

1. Validate identity, input and key. Scope the key to the actor and operation.
2. Hash a canonical representation of validated payload fields.
3. Same key and same payload: return the stored original status and response, including the original request ID. Replays remain original responses even if the request has since changed.
4. Same key and different payload: return 409. A new key for an application that already has a request also returns 409, directing the caller to revision.
5. Save the request, first version and completed idempotency record in one transaction. If the transaction rolls back, none remain.
6. Use a database unique constraint and bounded retry/re-read to handle simultaneous identical calls. A read-then-insert check alone is insufficient.
7. Keep records for the lifetime of this demo. Document retention and response-data implications for production.

Revision and decision concurrency:

- Require expected version/revision information from the page or caller.
- Inside one transaction, conditionally update the request row using ID, currentVersionNumber and rowRevision; increment rowRevision. Require exactly one row changed.
- For revision, insert the next immutable version and advance the current version in that same transaction. For a decision, confirm the current version has no decision and insert its unique decision in that transaction.
- Revisions and decisions must contend on the same request row/counter. Any failure rolls back all related writes.
- Map stale writes to 409. Handle provider-specific transient lock/serialization errors with bounded retries, never an infinite loop or an unconditional overwrite.
- Creation requires full idempotency. Revision/decision retries are protected by version/revision checks and uniqueness; a retry may return 409, after which the client reloads the outcome. Document this deliberate scope choice.

## 9. Provide realistic, repeatable seed data

Use only synthetic data and fixed fixture identifiers:

| User | Role | Purpose |
|---|---|---|
| Ali | MANAGER | Owns APP-100, APP-101, APP-102 |
| Deniz | MANAGER | Owns APP-200; tests ownership restrictions |
| Emma | REVIEWER | Main reviewer |
| Noah | REVIEWER | Competing review/concurrency tests |
| Mortgage Processor | SYSTEM | Reads current approved discount |

- APP-100: 400 bps standard rate; no existing request, reserved for the README walkthrough.
- APP-101: pending 25 bps request.
- APP-102: version 1 approved for 25 bps; current version 2 pending for 40 bps, demonstrating historical approval that is no longer usable.
- APP-200: declined request owned by Deniz.
- Use deterministic timestamps for fixture history and avoid real names/customer records beyond these fictional examples.
- Seed is explicit and safe to repeat: upsert missing fixtures without erasing subsequent user edits/history. Provide a separately named local-only reset-and-seed command with a clear destructive warning.
- Validate relationships and calculated example rates after seeding.

## 10. Build the simple UI

1. Local demo user selector and persistent visible role indicator.
2. Request list: application, current discount, current version, status, updated time; clear empty/loading/error states.
3. Create form: assigned application selector, integer discount in bps, reason, standard rate and resulting rate preview.
4. Detail page: current data and timeline/table of every version and decision, including who acted and when. Label older versions as superseded while preserving their historical decision.
5. Manager revision form: show warning that a change requires fresh approval and makes any older approval unusable. Send the displayed expected version and rowRevision.
6. Reviewer controls: approve or decline only a current pending version, displaying its exact discount and reason. Require decline comment.
7. On 409 show a clear conflict message and reload; never automatically approve a newly loaded version without a fresh reviewer action.
8. Disable repeated submit clicks for usability, while retaining backend protections. Create one idempotency key per intended creation and reuse it on network retry. A changed payload after an uncertain result must not silently reuse that key.
9. Show usable approved discount and resulting rate from authoritative request data. Keep the SYSTEM-only integration endpoint separately exercisable via README commands.

Use accessible labels, keyboard-operable controls, readable tables and sensible mobile layout. Visual polish comes after business correctness.

## 11. Validate behaviour with focused tests

Domain unit tests:

- Basis-point validation, approval of an exact version, self-approval rule, new revision requiring review, no fallback to historical approvals.

API/database integration tests with a real temporary database, repeated for both profiles:

1. Create, approve, retrieve 25 bps for a 400 bps application; reviewer/time recorded.
2. Decline; discount retrieval returns NO_CURRENT_APPROVAL.
3. Revise approved 25 bps to 40 bps; history retains v1; current v2 is pending and unavailable until reviewed.
4. Review v2; return exactly 40 bps and v2's decision metadata.
5. Reject stale approval after a revision and stale revision after a competing write.
6. Two simultaneous reviewers: exactly one decision, other caller receives conflict.
7. Two simultaneous revisions: one new version wins; the other conflicts.
8. Decision/revision race: outcomes correspond to a valid serial order, with no approval accidentally attached to changed content.
9. Same idempotency key/payload sequentially and concurrently: one request and one original result. Changed payload conflicts. Retry after process restart still finds the persisted record.
10. New idempotency key for an existing application's request conflicts, rather than bypassing the one-request rule.
11. Missing identity, wrong role, wrong owner, self-approval and invalid/nonexistent application cannot mutate protected data.
12. Failure during a multi-write operation rolls back versions, decisions, request pointers and idempotency records appropriately.
13. History is ordered and complete; data persists across restart; foreign-key/unique constraints hold.

Use barriers or controlled scheduling for race tests rather than arbitrary sleeps. Test distinct concurrent database transactions, not merely mocked Promise calls.

Add one browser E2E scenario using seeded fixtures: manager creates, reviewer approves, manager revises, reviewer reviews again, history shows both versions. Include a visible conflict/error case if practical. Keep tests focused on observable behaviour.

Run type checking, lint, builds and the selected tests. Record actual commands and outcomes in `backend/docs/validation.md`; mark skipped checks explicitly and include the commit being assessed. Never invent test counts or passing results.

## 12. Demonstrate useful AI-agent work in the SDLC

Implement a small, real, documented AI-assisted test-review exercise; do not put an LLM in the approval path.

Problem: versioning, retries and concurrency have failure cases that are easy to overlook.

Create `backend/docs/ai/` containing:

- `review-prompt.md`: reproducible instructions asking an agent to review the actual API contract, business rules and relevant implementation for missing tests. Require specific file references, a failing scenario, expected behaviour, and uncertainty; prohibit secrets, financial decisions and unsupported claims.
- `review-findings.md`: actual findings from running the review, clearly identified as AI suggestions with date/tool/model when known. If a separate reviewer agent is unavailable, record that the coding agent performed the review; do not invent independent agents.
- `verification.md`: each finding marked accepted, rejected or deferred, with reasoning, test location and actual test result.
- `ai-usage.md`: what the coding assistant generated or changed, what the engineer reviewed, known limitations, and any AI-proposed changes that were rejected.

Demonstrate at least one meaningful suggestion becoming an executable regression test. For a concrete demonstration, temporarily remove a version/concurrency guard in an isolated local branch or worktree, run the targeted test and show it fails, then restore the correct code and show it passes. Ensure no deliberate defect enters the submitted branch. If this experiment cannot be run, label it as a proposed demonstration, not completed evidence.

Controls: synthetic data only, no credentials or customer information in prompts; agent reviews cannot approve requests, deploy code or bypass gates; human review plus real tests is required. Run suggested commands only after checking their purpose.

Residual risks to explain: hallucinated issues, missed races, tests that copy an incorrect implementation, non-deterministic output, and different database behaviour. AI findings are review input, not proof of correctness. Core application and CI tests must run without an AI subscription or API.

## 13. Write concise setup and handover documentation

Root README must include:

- Problem, stack, prerequisites and exact tested versions.
- SQLite quick start from a fresh clone: install, environment setup, migration/client generation, seed, start backend/frontend, open UI and API docs.
- Exact working commands and URLs; do not provide commands that were never added to package scripts.
- Seed users, roles and fixtures; demo authentication limitations.
- A copyable curl workflow with local demo identity and idempotency headers: create APP-100 at 25 bps, approve v1, read approved discount as SYSTEM, revise to 40 bps, show unavailable result, approve v2, read 40 bps, inspect history. Extract actual returned IDs/revisions instead of assuming generated values.
- Business assumptions: one request per application, version-specific decisions, no fallback to historical approval, no loan finalisation/consumption in scope.
- How to run tests, builds and optional local Postgres profile.
- Optional Supabase database setup, migration instructions, backend/frontend hosting requirements and the authentication work required before public deployment.
- Links to decisions, architecture, validation and AI evidence.
- Honest time spent: user-supplied human time plus recorded agent time if available. Never fabricate a duration; leave an explicit field for the candidate to complete if unknown.

Add `backend/docs/architecture.md` with a compact dependency diagram and approval/revision state explanation. Add operational notes covering migration safety, backups/restore, secrets, transaction retry behaviour, and SQLite/Postgres differences.

Production improvements: verified authentication, stronger authorisation scopes and service credentials, appropriate DB grants and disabled/restricted direct Data API access, production Postgres testing, audit retention/tamper protection, atomic approval consumption at mortgage finalisation, rate limits, structured monitoring, backup restoration checks, data retention and reviewed migrations. Explain these as future work, not implemented guarantees.

## 14. Final acceptance and submission

- Verify the README workflow on an empty local database using only documented steps.
- Confirm no cloud account or paid AI service is needed for local operation.
- Run focused test gates; stop expanding scope once key behaviour is demonstrated.
- Check that secrets, database files, generated build output and deliberate mutation-test defects are absent from Git.
- Commit source, migrations, seed data, lockfile, tests and documentation in coherent commits. Do not invent a remote URL or claim a repository was shared if it was not.
- Final implementation report: what works, exact run/test commands, actual validation results, remaining limitations, AI contributions, and time field for submission.

## Reference documentation

Consult current official instructions when implementing; dependency configuration may change:

- React with Vite and TypeScript: https://react.dev/learn/build-a-react-app-from-scratch
- NestJS providers and controller/service separation: https://docs.nestjs.com/providers
- Prisma database-provider migration limitations: https://www.prisma.io/docs/orm/v6/prisma-migrate/understanding-prisma-migrate/limitations-and-known-issues (versioned reference; also verify the installed Prisma release's guidance)
- Prisma error reference, including provider mismatch: https://www.prisma.io/docs/orm/reference/error-reference
- Supabase with Prisma: https://supabase.com/docs/guides/database/prisma

This document is an implementation plan. It does not claim that code, deployments, tests or AI-review experiments have already been completed.
