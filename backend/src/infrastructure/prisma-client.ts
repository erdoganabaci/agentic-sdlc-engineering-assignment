import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export function postgresConnectionOptions(databaseUrl: string, certificate?: string) {
  if (!certificate) return { connectionString: databaseUrl };
  const url = new URL(databaseUrl);
  // URL TLS options override driver options; the supplied CA must retain full verification.
  for (const key of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { ca: certificate, rejectUnauthorized: true } };
}

/** The generated client must match the URL's provider; run the matching db:generate script when switching. */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = databaseUrl.startsWith('file:')
    ? new PrismaBetterSqlite3({ url: databaseUrl })
    : new PrismaPg(postgresConnectionOptions(databaseUrl, process.env.DATABASE_SSL_CA));
  return new PrismaClient({ adapter });
}
