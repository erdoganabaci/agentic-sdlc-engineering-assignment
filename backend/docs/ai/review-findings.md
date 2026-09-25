# AI review findings (raw)

> **These are AI suggestions, not verified facts.** See `verification.md` for the engineer's decision on each one and the test results.

| | |
|---|---|
| Date | 2026-09-25 |
| Tool | Claude Code subagent (general-purpose), launched from the coding session |
| Model | Claude Opus 5.5 (`claude-opus-5-5`); the subagent inherits the session model |
| Independence | A separate agent context, but the same model family as the coding agent. It is **not** an independent human or vendor review. |
| Access | Read-only instructions (no edits, no database suites). It ran the backend unit suite once. |
| Input | `review-prompt.md`, applied to the working tree at commit `c4252ac` plus the then-uncommitted `decisions.md`. A presentation-only UI commit (`257ed78`) landed during the review. |
| Run time | About 4 minutes, 21 tool calls |

The report below is reproduced exactly as returned; only this header was added.

---

## F1: Revisions can go out of bounds without any test failing (discount and reason checks are never exercised on the revise path)
- **Evidence:** Rule: `mortgage-pricing-assessment-plan.md:36-37` (`0 < discountBps < standardRateBps`, reason 1–1,000 characters after trimming) and `backend/docs/decisions.md:9,14`. Code: `backend/src/domain/pricing-request.ts:108-109` (`planRevision` calls `assertValidDiscount` and `normalizeReason`). There is no DB CHECK constraint on `discountBps` (the migrations only add unique indexes, e.g. `prisma/sqlite/migrations/20260925105237_init/migration.sql:68-77`). I searched the tests. Every `planRevision` unit test uses a valid discount (40 or 25; `backend/src/domain/pricing-request.spec.ts:81-113`). Every API revise uses 30/35/40/45/60 (`workflow.e2e-spec.ts:36-41,99-116`, `concurrency.e2e-spec.ts:30-31,42`, `persistence.e2e-spec.ts:37-42,81`). Invalid discounts are tested only on create (`workflow.e2e-spec.ts:135-138`).
- **Failing scenario:** Line 108 is deleted, or `normalizeReason` is swapped for a plain `.trim()`. Ali then POSTs `/requests/REQ-101/versions` with `{expectedVersion:1, expectedRevision:0, discountBps:400, reason:"x"}` (or `reason:"   "`) and gets 201. Version 2 is stored at 400 bps (resulting rate 0%). A reviewer can approve it, and `GET /approved-discount` then returns 400 bps. Every existing test still passes.
- **Expected behaviour:** A unit test shows `planRevision` throws `VALIDATION_FAILED` for 0, standardRate, above standardRate, non-integer, whitespace-only and 1,001-character reasons. An API test shows revise returns 400 and leaves `currentVersionNumber`/`rowRevision` and the version count unchanged.
- **Confidence:** High. I searched every backend spec and e2e-spec for revise bodies.

## F2: Idempotency keys are never tested for actor scoping
- **Evidence:** Rule: `decisions.md:20` ("The key is scoped to actor and operation"). Code: `pricing-request.service.ts:119` (key = `{actorId, scope, key}`), `prisma-pricing-store.ts:144` (lookup by `actorId_scope_key`). The payload hash has no actor in it (`pricing-request.service.ts:44-47`). All idempotency tests use only `ali` (`idempotency.e2e-spec.ts:16-76`). Grepping for `deniz` finds only permission calls with random keys (`permissions.e2e-spec.ts:45-52`, `helpers.ts:56`).
- **Failing scenario:** `actorId` is dropped from the lookup or the unique index (for example, a refactor to a `(scope, key)` index). Ali creates APP-100 with key `key-shared`. Deniz then POSTs the same body with `Idempotency-Key: key-shared`. The hash matches, so Deniz gets a 201 replay containing Ali's `requestId` instead of 404. That exposes another manager's request. With a different payload, Deniz gets `409 IDEMPOTENCY_KEY_REUSED` for a key he never used.
- **Expected behaviour:** Same key and same payload from a second actor gives that actor's own normal outcome (404 for Deniz on APP-100), never the first actor's stored body. The record count per `(actorId, key)` stays correct.
- **Confidence:** High that this is untested. I did not confirm how Prisma behaves in each specific regression variant.

## F3: Transient-conflict retry and the 503 `TEMPORARILY_UNAVAILABLE` path are untested
- **Evidence:** Rule: `mortgage-pricing-assessment-plan.md:126` and `backend/docs/architecture.md` "Transient database conflicts…retried up to 3 attempts…503" (the paragraph after line 65). Code: `prisma-pricing-store.ts:15,71,87-99` and `error.filter.ts:20`. Grepping all backend and frontend tests for `P2034`, `TEMPORARILY_UNAVAILABLE` and `503` finds nothing.
- **Failing scenario:** `MAX_TRANSACTION_ATTEMPTS` becomes 1 or unbounded. Or `isTransientConflict` starts matching every error, so a `DomainError('STALE_REVISION')` or `P2002` gets retried. Or the exhausted case falls through as a raw error, giving 500 `INTERNAL_ERROR`. No test fails.
- **Expected behaviour:** Stub `$transaction`/`work` to throw a `PrismaClientKnownRequestError` with code `P2034`. It succeeds on attempt 2 or 3, and exactly 3 attempts produce `503 {code:'TEMPORARILY_UNAVAILABLE'}`. Non-P2034 errors (DomainError, P2002 → `UniqueViolationError`) run exactly once. A retried revise or decide never commits twice.
- **Confidence:** High.

