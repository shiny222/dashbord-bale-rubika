import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

// Polls an endpoint every `intervalMs` (default 5s), skipping ticks
// while the tab is hidden, and refreshes immediately when the tab
// becomes visible again. Exposes a manual refresh.
export function usePoll(fetcher, intervalMs = 5000, enabled = true) {
  const [data, setData] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [error, setError] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const tick = () => {
      if (!document.hidden) refresh();
    };
    tick();
    const id = setInterval(tick, intervalMs);
    const onVisibility = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled, refresh]);

  return { data, updatedAt, error, refresh, loading: data === null && !error };
}
