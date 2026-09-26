import { pathToFileURL } from 'node:url';
import type { DecisionOutcome, PrismaClient, Role } from '../src/generated/prisma/client.js';
import { loadLocalEnvFile, readDatabaseUrl } from '../src/infrastructure/config.js';
import { createPrismaClient } from '../src/infrastructure/prisma-client.js';

interface FixtureDecision {
  id: string;
  reviewerId: string;
  outcome: DecisionOutcome;
  comment: string | null;
  decidedAt: string;
}

interface FixtureVersion {
  discountBps: number;
  reason: string;
  createdAt: string;
  decision?: FixtureDecision;
}

interface FixtureRequest {
  id: string;
  applicationId: string;
  creatorId: string;
  versions: FixtureVersion[];
}

const STANDARD_RATE_BPS = 400;

const users: { id: string; name: string; role: Role }[] = [
  { id: 'ali', name: 'Ali', role: 'MANAGER' },
  { id: 'deniz', name: 'Deniz', role: 'MANAGER' },
  { id: 'emma', name: 'Emma', role: 'REVIEWER' },
  { id: 'noah', name: 'Noah', role: 'REVIEWER' },
  { id: 'mortgage-processor', name: 'Mortgage Processor', role: 'SYSTEM' },
];

const applications = [
  { id: 'APP-100', customerLabel: 'Synthetic customer A', managerId: 'ali' },
  { id: 'APP-101', customerLabel: 'Synthetic customer B', managerId: 'ali' },
  { id: 'APP-102', customerLabel: 'Synthetic customer C', managerId: 'ali' },
  { id: 'APP-103', customerLabel: 'Synthetic customer D', managerId: 'ali' },
  { id: 'APP-200', customerLabel: 'Synthetic customer E', managerId: 'deniz' },
];

const requests: FixtureRequest[] = [
  {
    id: 'REQ-101',
    applicationId: 'APP-101',
    creatorId: 'ali',
    versions: [
      { discountBps: 25, reason: 'Existing customer with low loan-to-value.', createdAt: '2026-01-05T09:00:00Z' },
    ],
  },
  {
    id: 'REQ-102',
    applicationId: 'APP-102',
    creatorId: 'ali',
    versions: [
      {
        discountBps: 25,
        reason: 'Competing offer from another lender.',
        createdAt: '2026-01-06T09:00:00Z',
        decision: {
          id: 'DEC-102-1',
          reviewerId: 'emma',
          outcome: 'APPROVED',
          comment: 'Within policy.',
          decidedAt: '2026-01-06T11:00:00Z',
        },
      },
      {
        discountBps: 40,
        reason: 'Competitor improved their offer; matching it.',
        createdAt: '2026-01-07T09:00:00Z',
      },
    ],
  },
  {
    id: 'REQ-103',
    applicationId: 'APP-103',
    creatorId: 'ali',
    versions: [
      {
        discountBps: 30,
        reason: 'Long-standing salary account holder.',
        createdAt: '2026-01-08T09:00:00Z',
        decision: {
          id: 'DEC-103-1',
          reviewerId: 'noah',
          outcome: 'APPROVED',
          comment: null,
          decidedAt: '2026-01-08T12:00:00Z',
        },
      },
    ],
  },
  {
    id: 'REQ-200',
    applicationId: 'APP-200',
    creatorId: 'deniz',
    versions: [
      {
        discountBps: 35,
        reason: 'Customer requested a rate match.',
        createdAt: '2026-01-09T09:00:00Z',
        decision: {
          id: 'DEC-200-1',
          reviewerId: 'emma',
          outcome: 'DECLINED',
          comment: 'No competing offer evidence provided.',
          decidedAt: '2026-01-09T13:00:00Z',
        },
      },
    ],
  },
];

async function createRequestFixture(prisma: PrismaClient, fixture: FixtureRequest): Promise<void> {
  const { creatorId } = fixture;
  const decisionCount = fixture.versions.filter((version) => version.decision).length;
  await prisma.pricingRequest.create({
    data: {
      id: fixture.id,
      applicationId: fixture.applicationId,
      creatorId,
      currentVersionNumber: fixture.versions.length,
      rowRevision: fixture.versions.length - 1 + decisionCount,
      createdAt: new Date(fixture.versions[0].createdAt),
      versions: {
        create: fixture.versions.map(({ decision, ...version }, index) => ({
          id: `${fixture.id}-v${index + 1}`,
          versionNumber: index + 1,
          discountBps: version.discountBps,
          reason: version.reason,
          createdById: creatorId,
          createdAt: new Date(version.createdAt),
          decision: decision && { create: { ...decision, decidedAt: new Date(decision.decidedAt) } },
        })),
      },
    },
  });
}

async function assertSeedIsConsistent(prisma: PrismaClient): Promise<void> {
  const seeded = await prisma.pricingRequest.findMany({
    where: { id: { in: requests.map((request) => request.id) } },
    include: { application: true, versions: true },
  });
  for (const request of seeded) {
    const current = request.versions.find((version) => version.versionNumber === request.currentVersionNumber);
    if (!current || current.discountBps >= request.application.standardRateBps) {
      throw new Error(`Seed fixture ${request.id} is inconsistent.`);
    }
  }
}

/** Inserts missing fixtures only; existing rows and later user edits are left untouched. */
export async function seedDemoData(prisma: PrismaClient): Promise<void> {
  for (const user of users) {
    await prisma.user.upsert({ where: { id: user.id }, create: user, update: {} });
  }
  for (const application of applications) {
    const data = { ...application, standardRateBps: STANDARD_RATE_BPS };
    await prisma.mortgageApplication.upsert({ where: { id: application.id }, create: data, update: {} });
  }
  for (const fixture of requests) {
    const existing = await prisma.pricingRequest.findUnique({ where: { applicationId: fixture.applicationId } });
    if (!existing) await createRequestFixture(prisma, fixture);
  }
  await assertSeedIsConsistent(prisma);
}

// Run only as a script, not when tests import seedDemoData. (import.meta.main needs Node 24.2+; this works everywhere.)
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadLocalEnvFile();
  const prisma = createPrismaClient(readDatabaseUrl());
  await seedDemoData(prisma);
  await prisma.$disconnect();
  console.info(
    `Seed complete: ${users.length} users, ${applications.length} applications, ${requests.length} requests.`,
  );
}
