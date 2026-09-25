import { createHash, randomUUID } from 'node:crypto';
import { DomainError } from '../domain/domain-error.js';
import {
  assertValidDiscount,
  currentApproval,
  currentVersion,
  normalizeReason,
  planDecision,
  planRevision,
  requestStatus,
  type ConcurrencyToken,
  type DecisionOutcome,
  type MortgageApplication,
  type PricingRequest,
  type RequestStatus,
  type User,
  type VersionContent,
} from '../domain/pricing-request.js';
import { PricingStore, UniqueViolationError, type AdvanceGuard, type StoredResponse } from './pricing-store.js';

const CREATE_SCOPE = 'create-request';

export interface CreateRequestInput extends VersionContent {
  applicationId: string;
}

export interface DecideInput {
  expectedRevision: number;
  outcome: DecisionOutcome;
  comment?: string;
}

export interface ListQuery {
  status?: RequestStatus;
  page: number;
  pageSize: number;
}

function canView(actor: User, request: PricingRequest): boolean {
  if (actor.role === 'REVIEWER') return true;
  return actor.role === 'MANAGER' && request.application.managerId === actor.id;
}

function hashPayload(input: CreateRequestInput): string {
  const canonical = JSON.stringify([input.applicationId, input.discountBps, input.reason]);
  return createHash('sha256').update(canonical).digest('hex');
}

function toSummary(request: PricingRequest) {
  const version = currentVersion(request);
  return {
    id: request.id,
    applicationId: request.application.id,
    customerLabel: request.application.customerLabel,
    standardRateBps: request.application.standardRateBps,
    status: requestStatus(request),
    currentVersionNumber: request.currentVersionNumber,
    discountBps: version.discountBps,
    rowRevision: request.rowRevision,
    updatedAt: version.decision?.decidedAt ?? version.createdAt,
  };
}

function toDetail(request: PricingRequest) {
  return {
    ...toSummary(request),
    creator: request.creator,
    createdAt: request.createdAt,
    versions: request.versions.map((version) => ({
      ...version,
      isCurrent: version.versionNumber === request.currentVersionNumber,
    })),
  };
}

export type RequestSummary = ReturnType<typeof toSummary>;
export type RequestDetail = ReturnType<typeof toDetail>;

export class PricingRequestService {
  constructor(private readonly store: PricingStore) {}

  listUsers(): Promise<User[]> {
    return this.store.listUsers();
  }

  findUser(userId: string): Promise<User | null> {
    return this.store.findUser(userId);
  }

  listApplications(actor: User): Promise<MortgageApplication[]> {
    return this.store.listApplications(actor.role === 'MANAGER' ? actor.id : undefined);
  }

  async listRequests(actor: User, query: ListQuery) {
    const requests = await this.store.transaction((store) =>
      store.listRequests(actor.role === 'MANAGER' ? actor.id : undefined),
    );
    // ponytail: filter and page in memory; fine for demo volumes, move into SQL if request counts grow.
    const matching = requests
      .map(toSummary)
      .filter((summary) => !query.status || summary.status === query.status)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id));
    const start = (query.page - 1) * query.pageSize;
    return {
      items: matching.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: matching.length,
    };
  }

  async getRequest(actor: User, requestId: string): Promise<RequestDetail> {
    const request = await this.store.transaction((store) => this.findVisibleRequest(store, actor, requestId));
    return toDetail(request);
  }

  async createRequest(actor: User, idempotencyKey: string, input: CreateRequestInput): Promise<StoredResponse> {
    const payload = { ...input, reason: normalizeReason(input.reason) };
    const key = { actorId: actor.id, scope: CREATE_SCOPE, key: idempotencyKey };
    const payloadHash = hashPayload(payload);
    const findReplay = async (store: PricingStore) => {
      const record = await store.findIdempotencyRecord(key);
      if (!record) return null;
      if (record.payloadHash !== payloadHash) {
        throw new DomainError(
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used with a different payload.',
        );
      }
      return record.response;
    };

    try {
      return await this.store.transaction(async (store) => {
        const replay = await findReplay(store);
        if (replay) return replay;
        const application = await store.findApplication(payload.applicationId);
        if (!application || application.managerId !== actor.id) {
          throw new DomainError('NOT_FOUND', 'Application not found.');
        }
        if (application.requestId) throw requestExists();
        assertValidDiscount(payload.discountBps, application.standardRateBps);
        const requestId = randomUUID();
        await store.createRequest({ requestId, creatorId: actor.id, ...payload });
        const response = {
          status: 201,
          body: { requestId, applicationId: application.id, versionNumber: 1, rowRevision: 0 },
        };
        await store.saveIdempotencyRecord(key, { payloadHash, response });
        return response;
      });
    } catch (error) {
      if (!(error instanceof UniqueViolationError)) throw error;
      // A concurrent call committed first: replay it if it used this key, otherwise the application is taken.
      const replay = await this.store.transaction(findReplay);
      if (replay) return replay;
      throw requestExists();
    }
  }

  async reviseRequest(actor: User, requestId: string, token: ConcurrencyToken, content: VersionContent) {
    return this.store.transaction(async (store) => {
      const request = await this.findVisibleRequest(store, actor, requestId);
      if (request.creator.id !== actor.id) {
        throw new DomainError('FORBIDDEN', 'Only the manager who created the request can revise it.');
      }
      const next = planRevision(request, token, content);
      await this.advance(store, { requestId, ...token, nextVersion: next.versionNumber });
      await store.addVersion({ requestId, createdById: actor.id, ...next });
      return { requestId, versionNumber: next.versionNumber, rowRevision: request.rowRevision + 1 };
    });
  }

  async decide(actor: User, requestId: string, versionNumber: number, input: DecideInput) {
    return this.store.transaction(async (store) => {
      const request = await this.findVisibleRequest(store, actor, requestId);
      const { version, comment } = planDecision(request, { ...input, versionNumber, reviewerId: actor.id });
      await this.advance(store, {
        requestId,
        expectedVersion: versionNumber,
        expectedRevision: input.expectedRevision,
        nextVersion: versionNumber,
      });
      const decisionId = randomUUID();
      await store.addDecision({
        decisionId,
        versionId: version.id,
        reviewerId: actor.id,
        outcome: input.outcome,
        comment,
      });
      return { requestId, versionNumber, decisionId, outcome: input.outcome, rowRevision: request.rowRevision + 1 };
    });
  }

  async approvedDiscount(requestId: string) {
    const request = await this.store.transaction((store) => store.findRequest(requestId));
    if (!request) throw new DomainError('NOT_FOUND', 'Request not found.');
    const { version, decision } = currentApproval(request);
    return {
      applicationId: request.application.id,
      requestId: request.id,
      versionNumber: version.versionNumber,
      decisionId: decision.id,
      discountBps: version.discountBps,
      reviewerId: decision.reviewer.id,
      decidedAt: decision.decidedAt,
    };
  }

  private async findVisibleRequest(store: PricingStore, actor: User, requestId: string): Promise<PricingRequest> {
    const request = await store.findRequest(requestId);
    if (!request || !canView(actor, request)) throw new DomainError('NOT_FOUND', 'Request not found.');
    return request;
  }

  private async advance(store: PricingStore, guard: AdvanceGuard): Promise<void> {
    if (await store.advanceRequest(guard)) return;
    throw new DomainError('STALE_REVISION', 'The request changed since it was loaded. Reload it and try again.');
  }
}

function requestExists(): DomainError {
  return new DomainError('REQUEST_EXISTS', 'This application already has a pricing request. Revise it instead.');
}
