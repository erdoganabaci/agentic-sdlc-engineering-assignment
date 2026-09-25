import {
  PricingStore,
  UniqueViolationError,
  type AdvanceGuard,
  type IdempotencyKey,
  type IdempotencyRecord,
  type NewDecision,
  type NewRequest,
  type NewVersion,
} from '../application/pricing-store.js';
import { DomainError } from '../domain/domain-error.js';
import type { MortgageApplication, PricingRequest, User } from '../domain/pricing-request.js';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';

const MAX_TRANSACTION_ATTEMPTS = 3;

const requestInclude = {
  application: true,
  creator: true,
  versions: {
    orderBy: { versionNumber: 'asc' },
    include: { createdBy: true, decision: { include: { reviewer: true } } },
  },
} satisfies Prisma.PricingRequestInclude;

type RequestRow = Prisma.PricingRequestGetPayload<{ include: typeof requestInclude }>;
type UserRow = Prisma.UserGetPayload<object>;

function toUser({ id, name, role }: UserRow): User {
  return { id, name, role };
}

function toRequest(row: RequestRow): PricingRequest {
  const { application } = row;
  return {
    id: row.id,
    application: {
      id: application.id,
      customerLabel: application.customerLabel,
      managerId: application.managerId,
      standardRateBps: application.standardRateBps,
      requestId: row.id,
    },
    creator: toUser(row.creator),
    currentVersionNumber: row.currentVersionNumber,
    rowRevision: row.rowRevision,
    createdAt: row.createdAt,
    versions: row.versions.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      discountBps: version.discountBps,
      reason: version.reason,
      createdBy: toUser(version.createdBy),
      createdAt: version.createdAt,
      decision: version.decision && {
        id: version.decision.id,
        outcome: version.decision.outcome,
        comment: version.decision.comment,
        reviewer: toUser(version.decision.reviewer),
        decidedAt: version.decision.decidedAt,
      },
    })),
  };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

// P2034: write conflict, deadlock or serialization failure reported by the driver adapter.
const isTransientConflict = (error: unknown) => hasErrorCode(error, 'P2034');

export class PrismaPricingStore extends PricingStore {
  /** Pass root only for the top-level store; transaction-scoped stores reuse the open transaction. */
  constructor(
    private readonly db: Prisma.TransactionClient,
    private readonly root?: PrismaClient,
  ) {
    super();
  }

  transaction<T>(work: (store: PricingStore) => Promise<T>): Promise<T> {
    if (!this.root) return work(this);
    return this.runTransaction(this.root, work, 1);
  }

  private async runTransaction<T>(
    root: PrismaClient,
    work: (store: PricingStore) => Promise<T>,
    attempt: number,
  ): Promise<T> {
    try {
      return await root.$transaction((transactionClient) => work(new PrismaPricingStore(transactionClient)));
    } catch (error) {
      if (hasErrorCode(error, 'P2002')) throw new UniqueViolationError();
      if (!isTransientConflict(error)) throw error;
      if (attempt < MAX_TRANSACTION_ATTEMPTS) return this.runTransaction(root, work, attempt + 1);
      throw new DomainError('TEMPORARILY_UNAVAILABLE', 'The database is busy. Please retry shortly.');
    }
  }

  async findUser(userId: string): Promise<User | null> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    return user && toUser(user);
  }

  async listUsers(): Promise<User[]> {
    const users = await this.db.user.findMany({ orderBy: [{ role: 'asc' }, { name: 'asc' }] });
    return users.map(toUser);
  }

  async findApplication(applicationId: string): Promise<MortgageApplication | null> {
    const applications = await this.findApplications({ id: applicationId });
    return applications[0] ?? null;
  }

  listApplications(managerId?: string): Promise<MortgageApplication[]> {
    return this.findApplications({ managerId });
  }

  private async findApplications(where: Prisma.MortgageApplicationWhereInput): Promise<MortgageApplication[]> {
    const rows = await this.db.mortgageApplication.findMany({
      where,
      include: { request: { select: { id: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map(({ request, ...application }) => ({ ...application, requestId: request?.id ?? null }));
  }

  async findRequest(requestId: string): Promise<PricingRequest | null> {
    const row = await this.db.pricingRequest.findUnique({ where: { id: requestId }, include: requestInclude });
    return row && toRequest(row);
  }

  async listRequests(managerId?: string): Promise<PricingRequest[]> {
    const rows = await this.db.pricingRequest.findMany({
      where: { application: { managerId } },
      include: requestInclude,
    });
    return rows.map(toRequest);
  }

  async findIdempotencyRecord(key: IdempotencyKey): Promise<IdempotencyRecord | null> {
    const row = await this.db.idempotencyRecord.findUnique({ where: { actorId_scope_key: key } });
    if (!row) return null;
    return {
      payloadHash: row.payloadHash,
      response: { status: row.responseStatus, body: JSON.parse(row.responseBody) as unknown },
    };
  }

  async saveIdempotencyRecord(key: IdempotencyKey, record: IdempotencyRecord): Promise<void> {
    await this.db.idempotencyRecord.create({
      data: {
        ...key,
        payloadHash: record.payloadHash,
        responseStatus: record.response.status,
        responseBody: JSON.stringify(record.response.body),
      },
    });
  }

  async createRequest(request: NewRequest): Promise<void> {
    await this.db.pricingRequest.create({
      data: {
        id: request.requestId,
        applicationId: request.applicationId,
        creatorId: request.creatorId,
        currentVersionNumber: 1,
        versions: {
          create: {
            versionNumber: 1,
            discountBps: request.discountBps,
            reason: request.reason,
            createdById: request.creatorId,
          },
        },
      },
    });
  }

  async advanceRequest(guard: AdvanceGuard): Promise<boolean> {
    const { count } = await this.db.pricingRequest.updateMany({
      where: {
        id: guard.requestId,
        currentVersionNumber: guard.expectedVersion,
        rowRevision: guard.expectedRevision,
      },
      data: { currentVersionNumber: guard.nextVersion, rowRevision: { increment: 1 } },
    });
    return count === 1;
  }

  async addVersion(version: NewVersion): Promise<void> {
    await this.db.requestVersion.create({ data: version });
  }

  async addDecision(decision: NewDecision): Promise<void> {
    const { decisionId, ...fields } = decision;
    await this.db.decision.create({ data: { id: decisionId, ...fields } });
  }
}
