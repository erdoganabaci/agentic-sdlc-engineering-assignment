import { useCallback, useEffect, useMemo, useState } from 'react';

interface LoadResult<T> {
  data: T | null;
  error: Error | null;
  source: object | null;
}

/**
 * Loads on mount, whenever `load` changes and on reload(). Previous data stays visible while
 * reloading, and responses from superseded loads are ignored.
 */
export function useLoad<T>(load: () => Promise<T>) {
  const [reloadCount, setReloadCount] = useState(0);
  const [result, setResult] = useState<LoadResult<T>>({ data: null, error: null, source: null });
  const currentLoad = useMemo(() => ({ load, reloadCount }), [load, reloadCount]);

  useEffect(() => {
    let isCurrent = true;
    currentLoad.load().then(
      (data) => isCurrent && setResult({ data, error: null, source: currentLoad }),
      (error: Error) => isCurrent && setResult({ data: null, error, source: currentLoad }),
    );
    return () => {
      isCurrent = false;
    };
  }, [currentLoad]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);
  return { data: result.data, error: result.error, isLoading: result.source !== currentLoad, reload };
}
