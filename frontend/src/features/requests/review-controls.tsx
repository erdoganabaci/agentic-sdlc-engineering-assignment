import { useState } from 'react';
import type { DecisionOutcome, RequestVersion } from '../../api/types';
import { Notice } from '../../components/notice';

interface ReviewControlsProps {
  version: RequestVersion;
  onDecide: (outcome: DecisionOutcome, comment: string) => Promise<void>;
}

/** Decides exactly the displayed version; the caller passes the revision it was loaded with. */
export function ReviewControls({ version, onDecide }: ReviewControlsProps) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function decide(outcome: DecisionOutcome) {
    if (outcome === 'DECLINED' && comment.trim().length === 0) {
      setError('A comment is required to decline.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onDecide(outcome, comment);
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : 'Something went wrong.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="stack review" aria-labelledby="review-heading">
      <h3 id="review-heading">Review version {version.versionNumber}</h3>
      <p>
        Requested discount: <strong>{version.discountBps} bps</strong>
        <br />
        Reason: {version.reason}
      </p>
      <label className="field">
        Decision comment (required to decline)
        <textarea rows={2} maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="row">
        <button type="button" className="button-primary" disabled={isSubmitting} onClick={() => decide('APPROVED')}>
          Approve {version.discountBps} bps
        </button>
        <button type="button" className="button-danger" disabled={isSubmitting} onClick={() => decide('DECLINED')}>
          Decline
        </button>
      </div>
    </section>
  );
}
