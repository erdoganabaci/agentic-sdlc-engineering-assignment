# Validation evidence

## Vercel deployment verification (2026-09-26)

Deployed the working tree with Vercel CLI to [the public UI](https://blue-harvest-ui.vercel.app) and [the API](https://blue-harvest-api.vercel.app/docs). The API uses the Supabase transaction pooler with certificate/hostname verification, and explicitly opts into the synthetic public demo. Git commits and pushes were not performed for this deployment.

| Check | Observed result |
|---|---|
| Backend unit tests | **48 passed**, including environment selection, public-demo opt-in and TLS regression checks |
| Frontend tests | **12 passed** |
| Lint and type checking | Both workspaces passed |
| Fresh SQLite setup in isolated checkout | Database created, migrated and seeded successfully |
| SQLite API suite | **39 passed** |
| Local Playwright suite | **2 passed** |
| Compiled startup regression | **1 passed** through Node's synchronous module loader and real HTTP `/health` |
| Vercel builds | Backend and frontend successfully built and deployed |
| Public browser workflow | Create → replay same creation key → approve 25 bps → revise to 40 bps → old approval unavailable (409) → approve 40 bps → both decisions visible in history |

The hosted workflow used a newly created temporary synthetic application. Only that application, its request/versions/decisions and matching idempotency record were removed afterwards; existing demo fixtures and user edits were preserved. No destructive API suite ran against Supabase. The Docker PostgreSQL suite was not rerun for these deployment changes; its earlier result is recorded below.

The first API deployment built successfully but HTTP requests timed out. Replacing top-level startup awaits with the documented NestJS bootstrap function resolved startup on the subsequent deployment. The new `test/startup.test.mjs` regression also fails with `ERR_REQUIRE_ASYNC_MODULE` when the original top-level-await entrypoint is substituted into an isolated build, and passes again after restoring the bootstrap implementation. `npm run verify` now includes this regression.

## Current verification

Rechecked on **2026-09-26**, at code commit **`41fed14`** on `main`, using a fresh local clone on macOS with Node **24.21.0** and npm **11.19.0**. No code workarounds were required. The Postgres suite used the local Docker Postgres 17 `pricing_test` database.

Run commands from the **repository root**, not from either application folder. Follow the [README prerequisites](../../README.md#prerequisites) first. With nvm installed, this is the checked sequence:

```bash
nvm use
npm ci
npm run setup:local
npm run verify
npx playwright install chromium
npm run test:browser

# Optional: start Docker Desktop / your Docker daemon before these commands
npm run postgres:up -w backend
npm run test:api:postgres
```

`npm run verify` runs lint, type checking, unit/component tests, SQLite API tests and builds; the Vercel changes also add the compiled startup regression. It does not include browser or Postgres tests. Keep the default SQLite `backend/.env` for this sequence; the Postgres test script selects its test database and restores the SQLite client afterwards. Do not run the two database profiles concurrently.

| Command | Result |
|---|---|
| `npm ci` | exit 0 in a fresh clone |
| `npm run setup:local` | exit 0; created the SQLite database, applied migrations and seeded 5 users, 5 applications and 4 requests |
| `npm run lint` | exit 0, no findings (oxlint, both workspaces) |
| `npm run typecheck` | exit 0 (tsc strict, both workspaces) |
| `npm test` | backend 3 files / **39 passed**; frontend 4 files / **12 passed** |
| `npm run test:api` (SQLite, temp DB) | 5 files / **39 passed** |
| `npm run test:api:postgres` (Docker Postgres 17, `pricing_test`) | 5 files / **39 passed** |
| `npm run test:browser` (Playwright, Chromium) | **2 passed** |
| `npm run build` | exit 0 (Nest `tsc` build + Vite production build) |

## Optional Supabase configuration check (2026-09-26)

Added a separate `.env.supabase.example` and [local connection instructions](../../README.md#optional-supabase-database-with-the-app-running-locally); SQLite remains the default. The initial `node --env-file=… --run …` instructions were incorrect: `--run` does not pass the file values to its child process. The initial check used `node -e` and missed this difference. Commands now use `ENV_FILE=.env.supabase npm run …`, and the shared loader selects that file explicitly. The credential file remains ignored by Git.

After the loader fix, backend unit tests passed **43/43**, including four file-selection regression tests; backend lint and type checking passed. The SQLite API suite passed **39/39** in an isolated checkout with the updated loader and existing installed dependencies. SQLite setup had also created and seeded a fresh database successfully before the fix.

With credentials supplied locally, `ENV_FILE=.env.supabase npx prisma migrate status --config prisma.postgres.config.ts` successfully authenticated to Supabase and initially reported the migration as pending. After the user applied it, seeding exposed a separate Node driver TLS error: `self-signed certificate in certificate chain`. Migration-status access had not exercised that driver.

Downloaded the Supabase Root 2021 CA from the HTTPS URL used by the official dashboard and configured `sslmode=verify-full&sslrootcert=./supabase-ca.crt` in the ignored local connection file. Certificate and hostname verification remain enabled. The downloaded certificate's SHA-256 fingerprint was `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA` (expires 2031-04-26).

Verified after the TLS fix:

- `ENV_FILE=.env.supabase npm run db:seed`: exit 0; 5 users, 5 applications, 4 requests.
- `npm run build -w backend`: exit 0.
- Started the built NestJS app on an ephemeral loopback port using the Supabase profile, exercised real HTTP endpoints, then closed it. Demo users (5), Ali's applications and request list returned 200. SYSTEM lookup of `REQ-103` returned the approved **30 bps**; revised `REQ-102` returned 409; Ali's attempt to retrieve the system-only discount returned 403.

These initial checks used the real hosted database with the Node driver. The subsequent deployed browser workflow is recorded in the Vercel section above. The destructive API suite was not run against Supabase.

## Historical coverage (`c8e6370`)

The following coverage figures and original walkthrough were recorded by the coding agent on 2026-09-25 at `c8e6370`, before the external-review fixes. The original test counts were backend 39, frontend 11, API 37 per database and browser 2; use the current table above for the updated counts. Coverage was not remeasured in the 2026-09-26 command check.

Coverage from Vitest v8, API suite on SQLite plus unit suite:

| Area | Statements | Branches |
|---|---:|---:|
| `src/application` (use cases) | 95.5% | 95.5% |
| `src/domain` (rules), unit tests alone | 95.9% | 95.2% |
| `src/domain` under the API suite | 91.8% | 90.5% |
| `src/infrastructure/prisma-pricing-store.ts` | 92.0% | 90.9% |
| All non-generated backend source (API suite) | 88.2% | 78.8% |

## Historical fresh-clone walkthrough (`c8e6370`)

The walkthrough was run in two fresh `git clone`s: first at `257ed78`, then again at the final code commit **`c8e6370`**. Both gave the same results. The steps and actual outputs at `c8e6370`:

1. `npm ci` (exit 0), then `npm run setup:local`. This created `.env`, generated the client, applied the migration and seeded 5 users, 5 applications and 4 requests.
2. The backend was built and started on port **3001**. Port 3000 on this machine was already used by an unrelated local app; see *Environment notes*.
3. The README curl block was extracted **verbatim** and run with only `API=` changed. The actual output was:
   - create → request id;
   - approve v1 → `{"versionNumber":1,…,"outcome":"APPROVED","rowRevision":1}`;
   - approved discount → `discountBps: 25, reviewerId: "emma"`;
   - revise → `{"versionNumber":2,"rowRevision":2}`;
   - lookup → `NO_CURRENT_APPROVAL (HTTP 409)`;
   - approve v2 → `rowRevision: 3`;
   - approved discount → `discountBps: 40, versionNumber: 2, reviewerId: "noah"`;
   - history → `v1 25 bps APPROVED by Emma` / `v2 40 bps APPROVED by Noah (current)`.
4. In the `257ed78` clone: same key and body → the original `201` body, with the same request id and `rowRevision: 0`. Same key with a changed body → `409 IDEMPOTENCY_KEY_REUSED`. New key → `409 REQUEST_EXISTS`. Running the seed again (`npm run db:seed -w backend` from the repository root) kept the new history (APP-100 still at v2 / 40 bps approved). The API suite also covers these at `c8e6370`.

`npm run dev` was also checked: both servers started, `/health` returned `{"status":"ok"}`, and the UI served on :5173. A UI screenshot is at `docs/images/reviewer-workspace.png`. The mobile layout (390 px) was checked by a screenshot that was not committed.

## External review fixes (after `fd49dc6`)

A reviewer reported three issues. After the fixes, the full gate passed again on 2026-09-25:
- lint, typecheck and build: exit 0
- backend unit tests: **39 passed**; frontend: **12 passed**
- `test:api`: **39 passed** on SQLite and **39 passed** on Postgres
- Playwright: **2 passed**

| Issue | Reproduced? | Fix and regression test |
|---|---|---|
| P1: fresh SQLite setup fails because the database file is missing | **Not reproduced.** Fresh clones on Node 24.21.0 and Node 22.14.0 both migrated successfully. The same run showed that on Node 22 the seed **silently did nothing**, because `import.meta.main` requires Node 24.2 or later. | `prisma.sqlite.config.ts` now creates the file in append mode (non-destructive) before any Prisma command. The seed's entry check now compares `import.meta.url` with `process.argv[1]`. Both fresh clones then migrated and seeded. |
| P2: an unreadable success response cleared the creation idempotency key | Yes: a new component test failed | `client.ts` reports an unreadable 2xx body as outcome unknown (status 0), so the retry reuses the key. Test: `create-request-panel.test.tsx` "keeps the key when a success response cannot be read". |
| P2: `comment: null` returned HTTP 500 | Yes: approve and decline both returned 500 | `DecisionDto.comment` now allows the field to be omitted but rejects explicit `null` (`ValidateIf`) with a 400. Tests: `workflow.e2e-spec.ts` "rejects an explicit null comment when APPROVED/DECLINED". |

## Problems found during validation (not hidden)

| Problem | Evidence | Resolution |
|---|---|---|
| Backend `tsc` rejected `Promise.withResolvers` in tests (target ES2023) | First `npm run verify`: `TS2550` | Target set to ES2024, which Node 24 supports (`8821d26`) |
| Race-window bug: a concurrent create retry could get `REQUEST_EXISTS` instead of its replay | New tests from AI finding F4 failed: `expected 409 to be 201` | Fixed in `bcd43ba`; see `ai/verification.md` |
| One Postgres run had 2 tests fail with `Parse Error: Expected HTTP/` | `test:api:postgres` at `36b3b30`: 35/37 | **Probable** cause, not proven: supertest dials `127.0.0.1` while the wildcard-bound server shared an ephemeral port with one of 43 loopback-only listeners on this machine. The test server now binds `127.0.0.1` (`c8e6370`). Afterwards: 3 × Postgres and 3 × SQLite runs, all 37/37, then the final gate above. |

## Not verified

- **Production readiness beyond the synthetic public demo.** Hosted builds and the browser workflow passed as described above; real authentication, operational hardening and production-scale testing remain outside this verification.
- Operating systems other than macOS. `setup:local` uses POSIX `test`/`cp`, so Windows needs WSL or Git Bash (untested).
- Browsers other than Chromium, and manual screen-reader testing.
- CI: no CI configuration exists; all recorded checks were run locally.

## Environment notes

- Another local project listens on `127.0.0.1:3000`. The Nest API still starts because it binds `::`, but `curl localhost:3000` reached the other app. Walkthrough checks therefore used port 3001 or `[::1]:3000`. On a clean machine the documented default ports apply.
- npm 11 warns about install scripts. The root `package.json` `allowScripts` approves `better-sqlite3`, `esbuild`, `prisma` and `@prisma/engines`, and denies the `@scarf/scarf` telemetry hook. `npm ci` still lists the optional macOS `fsevents` package, which ships a prebuilt binary; it was left unlisted.

## Initial coding-session timing

The times below come from file and commit timestamps (local time, UTC+2) and are not estimates:

- First agent-created repository file (`.nvmrc`): 12:44. Node 24.21.0 was installed shortly before.
- Last code commit (`c8e6370`): 13:18. The documentation commit followed.
- The candidate has since recorded approximately 6 hours in the [README](../../README.md#time-spent).
