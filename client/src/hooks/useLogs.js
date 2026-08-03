import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';

const CACHE = new Map();

export function useLogs(serviceName, lines, search) {
  const [requestKey, setRequestKey] = useState(0);
  const [logs, setLogs] = useState(CACHE.get(serviceName) || { lines: [], total: 0, filtered: 0, requested: lines });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!serviceName) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams({ lines: String(lines) });
    if (search.trim()) qs.set('search', search.trim());

    api(`/services/${encodeURIComponent(serviceName)}/logs?${qs}`, { signal: controller.signal })
      .then((data) => {
        if (cancelled) return;
        setLogs(data);
        CACHE.set(serviceName, data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || err.code === 'TIMEOUT') {
          if (err.code === 'TIMEOUT' && !cancelled) setError(err);
          return;
        }
        if (err.name === 'AbortError') return;
        setError(err);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [serviceName, lines, search, requestKey]);

  const refresh = useCallback(() => setRequestKey((k) => k + 1), []);

  return { logs, loading, error, refresh };
}
