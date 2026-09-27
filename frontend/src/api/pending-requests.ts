import { useSyncExternalStore } from 'react';

// ponytail: one app-wide counter; per-request progress is not needed for this UI.
let pendingCount = 0;
const listeners = new Set<() => void>();

function changePending(delta: number): void {
  pendingCount += delta;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Counts a server call as pending until it settles, whatever the outcome. */
export async function trackPending<T>(request: Promise<T>): Promise<T> {
  changePending(1);
  try {
    return await request;
  } finally {
    changePending(-1);
  }
}

export function useIsServerBusy(): boolean {
  return useSyncExternalStore(subscribe, () => pendingCount > 0);
}
