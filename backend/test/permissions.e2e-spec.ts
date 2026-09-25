import { resetData, startApp, type TestApp } from './helpers.js';

describe('identity and permissions', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await startApp();
  });
  beforeEach(() => resetData(ctx.prisma));
  afterAll(() => ctx.app.close());

  async function historyCounts() {
    const { prisma } = ctx;
    return [await prisma.pricingRequest.count(), await prisma.requestVersion.count(), await prisma.decision.count()];
  }

  it('returns 401 for missing or unknown identity', async () => {
    expect((await ctx.api.list('')).status).toBe(401);
    const unknown = await ctx.api.list('mallory');
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual({
      code: 'UNAUTHENTICATED',
      message: expect.any(String),
      correlationId: expect.any(String),
    });
  });

  it('returns 403 for a role that may not perform the action', async () => {
    const { api } = ctx;
    const before = await historyCounts();
    expect((await api.create('emma', { applicationId: 'APP-100', discountBps: 25, reason: 'x' })).status).toBe(403);
    expect((await api.decide('ali', 'REQ-101', 1, { expectedRevision: 0, outcome: 'APPROVED' })).status).toBe(403);
    expect(
      (await api.revise('emma', 'REQ-101', { expectedVersion: 1, expectedRevision: 0, discountBps: 30, reason: 'x' }))
        .status,
    ).toBe(403);
    expect((await api.approvedDiscount('REQ-103', 'emma')).status).toBe(403);
    expect((await api.list('mortgage-processor')).status).toBe(403);
    expect(await historyCounts()).toEqual(before);
  });

  it('hides other managers requests and applications', async () => {
    const { api } = ctx;
    const before = await historyCounts();
    expect((await api.get('deniz', 'REQ-101')).status).toBe(404);
    expect(
      (await api.revise('deniz', 'REQ-101', { expectedVersion: 1, expectedRevision: 0, discountBps: 30, reason: 'x' }))
        .status,
    ).toBe(404);
    expect((await api.create('deniz', { applicationId: 'APP-100', discountBps: 25, reason: 'x' })).status).toBe(404);
    expect((await api.create('ali', { applicationId: 'APP-999', discountBps: 25, reason: 'x' })).status).toBe(404);
    expect((await api.list('deniz')).body.items.map((item: { id: string }) => item.id)).toEqual(['REQ-200']);
    expect(await historyCounts()).toEqual(before);
  });

  it('shows reviewers every request', async () => {
    expect((await ctx.api.list('emma')).body.total).toBe(4);
  });

  it('returns 404 for an unknown request', async () => {
    expect((await ctx.api.approvedDiscount('REQ-404')).status).toBe(404);
  });
});
