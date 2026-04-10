import { useEffect, useRef, useState } from 'react';
import { radarFetch } from '../../utils/radarFetch';
import { ExpectedMoveRange } from '../terminal/SignalVisuals';

const POLL_MS = 60000;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function Sparkline({ row }) {
  const base = toNumber(row?.price || 10);
  const move = toNumber(row?.expected_move || row?.expected_move_percent || 0);
  const rv = toNumber(row?.relative_volume || row?.rvol || 1);
  const points = [
    base * 0.98,
    base * (1 + move / 400),
    base * (1 + move / 250),
    base * (1 + move / 200 + rv / 100),
    base * (1 + move / 220),
  ];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const normalized = points.map((v, idx) => {
    const x = (idx / (points.length - 1)) * 100;
    const y = max === min ? 50 : ((max - v) / (max - min)) * 100;
    return `${x},${y}`;
  }).join(' ');
  const up = move >= 0;

  return (
    <svg viewBox="0 0 100 100" className="h-8 w-20">
      <polyline fill="none" stroke={up ? '#34d399' : '#f87171'} strokeWidth="7" points={normalized} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
        <div className="space-y-2">
          {rows.map((row, idx) => {
            const confidence = toNumber(row?.probability ?? row?.confidence ?? row?.score, 0);
            const rvol = toNumber(row?.relative_volume ?? row?.rvol, 0);
            const expected = toNumber(row?.expected_move ?? row?.expected_move_percent, 0);
            const priceNum = Number(row?.price);
            const hasPrice = Number.isFinite(priceNum);
            const dotClass = confidence >= 0.7 ? 'bg-emerald-400' : confidence >= 0.45 ? 'bg-amber-400' : 'bg-rose-400';
            return (
              <article key={`${row.symbol || 'row'}-${idx}`} className="grid grid-cols-12 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-xs">
                <div className="col-span-2 font-semibold text-[var(--text-primary)]">{row.symbol || '--'}</div>
                <div className="col-span-3"><Sparkline row={row} /></div>
                <div className="col-span-1"><span className={`inline-block h-2.5 w-2.5 rounded-full ${dotClass}`} /></div>
                <div className="col-span-2">
                  <span className="rounded border border-cyan-500/30 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
                    {row.strategy || 'setup'}
                  </span>
                </div>
                <div className="col-span-3">
                  <ExpectedMoveRange
                    low={hasPrice ? priceNum - Math.abs(expected) : null}
                    high={hasPrice ? priceNum + Math.abs(expected) : null}
                    current={hasPrice ? priceNum : null}
                  />
                </div>
                <div className="col-span-1 text-right text-[var(--text-secondary)]">{rvol.toFixed(2)}x</div>
              </article>
            );
          })}
          {rows.length === 0 ? <div className="px-2 py-3 text-xs text-[var(--text-muted)]">No qualifying setups right now</div> : null}
        </div>
      ) : null}
    </section>
  );
}
