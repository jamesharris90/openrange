import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import TradingViewChart from '../components/shared/TradingViewChart';
import { apiJSON } from '../config/api';
import TickerLink from '../components/shared/TickerLink';

function num(value, digits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '--';
  return parsed.toFixed(digits);
}

export default function TradeSetup() {
  const { symbol: symbolParam } = useParams();
  const symbol = String(symbolParam || '').toUpperCase();

  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const payload = await apiJSON(`/api/signals/${encodeURIComponent(symbol)}`);
        if (!cancelled) setRow(payload && typeof payload === 'object' ? payload : null);
      } catch (err) {
        if (!cancelled) {
          setRow(null);
          setError(err?.message || 'Failed to load trade setup');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (symbol) load();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title={`Trade Setup ${symbol ? `· ${symbol}` : ''}`}
          subtitle="Focused setup context for manual execution decisions."
        />
      </Card>

      {loading ? (
        <Card><LoadingSpinner message="Loading setup…" /></Card>
      ) : error ? (
        <Card><div className="muted">{error}</div></Card>
      ) : (
        <>
          <Card>
            <div className="grid gap-2 md:grid-cols-3 text-sm">
              <div className="rounded border border-[var(--border-color)] p-2"><span className="muted">Ticker</span><div><TickerLink symbol={symbol} /></div></div>
              <div className="rounded border border-[var(--border-color)] p-2"><span className="muted">Strategy</span><div>{row?.strategy || '--'}</div></div>
              <div className="rounded border border-[var(--border-color)] p-2"><span className="muted">Score</span><div>{num(row?.score, 1)}</div></div>
              <div className="rounded border border-[var(--border-color)] p-2"><span className="muted">Gap %</span><div>{num(row?.gap_percent, 2)}%</div></div>
              <div className="rounded border border-[var(--border-color)] p-2"><span className="muted">Relative Volume</span><div>{num(row?.relative_volume, 2)}</div></div>
              <div className="rounded border border-[var(--border-color)] p-2"><span className="muted">Float</span><div>{row?.float || '--'}</div></div>
              <div className="rounded border border-[var(--border-color)] p-2 md:col-span-2"><span className="muted">Catalyst</span><div>{row?.catalyst || '--'}</div></div>
              <div className="rounded border border-[var(--border-color)] p-2"><span className="muted">Key Levels</span><div>{Array.isArray(row?.levels) ? row.levels.join(', ') : '--'}</div></div>
            </div>
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Chart</h3>
            <TradingViewChart symbol={symbol} height={420} interval="15" hideSideToolbar />
          </Card>
        </>
      )}
    </PageContainer>
  );
}
