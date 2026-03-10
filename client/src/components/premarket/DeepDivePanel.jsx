import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '../../config/api';
import SparklineMini from '../charts/SparklineMini';

export default function DeepDivePanel({ selectedTicker }) {
  const [signal, setSignal] = useState(null);
  const [news, setNews] = useState([]);
  const [expectedMove, setExpectedMove] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!selectedTicker) return;
      try {
        const [sig, intel, em] = await Promise.all([
          apiJSON(`/api/signal/${encodeURIComponent(selectedTicker)}`).catch(() => null),
          apiJSON(`/api/intelligence/news?symbol=${encodeURIComponent(selectedTicker)}&hours=48`).catch(() => ({ items: [] })),
          apiJSON(`/api/metrics/expected-move?symbol=${encodeURIComponent(selectedTicker)}`).catch(() => null),
        ]);
        if (cancelled) return;
        setSignal(sig || null);
        setNews(Array.isArray(intel?.items) ? intel.items.slice(0, 3) : []);
        setExpectedMove(em || null);
      } catch {
        if (!cancelled) {
          setSignal(null);
          setNews([]);
          setExpectedMove(null);
        }
      }
    }
    run();
    return () => { cancelled = true; };
  }, [selectedTicker]);

  const tradePlan = useMemo(() => {
    const strategy = String(signal?.strategy || '').toLowerCase();
    if (strategy.includes('vwap')) return 'Buy reclaim above VWAP with RVOL confirmation; risk under reclaim candle.';
    return 'Wait for opening range break and hold, then scale on first pullback continuation.';
  }, [signal]);

  const price = Number(signal?.price || 0);

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <h3 className="m-0 mb-3 text-sm font-semibold">Deep Dive</h3>
      <div className="space-y-2 text-sm">
        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="text-xs text-[var(--text-muted)]">Ticker</div>
          <div className="font-semibold">{selectedTicker || '--'}</div>
          <div className="text-xs text-[var(--text-muted)]">Price {price ? price.toFixed(2) : '--'}</div>
        </div>

        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="text-xs text-[var(--text-muted)]">Catalyst</div>
          <div>{signal?.catalyst || news?.[0]?.headline || 'No catalyst available'}</div>
        </div>

        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="text-xs text-[var(--text-muted)]">Strategy</div>
          <div>{signal?.strategy || 'Momentum Continuation'}</div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-xs">
            <div className="text-[var(--text-muted)]">Expected Move</div>
            <div className="font-semibold">{expectedMove?.expected_move ? Number(expectedMove.expected_move).toFixed(2) : '--'}</div>
          </div>
          <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-xs">
            <div className="text-[var(--text-muted)]">IV / HV</div>
            <div className="font-semibold">{expectedMove?.iv != null ? Number(expectedMove.iv).toFixed(0) : '--'} / {expectedMove?.hv != null ? Number(expectedMove.hv).toFixed(0) : '--'}</div>
          </div>
        </div>

        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="text-xs text-[var(--text-muted)]">Mini Chart (5m)</div>
          <SparklineMini symbol={selectedTicker} width={260} height={70} positive={(Number(signal?.change_percent || 0) >= 0)} />
        </div>

        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-xs">
          <div className="text-[var(--text-muted)]">Trade Plan</div>
          <div>{tradePlan}</div>
        </div>
      </div>
    </div>
  );
}
