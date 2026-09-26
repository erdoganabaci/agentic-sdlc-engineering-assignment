# Vercel assessment deployment

The public assessment uses synthetic data and intentionally allows visitors to pick any seeded manager or reviewer. `PUBLIC_DEMO=true` is an explicit exception for this demonstration; it does not provide real authentication. Ownership checks, validation, versioning, idempotency and concurrency rules still apply to the selected identity. No delete endpoint was added.

## Projects

| Setting | API | UI |
|---|---|---|
| Project | `blue-harvest-api` | `blue-harvest-ui` |
| Root directory | `backend` | `frontend` |
| Framework | NestJS | Vite |
| Node | 24.x | 24.x |
| Install | `npm ci` | `npm ci` |
| Build | `npm run db:generate:postgres && npm run build` | `npm run build` |
| Output directory | Framework default | `dist` |

The root workspace lockfile is shared. Each app's `vercel.json` records its build settings. The API runs in London (`lhr1`), close to the Supabase pooler in `eu-west-2`.

## Environment variables

Configure these in the relevant Vercel project, never in browser source code or committed environment files.

| API variable | Value |
|---|---|
| `DATABASE_URL` | Supabase **transaction pooler**, port 6543, user `postgres.<project-ref>`, database `postgres`, with `sslmode=verify-full` |
| `DATABASE_SSL_CA` | Complete PEM contents of the project's downloaded Supabase root certificate, including BEGIN/END lines |
| `DEMO_AUTH` | `true` |
| `PUBLIC_DEMO` | `true` for this synthetic public assessment only |
| `CORS_ORIGIN` | `https://blue-harvest-ui.vercel.app` |

The inline CA lets the Node driver verify the certificate and hostname without depending on a local file path inside a Vercel function. When it is set, conflicting TLS query parameters are removed and full verification is enforced in the driver. Local connections can continue using the existing `sslrootcert` file setting instead.

The UI needs only `VITE_API_URL=https://blue-harvest-api.vercel.app`. This value is compiled into the frontend, so changing it requires a new UI deployment. Database credentials and certificates belong to the API project only.

Do not set `ENV_FILE` on Vercel. Vercel supplies the variables directly. Do not set `NODE_ENV=development` to bypass the production guard. Public access is intentional for these two assessment projects; deployment protection can be re-enabled to restrict access later.

## Deploy and verify

From the repository root, select Node 24 and log in once:

```bash
nvm use
npx vercel@60.1.3 login
```

Link and deploy each existing project from the repository root:

```bash
npx vercel@60.1.3 link --yes --project blue-harvest-api --scope erdoganabacis-projects
npx vercel@60.1.3 deploy --prod --yes --scope erdoganabacis-projects

npx vercel@60.1.3 link --yes --project blue-harvest-ui --scope erdoganabacis-projects
npx vercel@60.1.3 deploy --prod --yes --scope erdoganabacis-projects
```

Both projects are connected to [erdoganabaci/agentic-sdlc-engineering-assignment](https://github.com/erdoganabaci/agentic-sdlc-engineering-assignment), with `main` as the production branch. Commit changes on a feature branch, open a PR, and merge the reviewed changes into `main` to trigger automatic production deployments. Other branches can generate preview deployments; their API/CORS limitation is described below. Local file edits alone do not deploy.

The initial deployment was made with the CLI from the working tree. Its deployment/configuration fixes must be committed and merged before relying on the next Git-triggered build. The CLI commands above remain available for manual deployment. `.vercelignore` excludes local environment files, SQLite databases and generated output from CLI source uploads; keep credentials out of Git as well.

Verify the running API and open the UI:

```bash
curl --fail https://blue-harvest-api.vercel.app/health
curl --fail https://blue-harvest-api.vercel.app/demo/users
```

Use <https://blue-harvest-ui.vercel.app> for the UI and <https://blue-harvest-api.vercel.app/docs> for Swagger. Check the [validation record](validation.md) for the actual checks performed.

## Database operations

Builds generate the PostgreSQL Prisma client; they do not migrate, seed or reset the database. Apply reviewed migrations separately through the local direct/session connection:

```bash
cd backend
ENV_FILE=.env.supabase npm run db:migrate:postgres
```

Only seed the synthetic development database when needed. Never run the destructive API test suite against the hosted database; it deletes request history. Preview and production environment settings currently use the same synthetic database, so preview mutations are visible in the public demo too. Use a separate database before previewing changes against real customer data.

If the API URL changes, update `VITE_API_URL` and redeploy the UI. If the UI URL changes, update `CORS_ORIGIN` and redeploy the API. Production CORS currently allows the stable UI URL; a separate preview URL needs a corresponding API configuration.

Local startup remains `npm ci`, `npm run setup:local`, `npm run dev`, using SQLite and no cloud account.
