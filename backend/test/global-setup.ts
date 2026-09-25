import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** SQLite by default (fresh temp file); set E2E_DATABASE_URL to run the same suite against a disposable Postgres. */
export default function setup(project: TestProject): void {
  const postgresUrl = process.env.E2E_DATABASE_URL;
  const databaseUrl = postgresUrl ?? `file:${join(mkdtempSync(join(tmpdir(), 'pricing-e2e-')), 'e2e.db')}`;
  const config = postgresUrl ? 'prisma.postgres.config.ts' : 'prisma.sqlite.config.ts';
  execFileSync('npx', ['prisma', 'migrate', 'deploy', '--config', config], {
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
    stdio: 'inherit',
  });
  project.provide('databaseUrl', databaseUrl);
}
