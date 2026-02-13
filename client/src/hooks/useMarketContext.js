import { useState, useEffect, useRef, useCallback } from 'react';

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export default function useMarketContext() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  const fetchContext = useCallback(async () => {
    try {
      const r = await fetch('/api/ai-quant/market-context');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContext();
    intervalRef.current = setInterval(fetchContext, REFRESH_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchContext]);

  return { data, loading, error, refresh: fetchContext };
}