## F4: DB-level race guards only run in the optional Postgres suite; the default SQLite suite would pass with them removed
- **Evidence:** `test/helpers.ts:79-85,98-99` (`overlapAdvances`/`overlapCreates` return early unless `isPostgres`) and `architecture.md` table row "Race tests: SQLite — prove serial-consistent outcomes". On SQLite the second transaction always re-reads committed state, so it is rejected by the domain pre-checks (`pricing-request.ts:98,137`; `pricing-request.service.ts:136,141`). It never reaches:
  - `advance` returning false (`pricing-request.service.ts:217-220`)
  - the `UniqueViolationError` fallback in `createRequest` (`pricing-request.service.ts:152-158`)

  The plan requires "Run the important database suite against SQLite and optional local Postgres" (`mortgage-pricing-assessment-plan.md:167-168`). `backend/docs/` contains no recorded Postgres run (`docs/ai` has only `review-prompt.md`).
- **Failing scenario:** Someone deletes the catch block at service:152-158, or makes `advanceRequest` return `true` regardless of `count` (`prisma-pricing-store.ts:191`). `npm run test:e2e` (SQLite) stays green. On Postgres, two simultaneous creates with different keys would surface a raw `409 CONFLICT` or 500 instead of `REQUEST_EXISTS`/replay. Two overlapping revisions would both "succeed" at the service level. Also untested even on Postgres: a concurrent same-key/different-payload race through the catch path, which should give `IDEMPOTENCY_KEY_REUSED`.
- **Expected behaviour:** Either a CI job runs `test:e2e:postgres`, or service-level tests use a fake store in which `advanceRequest` returns false or `createRequest` throws `UniqueViolationError`. These should assert `STALE_REVISION`, a replay for a matching key, `REQUEST_EXISTS` for a different key, and `IDEMPOTENCY_KEY_REUSED` for the same key with a changed payload.
- **Confidence:** High for the SQLite blind spot. Whether Postgres was ever run is unknown to me; I found no evidence either way beyond the docs listed.

## F5: `GET /applications` manager scoping has no test
- **Evidence:** Rule: `mortgage-pricing-assessment-plan.md:89,102` and `decisions.md:22`. Code: `pricing-request.service.ts:90-92`, `prisma-pricing-store.ts:117-119` (`where: { managerId }`; an `undefined` `managerId` means no filter), `app.controller.ts:31-49`. The test titled "hides other managers requests and applications" (`permissions.e2e-spec.ts:42-54`) only checks create→404 and `/requests`. The test API helper has no `/applications` call (`helpers.ts:53-67`), and grep finds no `/applications` request in backend tests.
- **Failing scenario:** The role ternary at service:91 is inverted or dropped, so it always passes `undefined`. Deniz then receives APP-100…APP-103 with Ali's customer labels, and no test fails.
- **Expected behaviour:** `GET /applications` as deniz returns only `['APP-200']`. As ali it returns APP-100…103 with the correct `requestId` (null for APP-100). As emma it returns all. As `mortgage-processor` it returns 403.
- **Confidence:** High.

## F6: Each half of the self-approval rule can be deleted without failing a test
- **Evidence:** Rule: `decisions.md:7` ("cannot decide a version they authored **or** a request they created… still holds if one user ever has both permissions"). Code: `pricing-request.ts:139`. The only test (`pricing-request.spec.ts:137-142`) uses a fixture where the creator and the version author are the same user (`manager`; spec lines 22-43). There is no API test: grep finds `SELF_APPROVAL` only in that unit spec, and managers are stopped earlier by the role guard (`permissions.e2e-spec.ts:32`).
- **Failing scenario:** One side of the `||` is removed, e.g. `input.reviewerId === request.creator.id`. A request created by user A with a latest version authored by user B can then be approved by A, and the unit test still passes because the reviewer in it matches both.
- **Expected behaviour:** Two unit cases: reviewer = creator but not the author, and reviewer = author but not the creator. Both must throw `SELF_APPROVAL`, and `error.filter` must map it to 403.
- **Confidence:** High that it is untested. Real-world reachability is low with today's roles and the creator-only revision rule, but the documented rule explicitly covers dual-role users.

