import { useEffect, useRef, useState } from 'react';
import { radarFetch } from '../../utils/radarFetch';

const POLL_MS = 60000;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function extractExpectedMove(row) {
  const fromCatalyst = String(row.catalyst_context || '');
  const match = fromCatalyst.match(/(-?\d+(?:\.\d+)?)%/);
  if (match) return Number(match[1]);
  const fromNarrative = String(row.narrative || '').match(/Expected move:\s*(-?\d+(?:\.\d+)?)%/i);
  if (fromNarrative) return Number(fromNarrative[1]);
  return null;
}

export default function RadarTradeNarratives() {
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
        const payload = await radarFetch('/api/trade-narratives');
        if (!active || requestId !== requestIdRef.current) return;
        setRows(Array.isArray(payload?.data) ? payload.data.slice(0, 20) : []);
      } catch (err) {
        if (!active || requestId !== requestIdRef.current) return;
        setRows([]);
        setError(err?.message || 'Failed to load trade narratives');
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
        <h3 className="m-0 text-base font-semibold text-[var(--text-primary)]">Trade Narratives</h3>
        <span className="text-xs text-[var(--text-muted)]">Latest 20</span>
      </div>

      {loading ? <div className="text-sm text-[var(--text-muted)]">Loading...</div> : null}
      {!loading && error ? <div className="text-sm text-red-300">{error}</div> : null}

      {!loading && !error ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((row, idx) => {
            const probability = toNumber(row.beacon_probability);
            const expectedMove = extractExpectedMove(row);

            return (
              <article key={`${row.symbol || 'row'}-${idx}`} className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-base font-semibold text-slate-100">{row.symbol || '-'}</div>
                  <span className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-300">
                    {row.strategy || 'Unknown'}
                  </span>
                </div>

                <div className="mb-2 flex items-center gap-3 text-xs text-slate-300">
                  <span>Prob: {probability.toFixed(2)}</span>
                  <span>Expected: {expectedMove == null ? 'n/a' : `${expectedMove.toFixed(2)}%`}</span>
                </div>

                <p className="m-0 whitespace-pre-line text-sm leading-relaxed text-slate-300">
                  {row.narrative || 'Narrative unavailable.'}
                </p>
              </article>
            );
          })}

          {rows.length === 0 ? <div className="text-sm text-[var(--text-muted)]">No narratives available.</div> : null}
        </div>
      ) : null}
    </section>
  );
}
