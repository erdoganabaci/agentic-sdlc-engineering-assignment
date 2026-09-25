# Business decisions and assumptions

These are exercise assumptions, not asserted banking policy.

1. **One bank, no tenants.** All users act in a single demo bank.
2. **Roles.** Managers create requests only for mortgage applications assigned to them and revise only requests they created. Reviewers can view and decide every request. A dedicated `SYSTEM` identity (Mortgage Processor) only reads approved discounts.
3. **No self-approval.** A reviewer cannot decide a version they authored or a request they created. This is enforced in the domain rule, not only by role, so it still holds if one user ever has both permissions.
4. **One request per application.** Later attempts are new versions of that request. Enforced by a unique database constraint on `PricingRequest.applicationId`, not only a pre-check.
5. **Immutable versions.** Submitted discount and reason are never overwritten. Any change to either creates a new version, and a reason-only change also needs review. An unchanged revision (after trimming the reason) is rejected with `400 NO_CHANGE`.
6. **Decisions.** Only the current version can be decided. Each version has at most one decision (`APPROVED` or `DECLINED`), enforced by a unique constraint on `Decision.versionId`. A current version without a decision is `PENDING`.
7. **Revising.** Revising a pending, approved or declined request creates a new `PENDING` version. Earlier versions and decisions stay in history. An older version without a decision is shown as *superseded*.
8. **No fallback.** Only an `APPROVED` current version provides a usable discount — never an older approval, including when the newest version is declined.
9. **Scope ends at pricing.** Applications stay in the pricing stage. Finalising a mortgage and reserving or consuming an approval are out of scope. `GET /requests/:id/approved-discount` is a snapshot at read time; production integration must consume the approval atomically, or re-validate it, when applying it to a loan.
10. **Units and bounds.** Rates are integer basis points (400 bps = 4.00%). Rule: `0 < discountBps < standardRateBps`, so the resulting rate stays positive. Reasons are 1–1,000 characters after trimming.
11. **Exact approval.** A reviewer approves or declines exactly the submitted discount; they cannot approve a different amount. Declining requires a comment (max 1,000 characters); an approval comment is optional.
12. **Server-owned facts.** The backend resolves the actor from identity and generates UTC timestamps. Request bodies cannot set actors, roles, statuses or times (unknown fields are rejected).

## Deliberate scope choices

- **Idempotency.** Creation requires an `Idempotency-Key` header. The key is scoped to actor and operation. Replaying the same key and payload returns the original status and body, even after later changes to the request. The same key with a different payload returns `409 IDEMPOTENCY_KEY_REUSED`. Records are kept for the lifetime of the demo; production needs a retention period, and stored response bodies should hold identifiers only.
- **Revision and decision retries** are not idempotent. They are protected by `expectedVersion`/`expectedRevision` and unique constraints, so a retry after an uncertain result may return `409`. The client then reloads and the user acts again.
- **Visibility.** A manager asking for another manager's request, or an unassigned application, gets `404`, so the resource's existence is not revealed. A role that can never perform an action gets `403`.
- **Status is derived** from the current version's decision; no stored status field can disagree with history.
- **Current-version pointer.** `PricingRequest.currentVersionNumber` is not a composite foreign key. Prisma cannot declare the deferrable constraint a circular reference would need. It is kept consistent by writing the pointer and the version in one transaction; integration tests check the result.
