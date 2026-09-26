import { existsSync } from 'node:fs';

export interface AppConfig {
  databaseUrl: string;
  isDemoAuthEnabled: boolean;
  port: number;
  corsOrigin: string;
}

export function loadLocalEnvFile(): void {
  if (process.env.ENV_FILE) {
    process.loadEnvFile(process.env.ENV_FILE);
    return;
  }
  if (existsSync('.env')) process.loadEnvFile('.env');
}

export function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required. Copy backend/.env.example to backend/.env.');
  return databaseUrl;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isDemoAuthEnabled = env.DEMO_AUTH === 'true';
  if (isDemoAuthEnabled && env.NODE_ENV === 'production' && env.PUBLIC_DEMO !== 'true') {
    throw new Error('DEMO_AUTH requires PUBLIC_DEMO=true in production. Use this only for a synthetic public demo.');
  }
  return {
    databaseUrl: readDatabaseUrl(env),
    isDemoAuthEnabled,
    port: Number(env.PORT ?? 3000),
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
  };
}

/** Nest injection token for AppConfig. */
export const APP_CONFIG = Symbol('APP_CONFIG');
