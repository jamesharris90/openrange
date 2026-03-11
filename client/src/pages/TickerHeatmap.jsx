import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { authFetch } from '../utils/api';
import TickerHeatmapRenderer from '../components/TickerHeatmap';

export default function TickerHeatmap() {
  const [loading, setLoading] = useState(true);
  const [marketData, setMarketData] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await authFetch('/api/market/context');
        const json = await res.json();

        if (!json || typeof json !== 'object') {
          if (!cancelled) setMarketData([]);
          return;
        }

        const tickers = Array.isArray(json?.tickers)
          ? json.tickers
          : Object.values(json || {})?.map((row) => ({
              symbol: row?.symbol || '?',
              change: Number(row?.change ?? row?.change_percent ?? 0),
              rvol: Number(row?.rvol ?? row?.relative_volume ?? 0),
              marketCap: Number(row?.marketCap ?? row?.market_cap ?? row?.volume ?? 0),
            }));

        if (!cancelled) setMarketData(tickers.slice(0, 180));
      } catch {
        if (!cancelled) setMarketData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Ticker Heatmap"
          subtitle="Logo-enhanced ticker tiles with change and relative volume."
        />
      </Card>

      <Card>
        {loading ? (
          <LoadingSpinner message="Loading ticker heatmap..." />
        ) : !marketData.length ? (
          <div className="empty-state">Market data loading...</div>
        ) : (
          <TickerHeatmapRenderer
            tickers={marketData?.map((ticker) => ({
              symbol: ticker?.symbol || '?',
              change: ticker?.change || 0,
              rvol: ticker?.rvol || 0,
              size: ticker?.marketCap || ticker?.volume || 0,
            }))}
          />
        )}
      </Card>
    </PageContainer>
  );
}
