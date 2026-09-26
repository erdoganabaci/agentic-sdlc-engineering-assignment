# Mortgage pricing exceptions

A relationship manager asks for a discount on a mortgage application's standard rate. A pricing reviewer approves or declines that exact request. The mortgage system reads only a **currently approved** discount.

Changing a request creates a new version that needs fresh approval. An earlier approval is never used as a fallback, and the full history stays visible.

**Stack:** React 19 + Vite 8 + TypeScript 6 · NestJS 12 · Prisma 7 (SQLite by default, optional Postgres) · Vitest · Playwright.

![Reviewer workspace](backend/docs/images/reviewer-workspace.png)

## Prerequisites

- **Node.js 24.21.0** (pinned in `.nvmrc`; run `nvm use`) and npm 11
- Optional: Docker, for the local Postgres profile

Tested with Node 24.21.0, npm 11.19.0, Prisma 7.10.0, NestJS 12.1.0, React 19.3.0, Vite 8.3.1 and TypeScript 6.0.3 on macOS. Local use needs no cloud account, paid service or AI key.

## Quick start (SQLite)

```bash
npm ci
npm run setup:local   # creates backend/.env if missing, generates the Prisma client, migrates, seeds (non-destructive)
npm run dev           # API on :3000, UI on :5173
```

- UI: <http://localhost:5173>. Pick a demo user in **Acting as**.
- API docs (Swagger): <http://localhost:3000/docs>; OpenAPI JSON: <http://localhost:3000/docs-json>
- Port 3000 already in use? Run `PORT=3001 npm run dev -w backend` and `VITE_API_URL=http://localhost:3001 npm run dev -w frontend`.

`npm run db:reset` **deletes all local SQLite data** and restores the demo fixtures. It is local-only: the SQLite config rejects any non-`file:` database URL.

## Demo users and fixtures

Identity is a local demo only. The UI sends `X-User-Id` and the server resolves the user and role. It is enabled only with `DEMO_AUTH=true`, and the API refuses to start with it when `NODE_ENV=production`.

| User id | Name | Role | Notes |
|---|---|---|---|
| `ali` | Ali | MANAGER | Owns APP-100 to APP-103 |
| `deniz` | Deniz | MANAGER | Owns APP-200; shows ownership limits |
| `emma` | Emma | REVIEWER | Main reviewer |
| `noah` | Noah | REVIEWER | Second reviewer |
| `mortgage-processor` | Mortgage Processor | SYSTEM | API only: reads approved discounts |

| Application | Standard rate | Seeded state |
|---|---:|---|
| APP-100 | 400 bps | No request (for the walkthrough) |
| APP-101 | 400 bps | `REQ-101` pending, 25 bps |
| APP-102 | 400 bps | `REQ-102` v1 approved at 25 bps, v2 pending at 40 bps: the old approval is **not** usable |
| APP-103 | 400 bps | `REQ-103` approved at 30 bps: usable |
| APP-200 | 400 bps | `REQ-200` declined at 35 bps (Deniz) |

Seeding only inserts missing fixtures. Re-running it keeps your changes and history.

## API walkthrough (curl)

Run this against a freshly seeded database. It reads IDs and revisions from the responses; nothing is hard-coded.

