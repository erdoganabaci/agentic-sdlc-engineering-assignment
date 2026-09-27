import { useCallback, useState } from 'react';
import { ApiError, type Api } from '../../api/client';
import type { RequestDetail, User } from '../../api/types';
import { useLoad } from '../../api/use-load';
import { Notice } from '../../components/notice';
import { StatusBadge } from '../../components/status-badge';
import { formatRate } from './rates';
import { RequestForm } from './request-form';
import { ReviewControls } from './review-controls';
import { VersionHistory } from './version-history';

interface RequestDetailPanelProps {
  api: Api;
  actor: User;
  requestId: string;
  onChanged: () => void;
}

interface Feedback {
  tone: 'success' | 'error';
  message: string;
}

function RateSummary({ detail }: { detail: RequestDetail }) {
  const resultingRate = formatRate(detail.standardRateBps - detail.discountBps);
  return (
    <dl className="facts">
      <dt>Standard rate</dt>
      <dd>{formatRate(detail.standardRateBps)}</dd>
      <dt>Requested discount (v{detail.currentVersionNumber})</dt>
      <dd>{detail.discountBps} bps</dd>
      <dt>Usable rate</dt>
      <dd>{detail.status === 'APPROVED' ? `${resultingRate} (approved)` : 'None — current version is not approved'}</dd>
    </dl>
  );
}

export function RequestDetailPanel({ api, actor, requestId, onChanged }: RequestDetailPanelProps) {
  const loadDetail = useCallback(() => api.getRequest(requestId), [api, requestId]);
  const { data: detail, error, reload } = useLoad(loadDetail);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  /** Conflicts reload the authoritative data and require a fresh action; nothing is resubmitted automatically. */
  async function runMutation(action: () => Promise<unknown>, successMessage: string) {
    setFeedback(null);
    try {
      await action();
      setFeedback({ tone: 'success', message: successMessage });
    } catch (mutationError) {
      if (!(mutationError instanceof ApiError && mutationError.isConflict)) throw mutationError;
      setFeedback({ tone: 'error', message: `${mutationError.message} The latest data is now shown.` });
    }
    reload();
    onChanged();
  }

  if (error) return <Notice tone="error">{error.message}</Notice>;
  if (!detail) return null;
  const current = detail.versions.find((version) => version.isCurrent);
  const canRevise = actor.role === 'MANAGER' && detail.creator.id === actor.id;
  const canReview = actor.role === 'REVIEWER' && detail.status === 'PENDING' && detail.creator.id !== actor.id;

  return (
    <section className="panel stack" aria-labelledby="detail-heading">
      <div className="row">
        <h2 id="detail-heading">
          {detail.applicationId} · {detail.customerLabel}
        </h2>
        <StatusBadge status={detail.status} />
      </div>
      <RateSummary detail={detail} />
      {feedback && <Notice tone={feedback.tone}>{feedback.message}</Notice>}
      {canReview && current && (
        <ReviewControls
          key={detail.rowRevision}
          version={current}
          onDecide={(outcome, comment) =>
            runMutation(
              () =>
                api.decide(detail.id, current.versionNumber, {
                  expectedRevision: detail.rowRevision,
                  outcome,
                  comment,
                }),
              `Version ${current.versionNumber} ${outcome === 'APPROVED' ? 'approved' : 'declined'}.`,
            )
          }
        />
      )}
      {canRevise && current && (
        <details className="revise">
          <summary>Revise request</summary>
          <RequestForm
            key={detail.rowRevision}
            standardRateBps={detail.standardRateBps}
            initial={current}
            submitLabel="Submit revision"
            warning="A revision needs fresh approval. Any existing approval stops being usable immediately."
            onSubmit={(content) =>
              runMutation(
                () =>
                  api.reviseRequest(detail.id, {
                    ...content,
                    expectedVersion: detail.currentVersionNumber,
                    expectedRevision: detail.rowRevision,
                  }),
                'Revision submitted for review.',
              )
            }
          />
        </details>
      )}
      <VersionHistory versions={detail.versions} />
    </section>
  );
}
