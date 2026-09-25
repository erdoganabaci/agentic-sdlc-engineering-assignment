import { defineConfig } from 'prisma/config';
import { loadLocalEnvFile, readDatabaseUrl } from './src/infrastructure/config.js';

loadLocalEnvFile();

export default defineConfig({
  schema: 'prisma/postgres/schema.prisma',
  migrations: { path: 'prisma/postgres/migrations', seed: 'tsx prisma/seed.ts' },
  // Migrations need a session-capable connection (Supabase: direct or session pooler), not the transaction pooler.
  datasource: { url: process.env.DIRECT_URL ?? readDatabaseUrl() },
});
