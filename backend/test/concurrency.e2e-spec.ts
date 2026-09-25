import { vi } from 'vitest';
import { overlapAdvances, resetData, startApp, type TestApp } from './helpers.js';

const statuses = (results: { status: number }[]) => results.map((result) => result.status).sort((a, b) => a - b);

describe('concurrent revisions and decisions', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await startApp();
  });
  beforeEach(() => resetData(ctx.prisma));
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => ctx.app.close());

  it('records exactly one decision when two reviewers act at once', async () => {
    overlapAdvances();
    const results = await Promise.all([
      ctx.api.decide('emma', 'REQ-101', 1, { expectedRevision: 0, outcome: 'APPROVED' }),
      ctx.api.decide('noah', 'REQ-101', 1, { expectedRevision: 0, outcome: 'DECLINED', comment: 'No evidence' }),
    ]);
    expect(statuses(results)).toEqual([200, 409]);
    expect(await ctx.prisma.decision.count({ where: { version: { requestId: 'REQ-101' } } })).toBe(1);
  });

  it('accepts exactly one of two simultaneous revisions', async () => {
    overlapAdvances();
    const token = { expectedVersion: 1, expectedRevision: 0 };
    const results = await Promise.all([
      ctx.api.revise('ali', 'REQ-101', { ...token, discountBps: 30, reason: 'First edit' }),
      ctx.api.revise('ali', 'REQ-101', { ...token, discountBps: 35, reason: 'Second edit' }),
    ]);
    expect(statuses(results)).toEqual([201, 409]);
    const versions = await ctx.prisma.requestVersion.findMany({ where: { requestId: 'REQ-101' } });
    expect(versions).toHaveLength(2);
  });

  it('keeps a valid serial order when a decision races a revision', async () => {
    overlapAdvances();
    const [decision, revision] = await Promise.all([
      ctx.api.decide('emma', 'REQ-101', 1, { expectedRevision: 0, outcome: 'APPROVED' }),
      ctx.api.revise('ali', 'REQ-101', { expectedVersion: 1, expectedRevision: 0, discountBps: 60, reason: 'Changed' }),
    ]);
    expect(statuses([decision, revision])).toEqual(decision.status === 200 ? [200, 409] : [201, 409]);

    const request = await ctx.prisma.pricingRequest.findUniqueOrThrow({
      where: { id: 'REQ-101' },
      include: { versions: { include: { decision: true }, orderBy: { versionNumber: 'asc' } } },
    });
    if (decision.status === 200) {
      // Decision first: the approval belongs to the unchanged v1 and no revision exists.
      expect(request.versions).toHaveLength(1);
      expect(request.versions[0].decision?.outcome).toBe('APPROVED');
    } else {
      // Revision first: v1 was never approved and the new v2 is pending.
      expect(request.versions.map((version) => version.decision)).toEqual([null, null]);
      expect(request.currentVersionNumber).toBe(2);
    }
  });
});
