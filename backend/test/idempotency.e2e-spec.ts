import { vi } from 'vitest';
import { overlapCreates, resetData, startApp, type TestApp } from './helpers.js';

const payload = { applicationId: 'APP-100', discountBps: 25, reason: 'Competing offer' };

describe('creation idempotency', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await startApp();
  });
  beforeEach(() => resetData(ctx.prisma));
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => ctx.app.close());

  it('replays the original response for the same key and payload, even after later changes', async () => {
    const { api, prisma } = ctx;
    const first = await api.create('ali', payload, 'key-sequential');
    await api.decide('emma', first.body.requestId, 1, { expectedRevision: 0, outcome: 'APPROVED' });

    const replay = await api.create('ali', { ...payload, reason: '  Competing offer ' }, 'key-sequential');
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(await prisma.pricingRequest.count({ where: { applicationId: 'APP-100' } })).toBe(1);
  });

  it('creates exactly one request for simultaneous identical calls', async () => {
    overlapCreates();
    const [first, second] = await Promise.all([
      ctx.api.create('ali', payload, 'key-concurrent'),
      ctx.api.create('ali', payload, 'key-concurrent'),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.body).toEqual(second.body);
    expect(await ctx.prisma.pricingRequest.count({ where: { applicationId: 'APP-100' } })).toBe(1);
    expect(await ctx.prisma.idempotencyRecord.count()).toBe(1);
  });

  it('rejects the same key with a different payload', async () => {
    await ctx.api.create('ali', payload, 'key-changed');
    const changed = await ctx.api.create('ali', { ...payload, discountBps: 30 }, 'key-changed');
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('does not let a new key bypass one request per application', async () => {
    await ctx.api.create('ali', payload, 'key-original');
    const duplicate = await ctx.api.create('ali', payload, 'key-different');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('REQUEST_EXISTS');
  });

  it('rejects simultaneous creations with different keys for the same application', async () => {
    overlapCreates();
    const results = await Promise.all([
      ctx.api.create('ali', payload, 'key-race-one'),
      ctx.api.create('ali', payload, 'key-race-two'),
    ]);
    expect(results.map((result) => result.status).sort((a, b) => a - b)).toEqual([201, 409]);
    expect(await ctx.prisma.pricingRequest.count({ where: { applicationId: 'APP-100' } })).toBe(1);
  });

  it('finds the persisted record after a process restart', async () => {
    const first = await ctx.api.create('ali', payload, 'key-restart');
    await ctx.app.close();
    ctx = await startApp();
    const replay = await ctx.api.create('ali', payload, 'key-restart');
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
  });

  it('requires a well-formed Idempotency-Key header', async () => {
    const missing = await ctx.api.create('ali', payload, '');
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('VALIDATION_FAILED');
  });
});
