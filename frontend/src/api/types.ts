export type Role = 'MANAGER' | 'REVIEWER' | 'SYSTEM';
export type DecisionOutcome = 'APPROVED' | 'DECLINED';
export type RequestStatus = 'PENDING' | DecisionOutcome;

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

export interface RequestSummary {
  id: string;
  applicationId: string;
  customerLabel: string;
  standardRateBps: number;
  status: RequestStatus;
  currentVersionNumber: number;
  discountBps: number;
  rowRevision: number;
  updatedAt: string;
}

export interface Decision {
  id: string;
  outcome: DecisionOutcome;
  comment: string | null;
  reviewer: User;
  decidedAt: string;
}

export interface RequestVersion {
  id: string;
  versionNumber: number;
  discountBps: number;
  reason: string;
  createdBy: User;
  createdAt: string;
  decision: Decision | null;
  isCurrent: boolean;
}

export interface RequestDetail extends RequestSummary {
  creator: User;
  createdAt: string;
  versions: RequestVersion[];
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface VersionContent {
  discountBps: number;
  reason: string;
}

export interface DecisionInput {
  expectedRevision: number;
  outcome: DecisionOutcome;
  comment?: string;
}