```bash
API=http://localhost:3000
json() { node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8'))$1"; }

# 1. Ali creates the request for APP-100 at 25 bps (400 bps standard → 3.75%)
REQUEST_ID=$(curl -s -X POST "$API/requests" -H 'X-User-Id: ali' -H 'Idempotency-Key: walkthrough-app-100' \
  -H 'Content-Type: application/json' \
  -d '{"applicationId":"APP-100","discountBps":25,"reason":"Competing offer from another lender."}' | json .requestId)
echo "$REQUEST_ID"

# 2. Emma approves version 1, sending the revision she saw
REVISION=$(curl -s "$API/requests/$REQUEST_ID" -H 'X-User-Id: emma' | json .rowRevision)
curl -s -X POST "$API/requests/$REQUEST_ID/versions/1/decision" -H 'X-User-Id: emma' \
  -H 'Content-Type: application/json' -d "{\"expectedRevision\":$REVISION,\"outcome\":\"APPROVED\"}"; echo

# 3. The mortgage system reads the approved discount: 25 bps
curl -s "$API/requests/$REQUEST_ID/approved-discount" -H 'X-User-Id: mortgage-processor'; echo

# 4. Ali revises to 40 bps
DETAIL=$(curl -s "$API/requests/$REQUEST_ID" -H 'X-User-Id: ali')
VERSION=$(echo "$DETAIL" | json .currentVersionNumber); REVISION=$(echo "$DETAIL" | json .rowRevision)
curl -s -X POST "$API/requests/$REQUEST_ID/versions" -H 'X-User-Id: ali' -H 'Content-Type: application/json' \
  -d "{\"expectedVersion\":$VERSION,\"expectedRevision\":$REVISION,\"discountBps\":40,\"reason\":\"Competitor improved their offer.\"}"; echo

# 5. The old approval is no longer usable: 409 NO_CURRENT_APPROVAL
curl -s -w ' (HTTP %{http_code})\n' "$API/requests/$REQUEST_ID/approved-discount" -H 'X-User-Id: mortgage-processor'

# 6. Noah approves version 2
DETAIL=$(curl -s "$API/requests/$REQUEST_ID" -H 'X-User-Id: noah')
VERSION=$(echo "$DETAIL" | json .currentVersionNumber); REVISION=$(echo "$DETAIL" | json .rowRevision)
curl -s -X POST "$API/requests/$REQUEST_ID/versions/$VERSION/decision" -H 'X-User-Id: noah' \
  -H 'Content-Type: application/json' -d "{\"expectedRevision\":$REVISION,\"outcome\":\"APPROVED\"}"; echo

# 7. The approved discount is now exactly 40 bps from version 2
curl -s "$API/requests/$REQUEST_ID/approved-discount" -H 'X-User-Id: mortgage-processor'; echo

# 8. Full history: both versions and both decisions
curl -s "$API/requests/$REQUEST_ID" -H 'X-User-Id: ali' \
  | json '.versions.map(v => `v${v.versionNumber} ${v.discountBps} bps ${v.decision ? v.decision.outcome + " by " + v.decision.reviewer.name : "PENDING"}${v.isCurrent ? " (current)" : ""}`).join("\n")'
```

Replaying step 1 with the same key and body returns the original `201` response. Using the same key with a different body returns `409 IDEMPOTENCY_KEY_REUSED`, and a new key returns `409 REQUEST_EXISTS`.

## Business rules (summary)

- One pricing request per application; changes create immutable versions.
- Decisions apply to one exact version. Only the current, undecided version can be decided, and reviewers cannot decide their own requests.
- Only an approved **current** version is usable. Revising removes the usable approval immediately, with no fallback to history.
- Discounts are integer bps with `0 < discount < standard rate`. Reasons are 1–1,000 characters. Declining needs a comment.
- Mortgage finalisation and approval consumption are out of scope. A discount lookup is a snapshot.

Details: [decisions](backend/docs/decisions.md) · [architecture and operations](backend/docs/architecture.md) · [validation evidence](backend/docs/validation.md) · [AI review evidence](backend/docs/ai/).

## Tests and checks

```bash
npm run lint               # oxlint, both workspaces
npm run typecheck          # tsc, both workspaces
npm test                   # unit/component tests (backend Vitest, frontend Vitest + Testing Library)
npm run test:api           # API + real SQLite database: workflow, idempotency, permissions, races, rollback
npm run test:browser       # Playwright: full UI workflow (own ports 3100/5174 and a throwaway DB)
npm run build              # production builds
npm run verify             # lint + typecheck + unit + API tests + build
```

The first Playwright run needs a browser: `npx playwright install chromium`.

### Optional local Postgres profile

```bash
npm run postgres:up -w backend          # Docker Postgres on :5433 (databases: pricing, pricing_test)
npm run test:api:postgres               # same API suite on Postgres; restores the SQLite client afterwards
```

To run the app itself on Postgres, set `DATABASE_URL=postgresql://pricing:pricing@localhost:5433/pricing` in `backend/.env`, then run `npm run db:generate:postgres -w backend && npm run db:migrate:postgres -w backend && npm run db:seed -w backend`. Run `npm run db:generate -w backend` to switch back to SQLite.

## Code review findings (resolved)

