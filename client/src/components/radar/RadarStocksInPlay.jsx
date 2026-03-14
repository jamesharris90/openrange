import { useEffect, useRef, useState } from 'react';
import { radarFetch } from '../../utils/radarFetch';

const POLL_MS = 60000;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function RadarStocksInPlay() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    let timer = null;

    const load = async () => {
      const requestId = ++requestIdRef.current;
      const controller = new AbortController();
      setLoading(true);
      setError('');

      try {
        const payload = await radarFetch('/api/stocks-in-play');

        if (!active || requestId !== requestIdRef.current) return;

        const list = Array.isArray(payload?.data) ? payload.data : [];
        setRows(list.slice(0, 10));
      } catch (err) {
        if (!active || requestId !== requestIdRef.current) return;
        setRows([]);
        setError(err?.message || 'Failed to load stocks in play');
      } finally {
        if (active && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }

      return () => controller.abort();
    };

    load();
    timer = setInterval(load, POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
      requestIdRef.current += 1;
    };
  }, []);

  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="m-0 text-base font-semibold text-[var(--text-primary)]">Stocks In Play</h3>
        <span className="text-xs text-[var(--text-muted)]">Top 10</span>
      </div>

      {loading ? <div className="text-sm text-[var(--text-muted)]">Loading...</div> : null}
      {!loading && error ? <div className="text-sm text-red-300">{error}</div> : null}

      {!loading && !error ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="text-[var(--text-muted)]">
                <th className="px-2 py-2">symbol</th>
                <th className="px-2 py-2">strategy</th>
                <th className="px-2 py-2">probability</th>
                <th className="px-2 py-2">relative_volume</th>
                <th className="px-2 py-2">opportunity_score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={`${row.symbol || 'row'}-${idx}`} className="border-t border-[var(--border-color)]">
                  <td className="px-2 py-2 font-semibold text-[var(--text-primary)]">{row.symbol || '-'}</td>
                  <td className="px-2 py-2 text-[var(--text-secondary)]">{row.strategy || '-'}</td>
                  <td className="px-2 py-2 text-[var(--text-secondary)]">{toNumber(row.probability).toFixed(2)}</td>
                  <td className="px-2 py-2 text-[var(--text-secondary)]">{toNumber(row.relative_volume).toFixed(2)}</td>
                  <td className="px-2 py-2 text-[var(--text-secondary)]">{toNumber(row.opportunity_score).toFixed(3)}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-[var(--text-muted)]" colSpan={5}>No stocks in play</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
