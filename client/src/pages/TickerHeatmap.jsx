import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';

const LOGO_KEY = import.meta.env.VITE_LOGO_DEV_KEY;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function TickerHeatmap() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const payload = await apiJSON('/api/market/sector-strength');
        const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
        const next = sectors.flatMap((sector) => {
          const tickers = Array.isArray(sector?.tickers) ? sector.tickers : [];
          return tickers.map((ticker) => ({
            symbol: String(ticker?.symbol || '').toUpperCase(),
            change_percent: toNumber(ticker?.price_change ?? ticker?.change_percent),
            rvol: toNumber(ticker?.relative_volume ?? ticker?.rvol),
          }));
        });

        if (!cancelled) setRows(next.slice(0, 120));
      } catch {
        if (!cancelled) setRows([]);
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
        ) : !rows.length ? (
          <div className="muted">No ticker heatmap data available.</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {rows.map((ticker) => (
              <div key={ticker.symbol} className="ticker-tile rounded border border-[var(--border-color)] bg-[var(--bg-card)]">
                <img
                  src={`https://img.logo.dev/${ticker.symbol}?token=${LOGO_KEY}`}
                  className="w-6 h-6 mb-1"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  alt=""
                />

                <div className="ticker-symbol">{ticker.symbol}</div>

                <div className="ticker-change">
                  {toNumber(ticker.change_percent).toFixed(2)}%
                </div>

                <div className="ticker-rvol">
                  RVOL {toNumber(ticker.rvol).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
