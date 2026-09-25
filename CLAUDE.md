# Blue Harvest assessment — working guidelines

Build a small, clear mortgage pricing exception service that is easy to run and explain. Prioritize a correct workflow, simple UI, realistic seed data and verified behaviour.

Read [the assessment plan](mortgage-pricing-assessment-plan.md) for the agreed implementation order and [the original plan](mortgage-pricing-implementation-plan.md) for detailed contracts. Preserve both documents. Plans describe intended work, not proof that features or tests already exist.

## Keep the architecture simple

Apply a lightweight version of Uncle Bob's Clean Code and Clean Architecture: readable names, focused functions, testable business rules and clear boundaries. **Do not overengineer this assessment.**

- Keep only `frontend/` and `backend/` as application directories; supporting documentation belongs in `backend/docs/`.
- Frontend: React, TypeScript and Vite. Backend: NestJS, TypeScript and Prisma. Use compatible stable versions and commit the lockfile.
- SQLite is the local default. Optional Postgres has its own configuration and migrations.
- Use these backend boundaries without adding extra architectural layers:

| Location | Responsibility |
|---|---|
| `backend/src/domain/` | Plain TypeScript business rules and errors; no NestJS or Prisma imports |
| `backend/src/application/` | Use cases, ownership checks and transaction orchestration |
| `backend/src/infrastructure/` | Prisma persistence and transaction implementations |
| `backend/src/presentation/` | REST controllers, DTO validation, identity, guards and error mapping |

- Controllers delegate to use cases. Inject infrastructure through narrow ports where needed; do not expose Prisma types to domain or application code.
- Do not create an interface for every class or a class for every rule. Plain functions are enough for simple domain behaviour.
- No microservices, CQRS, event sourcing, generic CRUD frameworks, base repositories or abstractions for hypothetical future features.
- Search existing code before adding helpers or dependencies. Use native platform features and existing dependencies first.

## Assessment rules that must hold

- One request per application. Managers create for assigned applications and revise their own requests; reviewers decide; the mortgage system reads approved discounts. Prevent self-approval.
- Submitted discount and reason are immutable. An actual change creates a new pending version; reject no-op revisions.
- Each version has at most one decision. Only the current version can be decided, and approval applies to its exact submitted discount.
- Revising immediately makes previous approvals unusable. Preserve all versions and decisions; never fall back to an older approval.
- Store rates as integer basis points. Validate discount bounds and trimmed reasons; require a comment when declining.
- Resolve actors on the server and generate UTC timestamps there. Enforce permissions in the backend, regardless of UI visibility.
- Persist creation idempotency with the request in one transaction. Same key and payload replay the original response; changed payload conflicts.
- Use database constraints and the shared request revision counter to prevent duplicate or stale writes. Keep multi-write operations atomic; bound transient retries.
- Mortgage finalisation and approval consumption are outside scope. A discount lookup is a snapshot.

## API and UI

- Follow the planned REST routes, HTTP statuses and consistent error shape. Document DTOs, headers, permissions and examples in Swagger.
- Keep the UI to a user picker, request list, create/revise form, review controls and version history.
- Use feature folders, local React state, a typed `fetch` client and native form controls. Avoid a state framework or component library without a concrete need.
- Use semantic color tokens, accessible labels and visible loading/error states. Extract repeated UI; keep components under about 300 lines.
- Reuse creation keys on network retries. On conflicts, reload and require a fresh user action; never automatically approve refreshed content.
- Use strict TypeScript, meaningful names and early returns. Do not add `any`, compiler-suppression casts, silent catches or debug leftovers.

## Local setup, tests and handover

- Local operation must need no paid service, cloud account or AI key. Provide migrations, repeatable synthetic seeds and exact README commands.
- Include pending, approved, revised and declined fixtures; keep APP-100 empty for the walkthrough. Reseeding must preserve user edits and history.
- Demo `X-User-Id` authentication is local-only. Label it clearly and reject production startup with it enabled.
- Write tests alongside business rules and mutations: unit tests, real database/API tests for permissions, retries and races, and one complete browser workflow. Bug fixes need regression tests.
- Run lint, type checking, builds and relevant tests. Record actual outcomes; identify skipped checks and unverified database profiles honestly.
- Use AI for implementation and test review, never approval decisions. Verify accepted findings with executable tests and retain the evidence.
- Keep README concise, including remaining production work: real authentication, operational safeguards and atomic approval consumption. Do not claim production readiness from a successful build.
- Follow the supplied team standards and applicable Clean Code, Karpathy, KPI and Ponytail ultra guidance. Keep changes focused; simplicity must not remove validation, permissions, transaction safety or required tests.
