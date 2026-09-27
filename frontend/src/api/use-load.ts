import { useCallback, useEffect, useState } from 'react';

interface LoadResult<T> {
  data: T | null;
  error: Error | null;
}

/**
 * Loads on mount, whenever `load` changes and on reload(). Previous data stays visible while
 * reloading, and responses from superseded loads are ignored. Loading feedback is app-wide (ServerActivity).
 */
export function useLoad<T>(load: () => Promise<T>) {
  const [reloadCount, setReloadCount] = useState(0);
  const [result, setResult] = useState<LoadResult<T>>({ data: null, error: null });

  useEffect(() => {
    let isCurrent = true;
    load().then(
      (data) => isCurrent && setResult({ data, error: null }),
      (error: Error) => isCurrent && setResult({ data: null, error }),
    );
    return () => {
      isCurrent = false;
    };
  }, [load, reloadCount]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);
  return { ...result, reload };
}
