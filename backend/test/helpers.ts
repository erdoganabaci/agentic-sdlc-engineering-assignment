import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { inject, vi } from 'vitest';
import { seedDemoData } from '../prisma/seed.js';
import { AppModule } from '../src/app.module.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { AppConfig } from '../src/infrastructure/config.js';
import { PrismaPricingStore } from '../src/infrastructure/prisma-pricing-store.js';
import { configureApp } from '../src/presentation/configure-app.js';

export const databaseUrl = inject('databaseUrl');
export const isPostgres = !databaseUrl.startsWith('file:');

export interface TestApp {
  app: INestApplication;
  prisma: PrismaClient;
  api: ReturnType<typeof createApi>;
}

export async function startApp(): Promise<TestApp> {
  const config: AppConfig = { databaseUrl, isDemoAuthEnabled: true, port: 0, corsOrigin: 'http://localhost:5173' };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, config);
  // Bind loopback explicitly: supertest dials 127.0.0.1, and a wildcard bind can share a port with another local process.
  await app.listen(0, '127.0.0.1');
  return { app, prisma: app.get(PrismaClient), api: createApi(app) };
}

/** Clears request history (never users/applications) and restores the demo fixtures. */
export async function resetData(prisma: PrismaClient): Promise<void> {
  await prisma.decision.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.requestVersion.deleteMany();
  await prisma.pricingRequest.deleteMany();
  await seedDemoData(prisma);
}

interface ReviseBody {
  expectedVersion: number;
  expectedRevision: number;
  discountBps: number;
  reason: string;
}

interface DecisionBody {
  expectedRevision: number;
  outcome: 'APPROVED' | 'DECLINED';
  comment?: string;
}

function createApi(app: INestApplication) {
  const http = request(app.getHttpServer());
  return {
    create: (userId: string, body: object, idempotencyKey: string = randomUUID()) =>
      http.post('/requests').set('X-User-Id', userId).set('Idempotency-Key', idempotencyKey).send(body),
    applications: (userId: string) => http.get('/applications').set('X-User-Id', userId),
    list: (userId: string, query = '') => http.get(`/requests${query}`).set('X-User-Id', userId),
    get: (userId: string, requestId: string) => http.get(`/requests/${requestId}`).set('X-User-Id', userId),
    revise: (userId: string, requestId: string, body: ReviseBody) =>
      http.post(`/requests/${requestId}/versions`).set('X-User-Id', userId).send(body),
    decide: (userId: string, requestId: string, versionNumber: number, body: DecisionBody) =>
      http.post(`/requests/${requestId}/versions/${versionNumber}/decision`).set('X-User-Id', userId).send(body),
    approvedDiscount: (requestId: string, userId = 'mortgage-processor') =>
      http.get(`/requests/${requestId}/approved-discount`).set('X-User-Id', userId),
  };
}

function createBarrier(parties: number): () => Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  let arrived = 0;
  return () => {
    arrived += 1;
    if (arrived === parties) resolve();
    return promise;
  };
}

/**
 * Forces the next `parties` transactions to have all read their state before any of them writes.
 * Postgres only: the SQLite adapter serialises transactions with a mutex, so a barrier would deadlock
 * and the SQLite run instead proves serial-consistent outcomes.
 */
export function overlapAdvances(parties = 2): void {
  if (!isPostgres) return;
  const arrive = createBarrier(parties);
  // oxlint-disable-next-line typescript/unbound-method -- re-invoked below with the original `this`
  const original = PrismaPricingStore.prototype.advanceRequest;
  vi.spyOn(PrismaPricingStore.prototype, 'advanceRequest').mockImplementation(async function (
    this: PrismaPricingStore,
    guard,
  ) {
    await arrive();
    return original.call(this, guard);
  });
}

export function overlapCreates(parties = 2): void {
  if (!isPostgres) return;
  const arrive = createBarrier(parties);
  // oxlint-disable-next-line typescript/unbound-method -- re-invoked below with the original `this`
  const original = PrismaPricingStore.prototype.createRequest;
  vi.spyOn(PrismaPricingStore.prototype, 'createRequest').mockImplementation(async function (
    this: PrismaPricingStore,
    newRequest,
  ) {
    await arrive();
    return original.call(this, newRequest);
  });
}