## F7: Race tests check only HTTP status, so a weakened optimistic guard can still pass
- **Evidence:** `concurrency.e2e-spec.ts:16-24,26-36,38-44` assert `[200,409]`/`[201,409]` and counts, never `body.code` or the final `rowRevision`. The rule that a stale write gets `STALE_REVISION` is at `mortgage-pricing-assessment-plan.md:123-124` and in the architecture concurrency section ("A stale or losing writer gets 409 STALE_REVISION"). The guard is `prisma-pricing-store.ts:183-191`. A second 409 path with a different code is `error.filter.ts:58-63` (`UniqueViolationError` → `409 CONFLICT`).
- **Failing scenario:** Postgres, with `rowRevision` removed from the `updateMany` `where`. In the two-reviewer race both advances match `currentVersionNumber=1`, and the loser is rejected only by `Decision_versionId_key` with `409 CONFLICT`. The test still sees `[200,409]` and one decision, so it passes. The decision-vs-revision race fails only when the decision commits first, so detection is non-deterministic. Separately, `persistence.e2e-spec.ts:51-56` never asserts the status of the rolled-back decision.
- **Expected behaviour:** The losing response has `code: 'STALE_REVISION'` (or `ALREADY_DECIDED` on SQLite). The request row ends with `rowRevision` equal to its start value + 1.
- **Confidence:** Medium. The analysis assumes READ COMMITTED re-evaluation as documented in `architecture.md`; I did not run the Postgres suite.

## F8: Changed-payload idempotency conflict is tested only for `discountBps`
- **Evidence:** Rule: `mortgage-pricing-assessment-plan.md:122` and `decisions.md:20`. Code: `pricing-request.service.ts:44-47` (the hash covers `applicationId`, `discountBps`, `reason`) and `124-129`. The test changes only the discount (`idempotency.e2e-spec.ts:39-44`). The replay test (`:21`) proves whitespace-only reason differences replay, but no test changes the reason text or the `applicationId`.
- **Failing scenario:** `reason` or `applicationId` is dropped from `hashPayload`. Ali then retries key K with a new reason ("Competing offer" → "Salary account"), or with APP-101 instead of APP-100. He gets a 201 replay of the original body, silently discarding the new content, instead of `409 IDEMPOTENCY_KEY_REUSED`.
- **Expected behaviour:** Same key with a changed reason, or with a changed `applicationId`, returns `409 IDEMPOTENCY_KEY_REUSED`, and no second request or record is written.
- **Confidence:** High.

## F9: Frontend retry-key reuse is tested only at the hook level with a synthetic status-0 error
- **Evidence:** Rule: `mortgage-pricing-assessment-plan.md:156,169`. Code: `frontend/src/api/client.ts:34-36` maps a `fetch` rejection to `ApiError(0, …)`. `use-idempotent-submit.ts:22` reuses the key only when `status === 0`. `create-request-panel.tsx:32-35` wires the hook. The tests build `new ApiError(0, …)` by hand (`use-idempotent-submit.test.ts:6`). `app.test.tsx` has no network-failure case, and nothing tests `send` or `CreateRequestPanel`.
- **Failing scenario:** `send` stops mapping network failures (it rethrows the `TypeError`, or uses status 500), or the panel builds a new payload object shape per attempt. After a timeout whose server-side create actually committed, the user's retry uses a new key and gets `409 REQUEST_EXISTS` instead of the replayed 201. All frontend tests still pass.
- **Expected behaviour:** A component or integration test stubs `fetch` to reject once and then succeed. It asserts that both POSTs to `/requests` carry the same `Idempotency-Key` and an identical body, and that a definitive 4xx leads to a fresh key.
- **Confidence:** Medium-high.

## F10: Non-deterministic pagination order would go unnoticed
- **Evidence:** Rule: `mortgage-pricing-assessment-plan.md:116` ("deterministic ordering"). Code: `pricing-request.service.ts:102` (sort by `updatedAt` descending, then `id`). The test (`workflow.e2e-spec.ts:148-160`) checks only `total`, `page`, `pageSize` and item counts per page, never the order or that pages don't overlap.
- **Failing scenario:** The sort, or the `id` tiebreaker, is removed. Pages 1 and 2 can then return overlapping or missing requests whenever DB row order changes or `updatedAt` values tie. The test still passes because the lengths are 3 and 1.
- **Expected behaviour:** Assert the exact ID sequence across pages for the seeded data (`REQ-200, REQ-103, REQ-102 | REQ-101` by `updatedAt` descending). Assert that the union of pages equals the full list with no duplicates. Add a case with tied `updatedAt` to exercise the `id` tiebreak.
- **Confidence:** Medium. It is outside the prompt's main focus areas but is part of the API contract. The expected order is derived from the seed timestamps in `prisma/seed.ts:51-110`.

*Checked and found covered, so not reported:* no fallback to an older approval (domain `pricing-request.spec.ts:167-177`; API `workflow.e2e-spec.ts:45-47,77-95`), stale approval after revision, revising a declined version, rollback atomicity, create-role 403s, and unknown identity 401. The backend unit suite passes (`npx vitest run`: 3 files, 32 tests). I did not run the database suites.
