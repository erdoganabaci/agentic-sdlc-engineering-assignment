# AI test-review prompt

Reproducible instructions for an AI agent reviewing this repository for **missing tests**. The agent's
output is review input only: it cannot approve pricing requests, change financial outcomes, deploy code,
or bypass human review and CI.

## Prompt

> You are reviewing a small NestJS + Prisma service for mortgage pricing exceptions. Read, in order:
>
> 1. `mortgage-pricing-assessment-plan.md` and `backend/docs/decisions.md` (business rules).
> 2. `backend/src/domain/pricing-request.ts`, `backend/src/application/pricing-request.service.ts`,
>    `backend/src/infrastructure/prisma-pricing-store.ts`, `backend/src/presentation/*.ts` (implementation and API contract).
> 3. `backend/src/**/*.spec.ts`, `backend/test/*.e2e-spec.ts`, `frontend/src/**/*.test.*`, `frontend/e2e/*.spec.ts` (existing tests).
>
> Find behaviours that the business rules or API contract require but that **no existing test would catch if
> the implementation broke**. Focus on versioning, idempotency, retries, concurrency, permissions and
> "no fallback to an older approval".
>
> For each finding report:
> - **Title** and a stable ID (F1, F2, …).
> - **Evidence:** exact file paths and line numbers for the rule and for the code path that is untested.
> - **Failing scenario:** concrete inputs/state and the wrong outcome a regression would produce.
> - **Expected behaviour:** what a test should assert.
> - **Confidence:** high / medium / low, and what you are unsure about.
>
> Rules: cite only code you have read; do not claim a test is missing without searching for it; do not
> invent test results; do not propose changing business rules; no secrets, credentials or customer data
> (all fixtures are synthetic). Report at most 10 findings, most important first.

## How it was run

See `review-findings.md` for the tool, model, date and raw findings, and `verification.md` for what the
engineer accepted, rejected or deferred.
