import { useState, type FormEvent, type ReactNode } from 'react';
import type { VersionContent } from '../../api/types';
import { Notice } from '../../components/notice';
import { formatRate } from './rates';

const MAX_REASON_LENGTH = 1000;

interface RequestFormProps {
  standardRateBps: number;
  initial?: VersionContent;
  submitLabel: string;
  /** Extra fields rendered above the discount, e.g. the application picker. */
  children?: ReactNode;
  warning?: string;
  onSubmit: (content: VersionContent) => Promise<void>;
}

/** Shared by create and revise: discount, reason, rate preview and submit handling. */
export function RequestForm({ standardRateBps, initial, submitLabel, children, warning, onSubmit }: RequestFormProps) {
  const [discount, setDiscount] = useState(initial ? String(initial.discountBps) : '');
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const discountBps = Number(discount);
  const hasValidDiscount = Number.isInteger(discountBps) && discountBps > 0 && discountBps < standardRateBps;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length === 0) {
      setError('Enter a reason.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({ discountBps, reason });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Something went wrong.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      {children}
      {warning && <Notice tone="warning">{warning}</Notice>}
      <label className="field">
        Discount (basis points)
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={standardRateBps - 1}
          step={1}
          required
          value={discount}
          onChange={(event) => setDiscount(event.target.value)}
          aria-describedby="rate-preview"
        />
      </label>
      <p id="rate-preview" className="muted">
        Standard rate {formatRate(standardRateBps)}
        {hasValidDiscount
          ? ` − ${formatRate(discountBps)} = ${formatRate(standardRateBps - discountBps)} resulting rate`
          : ` · enter a whole number from 1 to ${standardRateBps - 1}`}
      </p>
      <label className="field">
        Reason
        <textarea
          required
          maxLength={MAX_REASON_LENGTH}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div>
        <button type="submit" className="button-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
