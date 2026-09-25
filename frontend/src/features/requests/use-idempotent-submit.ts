import { useCallback, useRef } from 'react';
import { ApiError } from '../../api/client';

/**
 * One idempotency key per intended creation: reused only when the same payload is retried after an
 * unknown (network) outcome; any definitive response or payload change starts a fresh key.
 */
export function useIdempotentSubmit() {
  const pendingAttempt = useRef<{ payload: string; key: string } | null>(null);

  return useCallback(async <T>(payload: object, submit: (idempotencyKey: string) => Promise<T>): Promise<T> => {
    const serialized = JSON.stringify(payload);
    if (pendingAttempt.current?.payload !== serialized) {
      pendingAttempt.current = { payload: serialized, key: crypto.randomUUID() };
    }
    const attempt = pendingAttempt.current;
    try {
      const result = await submit(attempt.key);
      pendingAttempt.current = null;
      return result;
    } catch (error) {
      const isOutcomeUnknown = error instanceof ApiError && error.status === 0;
      if (!isOutcomeUnknown) pendingAttempt.current = null;
      throw error;
    }
  }, []);
}
