import type { DecisionOutcome, MortgageApplication, PricingRequest, User } from '../domain/pricing-request.js';

export interface StoredResponse {
  status: number;
  body: unknown;
}

export interface IdempotencyRecord {
  payloadHash: string;
  response: StoredResponse;
}

export interface IdempotencyKey {
  actorId: string;
  scope: string;
  key: string;
}

export interface NewRequest {
  requestId: string;
  applicationId: string;
  creatorId: string;
  discountBps: number;
  reason: string;
}

export interface NewVersion {
  requestId: string;
  versionNumber: number;
  discountBps: number;
  reason: string;
  createdById: string;
}

export interface NewDecision {
  decisionId: string;
  versionId: string;
  reviewerId: string;
  outcome: DecisionOutcome;
  comment: string | null;
}

export interface AdvanceGuard {
  requestId: string;
  expectedVersion: number;
  expectedRevision: number;
  nextVersion: number;
}

/** Raised by the store when a database unique constraint rejects a write. */
export class UniqueViolationError extends Error {
  constructor() {
    super('A unique database constraint rejected the write.');
    this.name = 'UniqueViolationError';
  }
}

/** Persistence port. Abstract class so it doubles as the Nest injection token. */
export abstract class PricingStore {
  /** Runs work atomically; transient conflicts are retried a bounded number of times. */
  abstract transaction<T>(work: (store: PricingStore) => Promise<T>): Promise<T>;
  abstract findUser(userId: string): Promise<User | null>;
  abstract listUsers(): Promise<User[]>;
  abstract findApplication(applicationId: string): Promise<MortgageApplication | null>;
  abstract listApplications(managerId?: string): Promise<MortgageApplication[]>;
  abstract findRequest(requestId: string): Promise<PricingRequest | null>;
  abstract listRequests(managerId?: string): Promise<PricingRequest[]>;
  abstract findIdempotencyRecord(key: IdempotencyKey): Promise<IdempotencyRecord | null>;
  abstract saveIdempotencyRecord(key: IdempotencyKey, record: IdempotencyRecord): Promise<void>;
  abstract createRequest(request: NewRequest): Promise<void>;
  /** Moves the request to nextVersion and bumps rowRevision only if both expectations still hold. */
  abstract advanceRequest(guard: AdvanceGuard): Promise<boolean>;
  abstract addVersion(version: NewVersion): Promise<void>;
  abstract addDecision(decision: NewDecision): Promise<void>;
}
