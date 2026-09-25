import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/** The generated client must match the URL's provider; run the matching db:generate script when switching. */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = databaseUrl.startsWith('file:')
    ? new PrismaBetterSqlite3({ url: databaseUrl })
    : new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}
