import { closeSync, openSync } from 'node:fs';
import { defineConfig } from 'prisma/config';
import { loadLocalEnvFile, readDatabaseUrl } from './src/infrastructure/config.js';

loadLocalEnvFile();
const databaseUrl = readDatabaseUrl();
if (!databaseUrl.startsWith('file:')) {
  throw new Error('The SQLite profile requires a file: DATABASE_URL.');
}
// Some environments fail to migrate a missing SQLite file; append mode creates it without touching existing data.
closeSync(openSync(databaseUrl.slice('file:'.length).split('?')[0], 'a'));

export default defineConfig({
  schema: 'prisma/sqlite/schema.prisma',
  migrations: { path: 'prisma/sqlite/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: databaseUrl },
});
