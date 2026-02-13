import useApi from './useApi';

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export default function useMarketContext() {
  const { data, loading, error, refetch } = useApi('/api/ai-quant/market-context', [], {
    pollMs: REFRESH_MS,
    pauseWhenHidden: true,
  });

  return { data, loading, error, refresh: refetch };
}
