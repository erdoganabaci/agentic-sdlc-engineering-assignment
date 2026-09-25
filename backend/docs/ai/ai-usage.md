# AI usage

## What the coding assistant did

Claude Code (model Claude Opus 5.5) implemented the assessment from `CLAUDE.md`, `mortgage-pricing-assessment-plan.md` and `mortgage-pricing-implementation-plan.md`. The candidate provided the plans, guidelines and team standards. The assistant:

- **Generated:**
  - all application code in `backend/` and `frontend/`
  - both Prisma schemas and migrations, and the seed
  - all tests
  - Docker Compose
  - this documentation, including the README walkthrough and the UI screenshot
- **Chose, with the reason recorded:**
  - Vitest instead of the Jest the plan mentions, because the current NestJS 12 CLI template generates Vitest
  - oxlint instead of ESLint, because both current official templates use it
  - one generated Prisma client path that is regenerated per profile
  - the `PricingStore` abstract class as both the port and the Nest injection token
- **Ran:** every command and test recorded in `validation.md`, the fresh-clone walkthrough, the AI test review and the mutation experiment.
- **Fixed defects it found:**
  - the ES2024 typecheck error
  - the idempotent-create race bug (found by AI finding F4)
  - a flaky test-server port binding
  - table readability in the UI

## AI test review

`review-prompt.md` was run by a separate Claude Code subagent with read-only instructions. `review-findings.md` holds its output verbatim; `verification.md` records the decisions and test results. It is the same model family as the coding agent, so it is **not** an independent review.

One suggestion was changed rather than adopted: F3 proposed stubbing `$transaction`. We injected a real `P2034` error inside a real transaction instead, so Prisma's actual rollback path is exercised. The API-level part of F6 was rejected as unreachable through the API. The tie-order case in F10 and the CI job in F4 were deferred. One claim in F7, about non-deterministic detection, was corrected with measured results.

## What still needs the human engineer

- Read the diff, `decisions.md` and `verification.md`, and confirm or overturn the accepted, rejected and deferred decisions.
- Re-run `npm run verify` (and `npm run test:api:postgres` if Docker is available) on their own machine.
- Fill in the time-spent field in the README.
- Open the PR against `develop` with a human reviewer. The demo authentication change needs human approval under the team rules.

## Controls

- **AI is outside the product.** No AI is in the approval path or any runtime dependency. Local use, tests and CI-style checks need no AI service or key.
- **Synthetic data only.** Prompts and fixtures contain no credentials or customer data; `.env` files are gitignored.
- **No gate bypasses.** Agents did not approve requests, deploy, publish or push anything. No remote exists.
- **No committed defects.** The deliberate defect lived only in a deleted scratch worktree. `git log -p` on `feat/pricing-exceptions` contains no mutation.

## Known limitations and residual risks

- **Hallucination and non-determinism.** Each AI finding was checked against the code before acting. A different run of the same prompt may produce different findings.
- **Missed races.** The review found untested paths, but it cannot prove there are no others. The SQLite suite cannot create truly overlapping transactions; only the Postgres run does.
- **Tests copying the implementation.** The same model wrote both code and tests. The mutation experiment and the bug the review uncovered show the tests can fail for real defects. Even so, a human review of the test intent is still needed.
- **Database differences.** SQLite and Postgres differ in concurrency, locking and enums. Supabase itself was not tested.
- **Evidence, not proof.** The AI findings are review input, not proof of correctness.
