import { useEffect, useState } from 'react';

const REFRESH_MS = 60_000;

function getAuthHeaders() {
  const token = localStorage.getItem('openrange_token') || localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export default function StocksInPlayPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch('/api/stocks-in-play', {
          method: 'GET',
          headers: {
            ...getAuthHeaders(),
          },
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }

        const payload = await response.json();
        if (cancelled) return;

        setRows(Array.isArray(payload?.data) ? payload.data : []);
        setError('');
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'Unable to load Stocks In Play');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="rounded-xl border border-slate-700/70 bg-slate-900/75 p-4 shadow-[0_12px_40px_rgba(2,6,23,0.45)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold uppercase tracking-[0.14em] text-cyan-200">Stocks In Play</h3>
        {loading ? <span className="text-xs text-slate-400">Refreshing...</span> : null}
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950/55 px-3 py-2 text-sm text-slate-300">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
          Loading stocks in play...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700 text-left text-slate-300">
              <th className="px-2 py-2">Symbol</th>
              <th className="px-2 py-2">Strategy</th>
              <th className="px-2 py-2 text-right">Probability</th>
              <th className="px-2 py-2 text-right">RVOL</th>
              <th className="px-2 py-2">Catalysts</th>
              <th className="px-2 py-2 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.symbol || 'row'}-${index}`} className="border-b border-slate-800/70 text-slate-100">
                <td className="px-2 py-2 font-semibold uppercase">{row.symbol || '--'}</td>
                <td className="px-2 py-2">{row.strategy || row.class || '--'}</td>
                <td className="px-2 py-2 text-right">{toNumber(row.probability).toFixed(2)}</td>
                <td className="px-2 py-2 text-right">{toNumber(row.relative_volume).toFixed(2)}</td>
                <td className="px-2 py-2">{row.catalysts || '--'}</td>
                <td className="px-2 py-2 text-right">{toNumber(row.opportunity_score).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && !error && rows.length === 0 ? (
        <div className="mt-2 text-xs text-slate-400">No stocks in play currently meet the filter.</div>
      ) : null}
    </section>
  );
}
