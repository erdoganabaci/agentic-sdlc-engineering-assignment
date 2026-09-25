import { resetData, startApp, type TestApp } from './helpers.js';

describe('approval workflow', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await startApp();
  });
  beforeEach(() => resetData(ctx.prisma));
  afterAll(() => ctx.app.close());

  it('creates, approves, revises, re-approves and keeps the full history', async () => {
    const { api } = ctx;
    const startedAt = Date.now();

    const created = await api.create('ali', { applicationId: 'APP-100', discountBps: 25, reason: 'Competing offer' });
    expect(created.status).toBe(201);
    const { requestId } = created.body;
    expect(created.body).toMatchObject({ applicationId: 'APP-100', versionNumber: 1, rowRevision: 0 });

    const firstApproval = await api.decide('emma', requestId, 1, { expectedRevision: 0, outcome: 'APPROVED' });
    expect(firstApproval.status).toBe(200);

    const usable = await api.approvedDiscount(requestId);
    expect(usable.status).toBe(200);
    expect(usable.body).toMatchObject({
      applicationId: 'APP-100',
      requestId,
      versionNumber: 1,
      decisionId: firstApproval.body.decisionId,
      discountBps: 25,
      reviewerId: 'emma',
    });
    expect(Date.parse(usable.body.decidedAt)).toBeGreaterThanOrEqual(startedAt - 1000);

    const revised = await api.revise('ali', requestId, {
      expectedVersion: 1,
      expectedRevision: 1,
      discountBps: 40,
      reason: 'Competitor improved offer',
    });
    expect(revised.status).toBe(201);
    expect(revised.body).toMatchObject({ versionNumber: 2, rowRevision: 2 });

    const unavailable = await api.approvedDiscount(requestId);
    expect(unavailable.status).toBe(409);
    expect(unavailable.body.code).toBe('NO_CURRENT_APPROVAL');

    const secondApproval = await api.decide('noah', requestId, 2, { expectedRevision: 2, outcome: 'APPROVED' });
    expect(secondApproval.status).toBe(200);
    const reapproved = await api.approvedDiscount(requestId);
    expect(reapproved.body).toMatchObject({
      versionNumber: 2,
      discountBps: 40,
      reviewerId: 'noah',
      decisionId: secondApproval.body.decisionId,
    });

    const detail = await api.get('ali', requestId);
    expect(detail.body).toMatchObject({ status: 'APPROVED', currentVersionNumber: 2, rowRevision: 3 });
    expect(detail.body.versions).toMatchObject([
      {
        versionNumber: 1,
        discountBps: 25,
        isCurrent: false,
        decision: { outcome: 'APPROVED', reviewer: { id: 'emma' } },
      },
      {
        versionNumber: 2,
        discountBps: 40,
        isCurrent: true,
        decision: { outcome: 'APPROVED', reviewer: { id: 'noah' } },
      },
    ]);
  });

  it('returns NO_CURRENT_APPROVAL after a decline and requires a decline comment', async () => {
    const { api } = ctx;
    const withoutComment = await api.decide('emma', 'REQ-101', 1, { expectedRevision: 0, outcome: 'DECLINED' });
    expect(withoutComment.status).toBe(400);

    const declined = await api.decide('emma', 'REQ-101', 1, {
      expectedRevision: 0,
      outcome: 'DECLINED',
      comment: 'Insufficient evidence',
    });
    expect(declined.status).toBe(200);
    expect((await api.approvedDiscount('REQ-101')).body.code).toBe('NO_CURRENT_APPROVAL');
  });

  it.each(['APPROVED', 'DECLINED'] as const)('rejects an explicit null comment when %s', async (outcome) => {
    const response = await ctx.api.decide('emma', 'REQ-101', 1, {
      expectedRevision: 0,
      outcome,
      comment: null,
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(await ctx.prisma.decision.count({ where: { version: { requestId: 'REQ-101' } } })).toBe(0);
  });

  it('never falls back to the historical approval of a revised request', async () => {
    const seededRevision = await ctx.api.approvedDiscount('REQ-102');
    expect(seededRevision.status).toBe(409);
    expect(seededRevision.body.code).toBe('NO_CURRENT_APPROVAL');
  });

  it('rejects a stale approval after a revision and a stale revision after a competing write', async () => {
    const { api } = ctx;
    const revised = await api.revise('ali', 'REQ-101', {
      expectedVersion: 1,
      expectedRevision: 0,
      discountBps: 30,
      reason: 'Updated reason',
    });
    expect(revised.status).toBe(201);

    const staleApproval = await api.decide('emma', 'REQ-101', 1, { expectedRevision: 0, outcome: 'APPROVED' });
    expect(staleApproval.status).toBe(409);
    expect(staleApproval.body.code).toBe('VERSION_NOT_CURRENT');

    const staleRevision = await api.revise('ali', 'REQ-101', {
      expectedVersion: 1,
      expectedRevision: 0,
      discountBps: 35,
      reason: 'Another change',
    });
    expect(staleRevision.status).toBe(409);
    expect(staleRevision.body.code).toBe('STALE_REVISION');

    const secondDecision = await api.decide('emma', 'REQ-103', 1, { expectedRevision: 1, outcome: 'APPROVED' });
    expect(secondDecision.body.code).toBe('ALREADY_DECIDED');
  });

  it('rejects no-op revisions and invalid discounts', async () => {
    const { api } = ctx;
    const noOp = await api.revise('ali', 'REQ-101', {
      expectedVersion: 1,
      expectedRevision: 0,
      discountBps: 25,
      reason: ' Existing customer with low loan-to-value. ',
    });
    expect(noOp.status).toBe(400);
    expect(noOp.body.code).toBe('NO_CHANGE');

    for (const discountBps of [0, 400, 12.5, '25']) {
      const invalid = await api.create('ali', { applicationId: 'APP-100', discountBps, reason: 'x' });
      expect(invalid.status).toBe(400);
    }
    for (const content of [
      { discountBps: 400, reason: 'Too high' },
      { discountBps: 40, reason: '   ' },
    ]) {
      const invalidRevision = await api.revise('ali', 'REQ-101', {
        expectedVersion: 1,
        expectedRevision: 0,
        ...content,
      });
      expect(invalidRevision.status).toBe(400);
    }
    expect(await ctx.prisma.pricingRequest.findUnique({ where: { id: 'REQ-101' } })).toMatchObject({
      currentVersionNumber: 1,
      rowRevision: 0,
    });
    expect(await ctx.prisma.requestVersion.count({ where: { requestId: 'REQ-101' } })).toBe(1);

    const unexpectedField = await api.create('ali', {
      applicationId: 'APP-100',
      discountBps: 25,
      reason: 'x',
      status: 'APPROVED',
    });
    expect(unexpectedField.status).toBe(400);
  });

  it('lists requests with a status filter and pagination', async () => {
    const { api } = ctx;
    const pending = await api.list('emma', '?status=PENDING');
    expect(pending.body.items.map((item: { id: string }) => item.id).sort()).toEqual(['REQ-101', 'REQ-102']);

    const firstPage = await api.list('emma', '?page=1&pageSize=3');
    const secondPage = await api.list('emma', '?page=2&pageSize=3');
    expect(firstPage.body).toMatchObject({ total: 4, page: 1, pageSize: 3 });
    const ids = (page: { body: { items: { id: string }[] } }) => page.body.items.map((item) => item.id);
    // Most recently updated first, id as tiebreaker; pages neither overlap nor skip.
    expect([...ids(firstPage), '|', ...ids(secondPage)]).toEqual(['REQ-200', 'REQ-103', 'REQ-102', '|', 'REQ-101']);

    expect((await api.list('emma', '?pageSize=101')).status).toBe(400);
  });
});
