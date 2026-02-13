import { useState, useEffect, useRef, useCallback } from 'react';

// Lightweight fetch hook with optional polling and visibility pause
// opts: { pollMs?: number, enabled?: boolean, pauseWhenHidden?: boolean, transform?: fn }
export default function useApi(url, deps = [], opts = {}) {
  const { pollMs, enabled = true, pauseWhenHidden = false, transform } = opts;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const pollRef = useRef(null);

  const runFetch = useCallback(() => {
    if (!url || !enabled) { setData(null); return; }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    fetch(url, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { const next = transform ? transform(d) : d; setData(next); setError(null); })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
  }, [url, enabled, transform]);

  useEffect(() => {
    runFetch();

    if (pollMs && enabled) {
      const start = () => {
        clearInterval(pollRef.current);
        pollRef.current = setInterval(() => {
          if (pauseWhenHidden && document.visibilityState === 'hidden') return;
          runFetch();
        }, pollMs);
      };

      start();

      let visHandler;
      if (pauseWhenHidden) {
        visHandler = () => {
          if (document.visibilityState === 'visible') {
            runFetch();
          }
        };
        document.addEventListener('visibilitychange', visHandler);
      }

      return () => {
        clearInterval(pollRef.current);
        if (visHandler) document.removeEventListener('visibilitychange', visHandler);
        abortRef.current?.abort();
      };
    }

    return () => {
      abortRef.current?.abort();
    };
  }, [runFetch, pollMs, enabled, pauseWhenHidden, ...deps]);

  return { data, loading, error, refetch: runFetch };
}
