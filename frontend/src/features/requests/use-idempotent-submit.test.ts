import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { useIdempotentSubmit } from './use-idempotent-submit';

const networkError = new ApiError(0, 'NETWORK_ERROR', 'offline');

describe('useIdempotentSubmit', () => {
  it('reuses the key when the same payload is retried after an unknown outcome', async () => {
    const { result } = renderHook(() => useIdempotentSubmit());
    const submit = vi.fn().mockRejectedValueOnce(networkError).mockResolvedValueOnce('created');

    await expect(result.current({ discountBps: 25 }, submit)).rejects.toBe(networkError);
    await expect(result.current({ discountBps: 25 }, submit)).resolves.toBe('created');
    expect(submit.mock.calls[0][0]).toBe(submit.mock.calls[1][0]);
  });

  it('uses a new key when the payload changes after an unknown outcome', async () => {
    const { result } = renderHook(() => useIdempotentSubmit());
    const submit = vi.fn().mockRejectedValueOnce(networkError).mockResolvedValueOnce('created');

    await expect(result.current({ discountBps: 25 }, submit)).rejects.toBe(networkError);
    await result.current({ discountBps: 30 }, submit);
    expect(submit.mock.calls[0][0]).not.toBe(submit.mock.calls[1][0]);
  });

  it('uses a new key after a definitive server response', async () => {
    const { result } = renderHook(() => useIdempotentSubmit());
    const conflict = new ApiError(409, 'REQUEST_EXISTS', 'exists');
    const submit = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce('created');

    await expect(result.current({ discountBps: 25 }, submit)).rejects.toBe(conflict);
    await result.current({ discountBps: 25 }, submit);
    expect(submit.mock.calls[0][0]).not.toBe(submit.mock.calls[1][0]);
  });
});