Independent review on **2026-09-25**, at commit `fd49dc6`, found three issues to fix before submission. The architecture is small, clear and appropriate for the assessment. **All three are now fixed, with regression tests.** Re-verification results are in [validation evidence](backend/docs/validation.md#external-review-fixes-after-fd49dc6).

1. **P1 — Fresh SQLite setup fails.** In a fresh clone, `npm ci` passes but `npm run setup:local` fails during migration because the database file does not exist. SQLite API tests and browser tests hit the same failure. Creating the empty file allows migration to succeed. **Fix:** initialize the SQLite file non-destructively before migration in local setup and test setup, then verify from an absent database. Relevant code: [backend/package.json](backend/package.json) (`setup:local`, `db:migrate`, `serve:e2e`) and [API test setup](backend/test/global-setup.ts).

2. **P2 — A truncated response breaks creation retries.** The HTTP client converts unreadable JSON into `null`, treats the successful HTTP status as a successful call, and clears the idempotency key. Retrying then sends a different key. An isolated component regression test reproduced this; if the first request committed, the retry gets `REQUEST_EXISTS` instead of the original response. **Fix:** treat an unreadable successful response as an unknown outcome, preserve the original key, and add a regression test for a truncated `201` body. Relevant code: [HTTP client](frontend/src/api/client.ts) and [idempotent submission hook](frontend/src/features/requests/use-idempotent-submit.ts).

3. **P2 — `comment: null` causes HTTP 500.** DTO validation accepts `null`, but the domain calls `.trim()` on it. Direct API checks reproduced `500 INTERNAL_ERROR` for both approval and decline; omitting an approval comment works. **Fix:** reject explicit `null` at the DTO boundary while allowing omission, and add regression tests for both outcomes that verify rejection leaves the request unchanged. Relevant code: [decision DTO](backend/src/presentation/dto.ts) and [domain rules](backend/src/domain/pricing-request.ts).

Review verification: lint, type checking, builds, backend unit tests (39/39), frontend tests (11/11) and Postgres API tests (37/37) passed. SQLite API and browser tests failed during migration setup in the unchanged code. With only a file-creation workaround in a disposable clone, SQLite API tests (37/37) and browser tests (2/2) passed. Those workaround results did not establish a pass for the setup as submitted at `fd49dc6`. After the fixes, the full gate was rerun: SQLite API 39/39, Postgres API 39/39, browser 2/2, frontend 12/12. The SQLite config now creates the database file non-destructively before every Prisma command.

## Hosting (not done here)

Nothing was deployed or provisioned.

- **Database:** a Supabase Postgres project. Set `DATABASE_URL` (runtime; the pooler is fine) and `DIRECT_URL` (direct or session-pooler connection for migrations), then run `npm run db:generate:postgres -w backend && npm run db:migrate:postgres -w backend`. Do not seed or reset a production database. Keep credentials on the server, and do not expose these tables through Supabase's Data API.
- **API:** any Node 24 host. Build with `npm run build -w backend` and start with `npm start -w backend`. Set `CORS_ORIGIN` to the UI's origin.
- **UI:** any static host. Build with `VITE_API_URL=https://your-api npm run build -w frontend` and serve `frontend/dist`.
- **Authentication is required first.** Demo identity cannot run in production. Replace `ActorGuard` with verified OIDC/JWT user identity and a service credential for the SYSTEM caller.

## Before production

**Done and tested here:** versioned requests, exact-version decisions, no fallback, server-side permissions, self-approval block, idempotent creation, optimistic concurrency with rollback, and constraint-backed integrity. These pass on SQLite and on local Docker Postgres.

**Still to do:**

- Verified user and service authentication, finer authorisation scopes, and database grants
- Production Postgres/Supabase validation and deployment configuration
- Restricted direct database and Data API access
- Atomic approval consumption, or re-validation, at mortgage finalisation
- Audit retention and tamper protection
- Idempotency-record expiry
- Rate limiting and structured monitoring/alerting
- Backup restore drills and a reviewed migration procedure

## Time spent

- Candidate (human) time: **_to be completed by the candidate_**
- Coding-agent session: see [validation](backend/docs/validation.md#session-timing). It is taken from recorded file and commit timestamps, not an estimate.
