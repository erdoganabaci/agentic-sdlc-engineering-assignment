# Verification of AI findings

A decision on each finding in `review-findings.md`. **The coding agent made these decisions. The candidate must review and confirm them before submission;** no human review is claimed here. Every "accepted" item is backed by an executable test. Results are from the final gate at `c8e6370`: backend unit tests 39/39, API suite 37/37 on SQLite and 37/37 on Postgres, frontend 11/11.

| ID | Decision | Reasoning | Test location | Result |
|---|---|---|---|---|
| F1 | **Accepted** | Confirmed: revise-path validation was untested, and there is no DB CHECK constraint. | `src/domain/pricing-request.spec.ts` "validates revised content…"; `test/workflow.e2e-spec.ts` "rejects no-op revisions and invalid discounts" (revise returns 400; pointer, revision and version count unchanged) | Pass |
| F2 | **Accepted** | Confirmed: every idempotency test used one actor. Leaking another manager's response would be a data-exposure bug. | `test/idempotency.e2e-spec.ts` "scopes keys to the actor…" | Pass |
| F3 | **Accepted**, with a different method | Confirmed: retry and 503 were untested. We spied on `advanceRequest` to throw a real `PrismaClientKnownRequestError('P2034')` inside a real transaction, rather than stubbing `$transaction`. This goes through Prisma's actual rollback and rethrow. | `test/persistence.e2e-spec.ts` "transient database conflicts": commits once after 2 conflicts (3 calls, one version); 503 after exactly 3 attempts; business errors run once | Pass |
| F4 | **Accepted, partly deferred** | Confirmed: on SQLite the lost-race branches are unreachable without forcing them. We added deterministic tests that force them on any provider: a lookup that misses as if a concurrent commit happened, and `advanceRequest` resolving `false`. **These found a real bug.** A concurrent retry that missed the key lookup but then saw the committed request at the application check returned `REQUEST_EXISTS` instead of replaying (`expected 409 to be 201`). Fixed in `bcd43ba`. The Postgres run is now recorded in `validation.md`. **Deferred:** a CI job for `test:api:postgres`, because this repository has no CI or remote yet. | `test/idempotency.e2e-spec.ts` "when a concurrent creation commits between the key lookup and the application check" (3 tests); `test/concurrency.e2e-spec.ts` "maps a lost conditional update to STALE_REVISION without writing" | Failed before the fix (2 tests); pass after |
| F5 | **Accepted** | Confirmed: `/applications` scoping was untested. | `test/permissions.e2e-spec.ts` "scopes applications to the assigned manager" | Pass |
| F6 | **Accepted, API part rejected** | Confirmed that each half of the `\|\|` could be deleted undetected, so we added two unit cases. We rejected an API-level `SELF_APPROVAL → 403` test: with current roles it cannot be reached through the API, because the role guard stops managers first. `DOMAIN_STATUS` is typed `Record<DomainErrorCode, number>`, so a missing mapping fails typecheck. | `src/domain/pricing-request.spec.ts` "prevents a request creator from deciding…" and "prevents a version author from deciding…" | Pass |
| F7 | **Accepted**; one claim corrected | Confirmed with a mutation experiment (below). The two-reviewer race test could not detect a removed `rowRevision` guard. We added assertions on the losing `code` and the final `rowRevision`, plus a status check on the rolled-back decision. **Correction:** the reviewer expected the original decision/revision race test to catch the mutation only non-deterministically. In our runs it caught it 3 of 3 times; the strengthened version caught it 1 of 3 times. Commit order varies, so that test is not a reliable detector either way. | `test/concurrency.e2e-spec.ts` (all race tests); `test/persistence.e2e-spec.ts` rollback test | Pass |
| F8 | **Accepted** | Confirmed: only a discount change was tested. | `test/idempotency.e2e-spec.ts` "rejects the same key with a changed payload" (discount, reason, application) | Pass |
| F9 | **Accepted** | Confirmed: key reuse was tested only with a hand-made `ApiError`. The new test goes through the real `fetch` client and panel. | `frontend/src/features/requests/create-request-panel.test.tsx` | Pass |
| F10 | **Accepted, tie case deferred** | Confirmed: order was not asserted. We now assert the exact sequence across pages. **Deferred:** a tied-`updatedAt` fixture. The seed data has no ties, and adding synthetic tie data adds little for a demo list of 5 rows. | `test/workflow.e2e-spec.ts` "lists requests with a status filter and pagination" | Pass |

No finding was rejected outright. None proposed changing business rules.

## Mutation experiment: removing the optimistic-concurrency guard

This shows that F7 turned into a regression test that catches a real defect. It ran in an **isolated git worktree** in the session scratchpad, on the temporary branch `experiment/remove-revision-guard`. The worktree and branch were deleted afterwards and the defect was never committed.

**Mutation**, in `src/infrastructure/prisma-pricing-store.ts` `advanceRequest`:

```diff
       where: {
         id: guard.requestId,
         currentVersionNumber: guard.expectedVersion,
-        rowRevision: guard.expectedRevision,
       },
```

The tests ran against Docker Postgres (`pricing_test`), where the barrier forces overlapping transactions. The original race tests came from commit `617d86d` (before the AI review); the strengthened ones from `36b3b30`. Actual outcomes:

| Run | Guard | Test file | Result (3 runs each) |
|---|---|---|---|
| 1 | removed | original race tests | "two reviewers" **passed 3/3 (defect missed)**; decision-vs-revision failed 3/3 |
| 2 | removed | strengthened race tests | "two reviewers" **failed 3/3**: `expected 'CONFLICT' to be 'STALE_REVISION'`. Decision-vs-revision failed 1/3 (`expected [ 200, 201 ] to deeply equal [ 200, 409 ]`) |
| 3 | restored | strengthened race tests | **4/4 passed**, 3/3 runs |

**Conclusion.** Without the `rowRevision` condition, the unique index on `Decision.versionId` still blocks a duplicate decision. It does so with a generic `409 CONFLICT`, not through the intended optimistic check, and the original test could not tell the difference. The strengthened test pins the intended mechanism. Race outcomes that depend on commit order stay non-deterministic, which is why the deterministic "forced interleaving" tests from F4 were also added.
