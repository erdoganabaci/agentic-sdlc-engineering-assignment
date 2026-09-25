import type { RequestStatus } from '../api/types';

export type BadgeStatus = RequestStatus | 'SUPERSEDED';

const LABELS: Record<BadgeStatus, string> = {
  PENDING: 'Pending review',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
  SUPERSEDED: 'Superseded',
};

export function StatusBadge({ status }: { status: BadgeStatus }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{LABELS[status]}</span>;
}
