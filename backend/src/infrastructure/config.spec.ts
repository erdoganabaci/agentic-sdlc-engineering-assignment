import { loadConfig } from './config.js';

describe('loadConfig', () => {
  const base = { DATABASE_URL: 'file:./test.db' };

  it('refuses demo authentication in production', () => {
    expect(() => loadConfig({ ...base, DEMO_AUTH: 'true', NODE_ENV: 'production' })).toThrow(/DEMO_AUTH/);
  });

  it('enables demo authentication only when explicitly set', () => {
    expect(loadConfig({ ...base, DEMO_AUTH: 'true' }).isDemoAuthEnabled).toBe(true);
    expect(loadConfig(base).isDemoAuthEnabled).toBe(false);
  });

  it('requires a database URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
