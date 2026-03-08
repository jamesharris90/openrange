import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';
import { authFetch } from '../utils/api';
import ScrollingTicker from '../components/market/ScrollingTicker';
import SectorMarketHeatmap from '../components/market/SectorMarketHeatmap';
import TickerHeatmap from '../components/TickerHeatmap';
import TickerLink from '../components/shared/TickerLink';

function fmt(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(digits);
}

export default function SectorHeatmap() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [marketData, setMarketData] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const payload = await apiJSON('/api/market/sector-strength');
        const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
        if (!cancelled) setRows(sectors);
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

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      try {
        const res = await authFetch('/api/market/context');
        const json = await res.json();

        if (!json || typeof json !== 'object') {
          console.warn('Market context returned empty dataset');
          if (!cancelled) setMarketData([]);
          return;
        }

        const tickers = Array.isArray(json?.tickers)
          ? json.tickers
          : Object.values(json || {}).map((row) => ({
              symbol: row?.symbol || '?',
              change: Number(row?.change ?? row?.change_percent ?? 0),
              rvol: Number(row?.rvol ?? row?.relative_volume ?? 0),
              marketCap: Number(row?.marketCap ?? row?.market_cap ?? row?.volume ?? 0),
            }));

        if (!cancelled) setMarketData(Array.isArray(tickers) ? tickers : []);
      } catch (err) {
        console.error('Failed to load market context', err);
        if (!cancelled) setMarketData([]);
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Sector Heatmap"
          subtitle="Live sector strength and top leaders from the sector engine."
        />
      </Card>

      <ScrollingTicker />

      <Card>
        <h3 className="m-0 mb-3">Institutional Sector Heatmap</h3>
        <SectorMarketHeatmap sectors={rows} />
      </Card>

      <Card>
        <h3 className="m-0 mb-3">Ticker Heatmap</h3>
        {marketData.length > 0 ? (
          <TickerHeatmap tickers={marketData} />
        ) : (
          <div className="empty-state">Market data loading...</div>
        )}
      </Card>

      <Card>
        {loading ? (
          <LoadingSpinner message="Loading sectors…" />
        ) : rows.length === 0 ? (
          <div className="muted">No sector heatmap data available.</div>
        ) : (
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Sector</th>
                <th style={{ textAlign: 'right' }}>Price Change %</th>
                <th style={{ textAlign: 'right' }}>RVOL</th>
                <th style={{ textAlign: 'right' }}>Volume</th>
                <th>Leaders</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const leaders = Array.isArray(row?.tickers) ? row.tickers.slice(0, 3) : [];
                return (
                  <tr key={row?.sector || 'unknown'}>
                    <td>{row?.sector || 'Unknown'}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(row?.price_change, 2)}%</td>
                    <td style={{ textAlign: 'right' }}>{fmt(row?.relative_volume, 2)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row?.volume || 0).toLocaleString()}</td>
                    <td>
                      {leaders.length ? (
                        <div className="flex flex-wrap gap-1">
                          {leaders.map((item) => (
                            <span key={`${row?.sector || 's'}-${item?.symbol || 'x'}`}>
                              <TickerLink symbol={item?.symbol} /> ({fmt(item?.change_percent, 2)}%)
                            </span>
                          ))}
                        </div>
                      ) : '--'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </PageContainer>
  );
}
