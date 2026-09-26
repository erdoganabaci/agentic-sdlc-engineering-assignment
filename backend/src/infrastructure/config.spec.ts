import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';

describe('loadLocalEnvFile', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pricing-config-'));
    writeFileSync(join(directory, '.env'), 'DATABASE_URL=file:./dev.db\n');
    writeFileSync(join(directory, '.env.supabase'), 'DATABASE_URL=postgresql://localhost/demo\n');
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  function readLoadedDatabaseUrl(overrides: NodeJS.ProcessEnv = {}): string {
    const env = { ...process.env };
    delete env.ENV_FILE;
    delete env.DATABASE_URL;
    const configUrl = new URL('./config.ts', import.meta.url).href;
    return execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { loadLocalEnvFile, readDatabaseUrl } from ${JSON.stringify(configUrl)};
      loadLocalEnvFile();
      process.stdout.write(readDatabaseUrl());
    `,
      ],
      { cwd: directory, env: { ...env, ...overrides }, encoding: 'utf8', stdio: 'pipe' },
    );
  }

  it('keeps SQLite as the default', () => {
    expect(readLoadedDatabaseUrl()).toBe('file:./dev.db');
  });

  it('loads the selected file instead of the default SQLite file', () => {
    expect(readLoadedDatabaseUrl({ ENV_FILE: '.env.supabase' })).toBe('postgresql://localhost/demo');
  });

  it('preserves an explicitly exported database URL', () => {
    expect(readLoadedDatabaseUrl({ ENV_FILE: '.env.supabase', DATABASE_URL: 'postgresql://localhost/override' })).toBe(
      'postgresql://localhost/override',
    );
  });

  it('fails when the selected file is missing instead of falling back to SQLite', () => {
    expect(() => readLoadedDatabaseUrl({ ENV_FILE: '.env.missing' })).toThrow(/ENOENT/);
  });
});

describe('loadConfig', () => {
  const base = { DATABASE_URL: 'file:./test.db' };

  it('refuses demo authentication in production', () => {
    expect(() => loadConfig({ ...base, DEMO_AUTH: 'true', NODE_ENV: 'production' })).toThrow(/DEMO_AUTH/);
  });

  it('allows an explicitly opted-in public assessment demo', () => {
    expect(
      loadConfig({ ...base, DEMO_AUTH: 'true', PUBLIC_DEMO: 'true', NODE_ENV: 'production' }).isDemoAuthEnabled,
    ).toBe(true);
  });

  it('does not enable demo identities just because PUBLIC_DEMO is set', () => {
    expect(loadConfig({ ...base, PUBLIC_DEMO: 'true', NODE_ENV: 'production' }).isDemoAuthEnabled).toBe(false);
  });

  it('rejects non-explicit public-demo values in production', () => {
    for (const publicDemo of ['false', '1', 'TRUE', '']) {
      expect(() => loadConfig({ ...base, DEMO_AUTH: 'true', PUBLIC_DEMO: publicDemo, NODE_ENV: 'production' })).toThrow(
        /PUBLIC_DEMO/,
      );
    }
  });

  it('enables demo authentication only when explicitly set', () => {
    expect(loadConfig({ ...base, DEMO_AUTH: 'true' }).isDemoAuthEnabled).toBe(true);
    expect(loadConfig(base).isDemoAuthEnabled).toBe(false);
  });

  it('requires a database URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
