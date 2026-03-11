import { useEffect, useMemo, useState } from 'react';
import Card from '../ui/Card';
import SkeletonTable from '../ui/SkeletonTable';
import TickerLink from '../shared/TickerLink';
import { authFetch } from '../../utils/api';

function fmt(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(digits);
}

function normalizeSignals(payload, symbol) {
  const rows = Array.isArray(payload?.signals) ? payload.signals : Array.isArray(payload) ? payload : [];
  const upper = String(symbol || '').toUpperCase();
  return rows
    .filter((row) => !upper || String(row?.symbol || '').toUpperCase() === upper)
    .slice(0, 8);
}

function normalizeNews(payload, symbol) {
  const rows = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.feed) ? payload.feed : Array.isArray(payload) ? payload : [];
  const upper = String(symbol || '').toUpperCase();
  return rows
    .filter((row) => !upper || String(row?.symbol || row?.ticker || '').toUpperCase() === upper)
    .slice(0, 8);
}

export default function ChartSignalsNewsPanel({ symbol }) {
  const [loading, setLoading] = useState(true);
  const [signals, setSignals] = useState([]);
  const [news, setNews] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [signalsRes, feedRes] = await Promise.all([
          authFetch('/api/signals'),
          authFetch('/api/intelligence/feed'),
        ]);

        const signalsPayload = signalsRes.ok ? await signalsRes.json() : [];
        const feedPayload = feedRes.ok ? await feedRes.json() : [];

        if (cancelled) return;
        setSignals(normalizeSignals(signalsPayload, symbol));
        setNews(normalizeNews(feedPayload, symbol));
      } catch {
        if (!cancelled) {
          setSignals([]);
          setNews([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 45000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbol]);

  const hasRows = useMemo(() => signals.length > 0 || news.length > 0, [signals, news]);

  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <Card>
        <h3 className="mb-2 mt-0 text-sm font-semibold">Signals</h3>
        {loading ? <SkeletonTable rows={4} cols={4} /> : (
          signals.length === 0 ? <div className="text-xs text-[var(--text-muted)]">No signals available.</div> :
            <div className="overflow-x-auto">
              <table className="data-table data-table--compact min-w-[460px]">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Strategy</th>
                    <th style={{ textAlign: 'right' }}>Score</th>
                    <th style={{ textAlign: 'right' }}>Gap %</th>
                  </tr>
                </thead>
                <tbody>
                  {signals?.map((row, idx) => (
                    <tr key={`${row?.symbol || 's'}-${idx}`}>
                      <td><TickerLink symbol={row?.symbol} /></td>
                      <td>{row?.strategy || row?.setup_type || '--'}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(row?.score, 1)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(row?.gap_percent, 2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-2 mt-0 text-sm font-semibold">News</h3>
        {loading ? <SkeletonTable rows={4} cols={2} /> : (
          news.length === 0 ? <div className="text-xs text-[var(--text-muted)]">No intelligence feed available.</div> :
            <div className="space-y-2">
              {news?.map((row, idx) => (
                <a
                  key={`${row?.url || 'n'}-${idx}`}
                  href={row?.url || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded border border-[var(--border-default)] p-2 hover:bg-[var(--bg-elevated)]"
                >
                  <div className="flex items-center justify-between text-xs">
                    <TickerLink symbol={row?.symbol || row?.ticker || symbol} />
                    <span className="text-[var(--text-muted)]">{row?.source || 'news'}</span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-primary)]">{row?.headline || row?.title || '--'}</div>
                </a>
              ))}
            </div>
        )}
      </Card>

      {!loading && !hasRows ? (
        <Card className="lg:col-span-2">
          <div className="text-xs text-[var(--text-muted)]">No signal/news records found for this symbol.</div>
        </Card>
      ) : null}
    </div>
  );
}
