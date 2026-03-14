import { useEffect, useMemo, useRef, useState } from 'react';
import { radarFetch } from '../../utils/radarFetch';

const POLL_MS = 60000;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatPct(value) {
  const n = toNumber(value);
  return `${Math.max(0, Math.min(100, n)).toFixed(1)}%`;
}

function formatMove(value) {
  const n = toNumber(value);
  return `${n.toFixed(2)}%`;
}

function strategyTone(strategy) {
  const key = String(strategy || '').toLowerCase();
  if (key.includes('continuation')) return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (key.includes('breakout')) return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300';
  if (key.includes('reclaim')) return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  if (key.includes('squeeze')) return 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300';
  return 'border-slate-500/40 bg-slate-500/10 text-slate-300';
}

function cardAccent(probability) {
  const n = toNumber(probability);
  if (n >= 80) return 'ring-emerald-500/30';
  if (n >= 65) return 'ring-cyan-500/30';
  if (n >= 50) return 'ring-amber-500/30';
  return 'ring-slate-500/30';
}

export default function RadarBeaconPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pulse, setPulse] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError('');

      try {
        const payload = await radarFetch('/api/beacon-signals');
        if (!active || requestId !== requestIdRef.current) return;

        const list = Array.isArray(payload?.data) ? payload.data.slice(0, 10) : [];
        setRows(list);
        setPulse(true);
        setTimeout(() => setPulse(false), 500);
      } catch (err) {
        if (!active || requestId !== requestIdRef.current) return;
        setRows([]);
        setError(err?.message || 'Failed to load Beacon signals');
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

  const refreshedAt = useMemo(() => new Date().toLocaleTimeString(), [rows]);

  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="m-0 text-base font-semibold text-[var(--text-primary)]">Beacon Signals</h3>
          <p className="m-0 mt-1 text-xs text-[var(--text-muted)]">Top 10 AI-ranked setups</p>
        </div>
        <div className={`text-xs text-[var(--text-muted)] ${pulse ? 'animate-pulse' : ''}`}>Refreshed {refreshedAt}</div>
      </div>

      {loading ? <div className="text-sm text-[var(--text-muted)]">Loading...</div> : null}
      {!loading && error ? <div className="text-sm text-red-300">{error}</div> : null}

      {!loading && !error ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          {rows.map((row, idx) => {
            const probability = toNumber(row.beacon_probability);
            const expectedMove = toNumber(row.expected_move);
            const moveBar = Math.max(0, Math.min(100, Math.abs(expectedMove) * 8));
            const tone = strategyTone(row.strategy);

            return (
              <article
                key={`${row.symbol || 'row'}-${idx}`}
                className={`rounded-lg border border-slate-700/70 bg-slate-900/60 p-3 ring-1 transition ${cardAccent(probability)}`}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <div className="text-base font-semibold text-slate-100">{row.symbol || '-'}</div>
                    <div className={`inline-flex rounded border px-2 py-0.5 text-[11px] ${tone}`}>
                      {row.strategy || 'Unknown Strategy'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Probability</div>
                    <div className="text-sm font-semibold text-emerald-300">{formatPct(probability)}</div>
                  </div>
                </div>

                <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-emerald-400 to-emerald-300 transition-all duration-500"
                    style={{ width: `${Math.max(0, Math.min(100, probability))}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Expected Move</span>
                  <span className={expectedMove >= 0 ? 'text-emerald-300' : 'text-red-300'}>{formatMove(expectedMove)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${expectedMove >= 0 ? 'bg-emerald-400' : 'bg-red-400'}`}
                    style={{ width: `${moveBar}%` }}
                  />
                </div>
              </article>
            );
          })}

          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
              No Beacon signals available.
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
