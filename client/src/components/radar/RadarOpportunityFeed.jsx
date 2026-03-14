import { useEffect, useRef, useState } from 'react';
import { radarFetch, isLast24Hours } from '../../utils/radarFetch';

const POLL_MS = 60000;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatDate(value) {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '-';
  return dt.toLocaleString();
}

export default function RadarOpportunityFeed() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError('');

      try {
        const payload = await radarFetch('/api/system/opportunities');
        if (!active || requestId !== requestIdRef.current) return;

        const items = Array.isArray(payload?.items) ? payload.items : [];
        const filtered = items.filter((row) => isLast24Hours(row?.created_at));
        setRows(filtered);
      } catch (err) {
        if (!active || requestId !== requestIdRef.current) return;
        setRows([]);
        setError(err?.message || 'Failed to load opportunity feed');
      } finally {
        if (active && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    load();
    const timer = setInterval(load, POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
      requestIdRef.current += 1;
    };
  }, []);

  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="m-0 text-base font-semibold text-[var(--text-primary)]">Live Opportunity Feed</h3>
        <span className="text-xs text-[var(--text-muted)]">Scrollable · Last 24h</span>
      </div>

      {loading ? <div className="text-sm text-[var(--text-muted)]">Loading...</div> : null}
      {!loading && error ? <div className="text-sm text-red-300">{error}</div> : null}

      {!loading && !error ? (
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-[var(--border-color)]">
          <table className="min-w-full text-left text-xs sm:text-sm">
            <thead className="sticky top-0 bg-[var(--bg-secondary)]">
              <tr className="text-[var(--text-muted)]">
                <th className="px-2 py-2">symbol</th>
                <th className="px-2 py-2">event_type</th>
                <th className="px-2 py-2">score</th>
                <th className="px-2 py-2">source</th>
                <th className="px-2 py-2">created_at</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={`${row.symbol || 'row'}-${idx}`} className="border-t border-[var(--border-color)]">
                  <td className="px-2 py-2 font-semibold text-[var(--text-primary)]">{row.symbol || '-'}</td>
                  <td className="px-2 py-2 text-[var(--text-secondary)]">{row.event_type || '-'}</td>
                  <td className="px-2 py-2 text-[var(--text-secondary)]">{toNumber(row.score).toFixed(2)}</td>
                  <td className="px-2 py-2 text-[var(--text-secondary)]">{row.source || '-'}</td>
                  <td className="px-2 py-2 text-[var(--text-secondary)]">{formatDate(row.created_at)}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-[var(--text-muted)]" colSpan={5}>No opportunities in last 24h</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
