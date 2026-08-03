import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

// Polls an endpoint every `intervalMs` (default 5s). Never starts a new
// request while the previous one is still in flight (no overlapping
// refreshes), pauses while the tab is hidden, refreshes immediately when
// it becomes visible, aborts in-flight requests on unmount, and recovers
// cleanly after temporary failures.
export function usePoll(fetcher, intervalMs = 5000, enabled = true) {
  const [data, setData] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [error, setError] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const inFlightRef = useRef(false);
  const controllerRef = useRef(null);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return; // never overlap
    inFlightRef.current = true;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await fetcherRef.current({ signal: controller.signal });
      setData(result);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err);
    } finally {
      inFlightRef.current = false;
      if (controllerRef.current === controller) controllerRef.current = null;
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
      controllerRef.current?.abort();
      inFlightRef.current = false;
    };
  }, [intervalMs, enabled, refresh]);

  return { data, updatedAt, error, refresh, loading: data === null && !error };
}
