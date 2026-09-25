import { vi } from 'vitest';
import { seedDemoData } from '../prisma/seed.js';
import { PrismaPricingStore } from '../src/infrastructure/prisma-pricing-store.js';
import { resetData, startApp, type TestApp } from './helpers.js';

describe('atomicity, constraints and persistence', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await startApp();
  });
  beforeEach(() => resetData(ctx.prisma));
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => ctx.app.close());

  it('rolls back the request and version when saving the idempotency record fails', async () => {
    vi.spyOn(PrismaPricingStore.prototype, 'saveIdempotencyRecord').mockRejectedValueOnce(new Error('simulated'));
    const failed = await ctx.api.create(
      'ali',
      { applicationId: 'APP-100', discountBps: 25, reason: 'x' },
      'key-rollback',
    );
    expect(failed.status).toBe(500);
    expect(await ctx.prisma.pricingRequest.count({ where: { applicationId: 'APP-100' } })).toBe(0);
    expect(await ctx.prisma.idempotencyRecord.count()).toBe(0);

    const retried = await ctx.api.create(
      'ali',
      { applicationId: 'APP-100', discountBps: 25, reason: 'x' },
      'key-rollback',
    );
    expect(retried.status).toBe(201);
  });

  it('rolls back the version pointer when inserting a revision fails', async () => {
    vi.spyOn(PrismaPricingStore.prototype, 'addVersion').mockRejectedValueOnce(new Error('simulated'));
    const failed = await ctx.api.revise('ali', 'REQ-101', {
      expectedVersion: 1,
      expectedRevision: 0,
      discountBps: 30,
      reason: 'x',
    });
    expect(failed.status).toBe(500);
    expect(failed.body.code).toBe('INTERNAL_ERROR');
    expect(await ctx.prisma.pricingRequest.findUnique({ where: { id: 'REQ-101' } })).toMatchObject({
      currentVersionNumber: 1,
      rowRevision: 0,
    });
  });

  it('rolls back the revision counter when inserting a decision fails', async () => {
    vi.spyOn(PrismaPricingStore.prototype, 'addDecision').mockRejectedValueOnce(new Error('simulated'));
    await ctx.api.decide('emma', 'REQ-101', 1, { expectedRevision: 0, outcome: 'APPROVED' });
    expect(await ctx.prisma.pricingRequest.findUnique({ where: { id: 'REQ-101' } })).toMatchObject({ rowRevision: 0 });
    expect(await ctx.prisma.decision.count({ where: { version: { requestId: 'REQ-101' } } })).toBe(0);
  });

  it('enforces unique and foreign-key constraints in the database', async () => {
    const { prisma } = ctx;
    await expect(
      prisma.decision.create({ data: { versionId: 'REQ-103-v1', reviewerId: 'emma', outcome: 'DECLINED' } }),
    ).rejects.toThrow();
    await expect(
      prisma.requestVersion.create({
        data: { requestId: 'REQ-103', versionNumber: 1, discountBps: 10, reason: 'dup', createdById: 'ali' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.pricingRequest.create({ data: { applicationId: 'APP-101', creatorId: 'ali', currentVersionNumber: 1 } }),
    ).rejects.toThrow();
    await expect(
      prisma.requestVersion.create({
        data: { requestId: 'REQ-MISSING', versionNumber: 1, discountBps: 10, reason: 'orphan', createdById: 'ali' },
      }),
    ).rejects.toThrow();
  });

  it('keeps ordered history across a restart and a reseed', async () => {
    const token = { expectedVersion: 2, expectedRevision: 2 };
    await ctx.api.decide('emma', 'REQ-102', 2, { expectedRevision: 2, outcome: 'DECLINED', comment: 'Too high' });
    await ctx.api.revise('ali', 'REQ-102', { ...token, expectedRevision: 3, discountBps: 35, reason: 'Compromise' });

    await ctx.app.close();
    ctx = await startApp();
    await seedDemoData(ctx.prisma);

    const detail = await ctx.api.get('ali', 'REQ-102');
    expect(detail.body.versions.map((version: { versionNumber: number }) => version.versionNumber)).toEqual([1, 2, 3]);
    expect(
      detail.body.versions.map((version: { decision: { outcome: string } | null }) => version.decision?.outcome),
    ).toEqual(['APPROVED', 'DECLINED', undefined]);
    expect(detail.body).toMatchObject({ status: 'PENDING', currentVersionNumber: 3, rowRevision: 4 });
  });
});
