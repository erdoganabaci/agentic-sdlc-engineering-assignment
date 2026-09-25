import { defineConfig } from 'prisma/config';
import { loadLocalEnvFile, readDatabaseUrl } from './src/infrastructure/config.js';

loadLocalEnvFile();
const databaseUrl = readDatabaseUrl();
if (!databaseUrl.startsWith('file:')) {
  throw new Error('The SQLite profile requires a file: DATABASE_URL.');
}

export default defineConfig({
  schema: 'prisma/sqlite/schema.prisma',
  migrations: { path: 'prisma/sqlite/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: databaseUrl },
});
