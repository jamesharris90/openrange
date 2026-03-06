import { useEffect, useMemo, useState } from 'react';
import Card from '../shared/Card';
import LoadingSpinner from '../shared/LoadingSpinner';
import { apiJSON } from '../../config/api';

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.signals)) return payload.signals;
  return [];
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function RadarStockDeepDive({ symbol }) {
  const [loading, setLoading] = useState(false);
  const [signal, setSignal] = useState(null);
  const [news, setNews] = useState([]);
  const [expectedMove, setExpectedMove] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!symbol) return;
      setLoading(true);
      try {
        const [signalsPayload, newsPayload, expectedPayload] = await Promise.all([
          apiJSON(`/api/signals?symbol=${encodeURIComponent(symbol)}`),
          apiJSON(`/api/intelligence/news?symbol=${encodeURIComponent(symbol)}`),
          apiJSON(`/api/expected-move?symbol=${encodeURIComponent(symbol)}`),
        ]);

        if (cancelled) return;

        const signalRows = rows(signalsPayload).filter((row) => String(row?.symbol || '').toUpperCase() === symbol);
        const newsRows = rows(newsPayload).filter((row) => String(row?.symbol || '').toUpperCase() === symbol);
        const move = expectedPayload?.data?.[0] || expectedPayload?.data || expectedPayload || null;

        setSignal(signalRows[0] || null);
        setNews(newsRows.slice(0, 3));
        setExpectedMove(move && typeof move === 'object' ? move : null);
      } catch {
        if (!cancelled) {
          setSignal(null);
          setNews([]);
          setExpectedMove(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const tradePlan = useMemo(() => {
    const price = num(signal?.price || expectedMove?.price, 0);
    const move = num(expectedMove?.expected_move || 0, 0);
    const entry = price > 0 ? price.toFixed(2) : '--';
    const invalidation = price > 0 && move > 0 ? (price - move * 0.5).toFixed(2) : '--';
    const target = price > 0 && move > 0 ? (price + move).toFixed(2) : '--';
    return { entry, invalidation, target };
  }, [signal, expectedMove]);

  return (
    <Card>
      <h3 className="m-0">Stock Deep Dive</h3>
      <div className="mt-1 text-sm muted">{symbol || 'Select a ticker'}</div>

      {loading ? <div className="mt-3"><LoadingSpinner message={`Loading ${symbol} intelligence...`} /></div> : null}

      {!loading ? (
        <div className="mt-3 space-y-3 text-sm">
          <div className="rounded p-2" style={{ background: 'var(--bg-elevated)' }}>
            <div className="text-xs muted">Ticker Header</div>
            <div className="font-semibold">{symbol || '--'}</div>
            <div>Price change: {num(signal?.change_percent || signal?.gap_percent, 0).toFixed(2)}%</div>
          </div>

          <div className="rounded p-2" style={{ background: 'var(--bg-elevated)' }}>
            <div className="text-xs muted">Catalyst Summary</div>
            <div>{news[0]?.headline || 'No current catalyst summary.'}</div>
          </div>

          <div className="rounded p-2" style={{ background: 'var(--bg-elevated)' }}>
            <div className="text-xs muted">Strategy Explanation</div>
            <div>{signal?.strategy || signal?.class || 'No active strategy signal.'}</div>
          </div>

          <div className="rounded p-2" style={{ background: 'var(--bg-elevated)' }}>
            <div className="text-xs muted">Trade Plan</div>
            <div>Entry: {tradePlan.entry}</div>
            <div>Invalidation: {tradePlan.invalidation}</div>
            <div>Target: {tradePlan.target}</div>
          </div>

          <div className="rounded p-2" style={{ background: 'var(--bg-elevated)' }}>
            <div className="text-xs muted">When I Am Wrong</div>
            <div>If price breaks VWAP support and fails reclaim on rising volume.</div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
