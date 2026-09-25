# Architecture

A small Clean Architecture split, with one NestJS app and one React app. There are no extra layers, generic repositories or events.

```
 frontend (React + Vite)                     backend (NestJS)
 ┌──────────────────────────┐   HTTP    ┌───────────────────────────────────────────────┐
 │ features/requests/*      │ ────────► │ presentation/  controllers, DTO validation,   │
 │ api/client.ts (fetch)    │  JSON +   │                ActorGuard, ErrorFilter        │
 │ components/*             │  X-User-Id│        │                                      │
 └──────────────────────────┘           │        ▼                                      │
                                        │ application/   PricingRequestService          │
                                        │                (ownership, idempotency,       │
                                        │                 transaction orchestration)    │
                                        │        │  uses PricingStore port ◄──────┐      │
                                        │        ▼                                │      │
                                        │ domain/        plain TS rules + errors  │      │
                                        │                                         │      │
                                        │ infrastructure/ PrismaPricingStore ─────┘      │
                                        │                 config, Prisma client          │
                                        └──────────────────────┬────────────────────────┘
                                                               ▼
                                                SQLite (default) │ Postgres (optional)
```

Dependencies point inward:

- `domain` imports nothing from NestJS or Prisma.
- `application` depends only on `domain` and its own `PricingStore` port. That port is an abstract class, so it is also the Nest injection token without any decorators.
- `infrastructure` implements the port with Prisma.
- `app.module.ts` wires everything together with factories.

| Layer | Files | Responsibility |
|---|---|---|
| domain | `pricing-request.ts`, `domain-error.ts` | Types, discount/reason validation, `planRevision`, `planDecision`, `currentApproval`, derived status |
| application | `pricing-request.service.ts`, `pricing-store.ts` | Use cases, visibility/ownership, idempotent creation, calling the conditional write |
| infrastructure | `prisma-pricing-store.ts`, `prisma-client.ts`, `config.ts` | Persistence, transaction + bounded retry, adapter selection, env config |
| presentation | `requests.controller.ts`, `app.controller.ts`, `auth.ts`, `dto.ts`, `error.filter.ts`, `configure-app.ts` | Routes, validation, demo identity, `{ code, message, correlationId }` errors, Swagger |

## Request state

Status is derived from the current version. It is never stored.

```
            create (v1)                     approve / decline (current version only)
  ───────────────────────► PENDING ─────────────────────────────► APPROVED | DECLINED
                              ▲                                          │
                              │   revise (any state) → new PENDING v(n+1)│
                              └──────────────────────────────────────────┘
```

- A revision appends an immutable version and moves `currentVersionNumber`. Earlier decisions stay attached to their own versions, so they remain in history but can no longer be used.
- `approved-discount` succeeds only when the **current** version's decision is `APPROVED`. Otherwise it returns `409 NO_CURRENT_APPROVAL`.

## Concurrency and atomicity

Revisions and decisions contend for the same row. In one transaction each use case:

1. loads the request and applies the domain rules (stale token, current version, already decided, self-approval, no-op);
2. runs `UPDATE PricingRequest SET currentVersionNumber = ?, rowRevision = rowRevision + 1 WHERE id = ? AND currentVersionNumber = ? AND rowRevision = ?` and requires exactly one changed row;
3. inserts the new version or decision.

A stale or losing writer gets `409 STALE_REVISION`, and the transaction rolls back completely. Unique constraints (`(requestId, versionNumber)`, `Decision.versionId`, `PricingRequest.applicationId`, `(actorId, scope, key)`) back this up in the database.

Creation writes the request, version 1 and the idempotency record in one transaction. If two creations race, the database unique constraint rejects the loser. The service then re-reads the idempotency record: it returns the original response if the key and payload match, and `409 REQUEST_EXISTS` otherwise.

Transient database conflicts (Prisma `P2034`: write conflict, deadlock or serialization failure) are retried up to **3 attempts** in total. After that the API returns `503 TEMPORARILY_UNAVAILABLE`. No other error is retried.

## SQLite and Postgres differences

| Topic | SQLite (default) | Postgres (optional) |
|---|---|---|
| Schema / migrations | `prisma/sqlite/` | `prisma/postgres/`; models kept identical (checked by `prisma/schema-parity.spec.ts`) |
| Driver adapter | `@prisma/adapter-better-sqlite3` | `@prisma/adapter-pg` |
| Concurrency | The adapter serialises transactions with an in-process mutex; only one writer at a time. | Real concurrent transactions (READ COMMITTED). A losing `UPDATE … WHERE rowRevision = ?` waits for the row lock, re-checks and changes 0 rows. |
| Race tests | Prove serial-consistent outcomes | A barrier (`test/helpers.ts`) forces both transactions to read before either writes |
| Enums | Emulated by Prisma | Native enum types |

The generated client is provider-specific and is written to `src/generated/prisma` (gitignored). `npm run db:generate` (SQLite) or `npm run db:generate:postgres` selects it. `test:e2e:postgres` switches to Postgres and switches back afterwards.

**Trade-off:** two providers mean two migration histories and double the database testing. A future simplification is to use Postgres everywhere, locally via Docker, with a single migration history.

## Operational notes

- **Migrations:** hosted environments only run `prisma migrate deploy` with the Postgres config. Never run `db:reset` or the demo seed automatically against a hosted database. `db:reset` refuses non-`file:` URLs because the SQLite config rejects them. Review each generated SQL migration before committing it.
- **Supabase:** runtime `DATABASE_URL` may use the pooler. Set `DIRECT_URL` to the direct or session-pooler connection for migrations, which need session semantics. See the [Supabase Prisma guide](https://supabase.com/docs/guides/database/prisma). Keep all credentials server-side. The browser talks only to NestJS; disable or restrict Supabase's Data API for these tables.
- **Backups:** SQLite: copy `backend/dev.db` while the API is stopped. Postgres/Supabase: use `pg_dump` or the provider's point-in-time recovery, and test a restore before relying on it.
- **Secrets:** `.env` files are gitignored; `.env.example` holds placeholders only.
- **Idempotency retention:** records are kept forever in this demo. Production should expire them, for example after 24–72 hours, and keep stored bodies to identifiers only.
- **Correlation IDs:** each response carries `X-Correlation-Id`. A valid incoming value is echoed back; otherwise one is generated. Error bodies include it, and unexpected errors are logged server-side.
