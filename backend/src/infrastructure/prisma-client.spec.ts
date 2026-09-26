import { postgresConnectionOptions } from './prisma-client.js';

describe('Postgres TLS configuration', () => {
  it('preserves the existing local connection settings without an inline CA', () => {
    const url = 'postgresql://localhost/pricing?sslmode=verify-full&sslrootcert=./supabase-ca.crt';
    expect(postgresConnectionOptions(url)).toEqual({ connectionString: url });
  });

  it('verifies TLS with the supplied CA even when the URL contains conflicting SSL options', () => {
    const options = postgresConnectionOptions(
      'postgresql://demo:encoded%40password@localhost/pricing?sslmode=no-verify&sslrootcert=missing.crt&ssl=false&application_name=pricing',
      'test certificate',
    );
    const url = new URL(options.connectionString);
    expect(options.ssl).toEqual({ ca: 'test certificate', rejectUnauthorized: true });
    expect(url.password).toBe('encoded%40password');
    expect(url.searchParams.get('application_name')).toBe('pricing');
    expect([...url.searchParams.keys()]).toEqual(['application_name']);
  });
});
