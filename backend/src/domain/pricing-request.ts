import { DomainError } from './domain-error.js';

export type Role = 'MANAGER' | 'REVIEWER' | 'SYSTEM';
export type DecisionOutcome = 'APPROVED' | 'DECLINED';
export type RequestStatus = 'PENDING' | DecisionOutcome;

export const MAX_TEXT_LENGTH = 1000;

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface MortgageApplication {
  id: string;
  customerLabel: string;
  managerId: string;
  standardRateBps: number;
  requestId: string | null;
}

export interface Decision {
  id: string;
  outcome: DecisionOutcome;
  comment: string | null;
  reviewer: User;
  decidedAt: Date;
}

export interface RequestVersion {
  id: string;
  versionNumber: number;
  discountBps: number;
  reason: string;
  createdBy: User;
  createdAt: Date;
  decision: Decision | null;
}

export interface PricingRequest {
  id: string;
  application: MortgageApplication;
  creator: User;
  currentVersionNumber: number;
  rowRevision: number;
  createdAt: Date;
  /** Ordered by versionNumber ascending. */
  versions: RequestVersion[];
}

export interface VersionContent {
  discountBps: number;
  reason: string;
}

export interface ConcurrencyToken {
  expectedVersion: number;
  expectedRevision: number;
}

export interface DecisionInput {
  versionNumber: number;
  expectedRevision: number;
  reviewerId: string;
  outcome: DecisionOutcome;
  comment?: string;
}

export function normalizeReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TEXT_LENGTH) {
    throw new DomainError('VALIDATION_FAILED', `Reason must contain 1-${MAX_TEXT_LENGTH} characters after trimming.`);
  }
  return trimmed;
}

export function assertValidDiscount(discountBps: number, standardRateBps: number): void {
  if (Number.isInteger(discountBps) && discountBps > 0 && discountBps < standardRateBps) return;
  throw new DomainError(
    'VALIDATION_FAILED',
    `Discount must be a whole number of basis points above 0 and below the standard rate (${standardRateBps} bps).`,
  );
}

export function currentVersion(request: PricingRequest): RequestVersion {
  const version = request.versions.find((candidate) => candidate.versionNumber === request.currentVersionNumber);
  if (!version)
    throw new Error(`Request ${request.id} is missing its current version ${request.currentVersionNumber}.`);
  return version;
}

export function requestStatus(request: PricingRequest): RequestStatus {
  return currentVersion(request).decision?.outcome ?? 'PENDING';
}

function assertFreshToken(request: PricingRequest, token: ConcurrencyToken): void {
  if (token.expectedVersion === request.currentVersionNumber && token.expectedRevision === request.rowRevision) return;
  throw new DomainError('STALE_REVISION', 'The request changed since it was loaded. Reload it and try again.');
}

export function planRevision(
  request: PricingRequest,
  token: ConcurrencyToken,
  content: VersionContent,
): VersionContent & { versionNumber: number } {
  assertFreshToken(request, token);
  assertValidDiscount(content.discountBps, request.application.standardRateBps);
  const reason = normalizeReason(content.reason);
  const current = currentVersion(request);
  if (current.discountBps === content.discountBps && current.reason === reason) {
    throw new DomainError('NO_CHANGE', 'The revision is identical to the current version.');
  }
  return { versionNumber: request.currentVersionNumber + 1, discountBps: content.discountBps, reason };
}

function normalizeDecisionComment(outcome: DecisionOutcome, comment = ''): string | null {
  const trimmed = comment.trim();
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new DomainError('VALIDATION_FAILED', `Comment must be at most ${MAX_TEXT_LENGTH} characters.`);
  }
  if (outcome === 'DECLINED' && trimmed.length === 0) {
    throw new DomainError('VALIDATION_FAILED', 'Declining requires a comment.');
  }
  return trimmed || null;
}

export function planDecision(
  request: PricingRequest,
  input: DecisionInput,
): { version: RequestVersion; comment: string | null } {
  const version = request.versions.find((candidate) => candidate.versionNumber === input.versionNumber);
  if (!version) throw new DomainError('NOT_FOUND', `Version ${input.versionNumber} does not exist.`);
  if (version.versionNumber !== request.currentVersionNumber) {
    throw new DomainError('VERSION_NOT_CURRENT', 'Only the current version can be reviewed.');
  }
  if (version.decision) throw new DomainError('ALREADY_DECIDED', 'This version already has a decision.');
  assertFreshToken(request, { expectedVersion: input.versionNumber, expectedRevision: input.expectedRevision });
  if (input.reviewerId === version.createdBy.id || input.reviewerId === request.creator.id) {
    throw new DomainError('SELF_APPROVAL', 'You cannot review a request you created.');
  }
  return { version, comment: normalizeDecisionComment(input.outcome, input.comment) };
}

/** Only an approved current version is usable; older approvals never count. */
export function currentApproval(request: PricingRequest): { version: RequestVersion; decision: Decision } {
  const version = currentVersion(request);
  if (version.decision?.outcome !== 'APPROVED') {
    throw new DomainError('NO_CURRENT_APPROVAL', 'The current version of this request is not approved.');
  }
  return { version, decision: version.decision };
}
