# Validation evidence

Commands were run by the coding agent on macOS (Darwin 25.4), Node 24.21.0, npm 11.19.0, Docker 28.4.0 with `postgres:17-alpine`. **Assessed code commit: `c8e6370`** on branch `feat/pricing-exceptions`. Documentation was committed after this and does not change code or tests. The run was at 2026-09-25T11:18Z.

## Final gate (`c8e6370`)

| Command | Result |
|---|---|
| `npm run lint` | exit 0, no findings (oxlint, both workspaces) |
| `npm run typecheck` | exit 0 (tsc strict, both workspaces) |
| `npm test` | backend 3 files / **39 passed**; frontend 4 files / **11 passed** |
| `npm run test:api` (SQLite, temp DB) | 5 files / **37 passed** |
| `npm run test:api:postgres` (Docker Postgres 17, `pricing_test`) | 5 files / **37 passed** |
| `npm run test:browser` (Playwright, Chromium) | **2 passed** |
| `npm run build` | exit 0 (Nest `tsc` build + Vite production build) |

Coverage from Vitest v8, API suite on SQLite plus unit suite:

| Area | Statements | Branches |
|---|---:|---:|
| `src/application` (use cases) | 95.5% | 95.5% |
| `src/domain` (rules), unit tests alone | 95.9% | 95.2% |
| `src/domain` under the API suite | 91.8% | 90.5% |
| `src/infrastructure/prisma-pricing-store.ts` | 92.0% | 90.9% |
| All non-generated backend source (API suite) | 88.2% | 78.8% |

## Fresh-clone walkthrough

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
4. In the `257ed78` clone: same key and body → the original `201` body, with the same request id and `rowRevision: 0`. Same key with a changed body → `409 IDEMPOTENCY_KEY_REUSED`. New key → `409 REQUEST_EXISTS`. Running `npm run db:seed` again kept the new history (APP-100 still at v2 / 40 bps approved). The API suite also covers these at `c8e6370`.

`npm run dev` was also checked: both servers started, `/health` returned `{"status":"ok"}`, and the UI served on :5173. A UI screenshot is at `docs/images/reviewer-workspace.png`. The mobile layout (390 px) was checked by a screenshot that was not committed.

## Problems found during validation (not hidden)

| Problem | Evidence | Resolution |
|---|---|---|
| Backend `tsc` rejected `Promise.withResolvers` in tests (target ES2023) | First `npm run verify`: `TS2550` | Target set to ES2024, which Node 24 supports (`8821d26`) |
| Race-window bug: a concurrent create retry could get `REQUEST_EXISTS` instead of its replay | New tests from AI finding F4 failed: `expected 409 to be 201` | Fixed in `bcd43ba`; see `ai/verification.md` |
| One Postgres run had 2 tests fail with `Parse Error: Expected HTTP/` | `test:api:postgres` at `36b3b30`: 35/37 | **Probable** cause, not proven: supertest dials `127.0.0.1` while the wildcard-bound server shared an ephemeral port with one of 43 loopback-only listeners on this machine. The test server now binds `127.0.0.1` (`c8e6370`). Afterwards: 3 × Postgres and 3 × SQLite runs, all 37/37, then the final gate above. |

## Not verified

- **Supabase** and any hosted deployment. Nothing was provisioned; Supabase readiness is **not** claimed.
- Operating systems other than macOS. `setup:local` uses POSIX `test`/`cp`, so Windows needs WSL or Git Bash (untested).
- Browsers other than Chromium, and manual screen-reader testing.
- CI: no CI configuration or remote exists, so all checks were run locally.
- The KPI analysis items that need a human reviewer or a GitHub PR are reported as manual in the final report.

## Environment notes

- Another local project listens on `127.0.0.1:3000`. The Nest API still starts because it binds `::`, but `curl localhost:3000` reached the other app. Walkthrough checks therefore used port 3001 or `[::1]:3000`. On a clean machine the documented default ports apply.
- npm 11 warns about install scripts. The root `package.json` `allowScripts` approves `better-sqlite3`, `esbuild`, `prisma` and `@prisma/engines`, and denies the `@scarf/scarf` telemetry hook. `npm ci` still lists the optional macOS `fsevents` package, which ships a prebuilt binary; it was left unlisted.

## Session timing

The times below come from file and commit timestamps (local time, UTC+2) and are not estimates:

- First agent-created repository file (`.nvmrc`): 12:44. Node 24.21.0 was installed shortly before.
- Last code commit (`c8e6370`): 13:18. The documentation commit followed.
- Candidate (human) time is not known to the agent; the README has a field for it.
