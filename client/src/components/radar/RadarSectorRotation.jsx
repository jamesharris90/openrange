import { useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { radarFetch } from '../../utils/radarFetch';

const POLL_MS = 60000;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export default function RadarSectorRotation() {
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
        const payload = await radarFetch('/api/sector-rotation');
        if (!active || requestId !== requestIdRef.current) return;
        setRows(Array.isArray(payload?.data) ? payload.data.slice(0, 10) : []);
      } catch (err) {
        if (!active || requestId !== requestIdRef.current) return;
        setRows([]);
        setError(err?.message || 'Failed to load sector rotation');
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
      <div className="mb-3 flex items-center justify-between">
        <h3 className="m-0 text-base font-semibold text-[var(--text-primary)]">Sector Rotation</h3>
        <span className="text-xs text-[var(--text-muted)]">Top momentum sectors</span>
      </div>

      {loading ? <div className="text-sm text-[var(--text-muted)]">Loading...</div> : null}
      {!loading && error ? <div className="text-sm text-red-300">{error}</div> : null}

      {!loading && !error ? (
        <div className="space-y-2">
          {rows.map((row, idx) => {
            const momentum = toNumber(row.momentum_score);
            const avgChange = toNumber(row.avg_change_percent);
            const avgRvol = toNumber(row.avg_relative_volume);
            const width = Math.max(6, Math.min(100, Math.abs(momentum) * 10));
            const isUp = momentum >= 0;

            return (
              <div key={`${row.sector || 'sector'}-${idx}`} className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <div className="inline-flex items-center gap-2">
                    <span className="inline-flex min-w-5 items-center justify-center rounded border border-slate-600 px-1 text-[10px] text-slate-300">
                      #{toNumber(row.rank, idx + 1)}
                    </span>
                    <span className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-100">
                      {row.sector || 'Unknown'}
                    </span>
                  </div>
                  <div className={`inline-flex items-center gap-1 text-xs font-semibold ${isUp ? 'text-emerald-300' : 'text-red-300'}`}>
                    {isUp ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                    {momentum.toFixed(2)}
                  </div>
                </div>

                <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${isUp ? 'bg-emerald-400' : 'bg-red-400'}`}
                    style={{ width: `${width}%` }}
                  />
                </div>

                <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Avg Change: {avgChange.toFixed(2)}%</span>
                  <span>Avg RVOL: {avgRvol.toFixed(2)}</span>
                </div>
              </div>
            );
          })}

          {rows.length === 0 ? <div className="text-sm text-[var(--text-muted)]">No sector data available.</div> : null}
        </div>
      ) : null}
    </section>
  );
}
