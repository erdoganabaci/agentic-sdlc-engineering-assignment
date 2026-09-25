import { DomainError } from './domain-error.js';
import {
  assertValidDiscount,
  currentApproval,
  normalizeReason,
  planDecision,
  planRevision,
  requestStatus,
  type Decision,
  type PricingRequest,
  type RequestVersion,
  type User,
} from './pricing-request.js';

const manager: User = { id: 'ali', name: 'Ali', role: 'MANAGER' };
const reviewer: User = { id: 'emma', name: 'Emma', role: 'REVIEWER' };

function approval(): Decision {
  return { id: 'd1', outcome: 'APPROVED', comment: null, reviewer, decidedAt: new Date('2026-01-01T10:00:00Z') };
}

function version(versionNumber: number, discountBps: number, decision: Decision | null = null): RequestVersion {
  return {
    id: `v${versionNumber}`,
    versionNumber,
    discountBps,
    reason: `Reason ${versionNumber}`,
    createdBy: manager,
    createdAt: new Date('2026-01-01T09:00:00Z'),
    decision,
  };
}

function request(versions: RequestVersion[], rowRevision = 0): PricingRequest {
  return {
    id: 'r1',
    application: { id: 'APP-1', customerLabel: 'Test', managerId: manager.id, standardRateBps: 400, requestId: 'r1' },
    creator: manager,
    currentVersionNumber: versions.length,
    rowRevision,
    createdAt: new Date('2026-01-01T09:00:00Z'),
    versions,
  };
}

function expectDomainError(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`Expected DomainError ${code}`);
}

describe('discount validation', () => {
  it.each([1, 25, 399])('accepts %i bps below a 400 bps standard rate', (discountBps) => {
    expect(() => assertValidDiscount(discountBps, 400)).not.toThrow();
  });

  it.each([0, -5, 400, 401, 12.5])('rejects %s bps', (discountBps) => {
    expectDomainError(() => assertValidDiscount(discountBps, 400), 'VALIDATION_FAILED');
  });
});

describe('reason validation', () => {
  it('trims the reason', () => {
    expect(normalizeReason('  Competing offer  ')).toBe('Competing offer');
  });

  it.each(['', '   ', 'x'.repeat(1001)])('rejects an empty or oversized reason', (reason) => {
    expectDomainError(() => normalizeReason(reason), 'VALIDATION_FAILED');
  });

  it('accepts exactly 1000 characters after trimming', () => {
    expect(normalizeReason(` ${'x'.repeat(1000)} `)).toHaveLength(1000);
  });
});

describe('planRevision', () => {
  const token = { expectedVersion: 1, expectedRevision: 1 };

  it('creates the next pending version and makes an earlier approval unusable', () => {
    const approved = request([version(1, 25, approval())], 1);
    expect(planRevision(approved, token, { discountBps: 40, reason: 'Reason 1' })).toEqual({
      versionNumber: 2,
      discountBps: 40,
      reason: 'Reason 1',
    });
  });

  it('treats a reason-only change as a real revision', () => {
    const next = planRevision(request([version(1, 25)], 1), token, { discountBps: 25, reason: 'New reason' });
    expect(next.versionNumber).toBe(2);
  });

  it('rejects a no-op revision, ignoring surrounding whitespace', () => {
    expectDomainError(
      () => planRevision(request([version(1, 25)], 1), token, { discountBps: 25, reason: '  Reason 1 ' }),
      'NO_CHANGE',
    );
  });

  it.each([
    { expectedVersion: 1, expectedRevision: 0 },
    { expectedVersion: 2, expectedRevision: 1 },
  ])('rejects a stale token %o', (staleToken) => {
    expectDomainError(
      () => planRevision(request([version(1, 25)], 1), staleToken, { discountBps: 40, reason: 'x' }),
      'STALE_REVISION',
    );
  });
});

describe('planDecision', () => {
  const approve = { versionNumber: 1, expectedRevision: 0, reviewerId: reviewer.id, outcome: 'APPROVED' as const };

  it('approves exactly the current pending version', () => {
    const pending = request([version(1, 25)]);
    expect(planDecision(pending, approve)).toEqual({ version: pending.versions[0], comment: null });
  });

  it('rejects a decision on a superseded version', () => {
    const revised = request([version(1, 25), version(2, 40)], 1);
    expectDomainError(() => planDecision(revised, approve), 'VERSION_NOT_CURRENT');
  });

  it('rejects a second decision on the same version', () => {
    expectDomainError(() => planDecision(request([version(1, 25, approval())], 1), approve), 'ALREADY_DECIDED');
  });

  it('rejects a stale revision', () => {
    expectDomainError(() => planDecision(request([version(1, 25)], 3), approve), 'STALE_REVISION');
  });

  it('prevents self-approval even if the author also holds reviewer rights', () => {
    expectDomainError(
      () => planDecision(request([version(1, 25)]), { ...approve, reviewerId: manager.id }),
      'SELF_APPROVAL',
    );
  });

  it('rejects an unknown version', () => {
    expectDomainError(() => planDecision(request([version(1, 25)]), { ...approve, versionNumber: 9 }), 'NOT_FOUND');
  });

  it('requires a comment when declining', () => {
    const pending = request([version(1, 25)]);
    expectDomainError(
      () => planDecision(pending, { ...approve, outcome: 'DECLINED', comment: '  ' }),
      'VALIDATION_FAILED',
    );
    expect(planDecision(pending, { ...approve, outcome: 'DECLINED', comment: ' No evidence ' }).comment).toBe(
      'No evidence',
    );
  });
});

describe('currentApproval', () => {
  it('returns the approved current version', () => {
    const approved = request([version(1, 25, approval())], 1);
    expect(currentApproval(approved).version.discountBps).toBe(25);
    expect(requestStatus(approved)).toBe('APPROVED');
  });

  it('never falls back to an older approval when the current version is pending', () => {
    const revised = request([version(1, 25, approval()), version(2, 40)], 2);
    expect(requestStatus(revised)).toBe('PENDING');
    expectDomainError(() => currentApproval(revised), 'NO_CURRENT_APPROVAL');
  });

  it('never falls back to an older approval when the current version is declined', () => {
    const declined: Decision = { ...approval(), id: 'd2', outcome: 'DECLINED', comment: 'No' };
    const revised = request([version(1, 25, approval()), version(2, 40, declined)], 3);
    expectDomainError(() => currentApproval(revised), 'NO_CURRENT_APPROVAL');
  });
});
