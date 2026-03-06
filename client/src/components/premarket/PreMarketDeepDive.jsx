import { useEffect, useMemo, useState } from 'react';
import Card from '../shared/Card';
import { apiJSON } from '../../config/api';
import LoadingSpinner from '../shared/LoadingSpinner';
import { formatPercent, toNumber } from './utils';

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

export default function PreMarketDeepDive({ symbol }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newsRows, setNewsRows] = useState([]);
  const [signal, setSignal] = useState(null);
  const [expectedMove, setExpectedMove] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!symbol) return;
      setLoading(true);
      setError('');

      try {
        const [signalsPayload, newsPayload, expectedPayload] = await Promise.all([
          apiJSON(`/api/signals?symbol=${encodeURIComponent(symbol)}`),
          apiJSON(`/api/intelligence/news?symbol=${encodeURIComponent(symbol)}`),
          apiJSON(`/api/expected-move?symbol=${encodeURIComponent(symbol)}`),
        ]);

        if (cancelled) return;

        const signalRows = extractRows(signalsPayload?.signals ? signalsPayload.signals : signalsPayload)
          .filter((row) => String(row?.symbol || '').toUpperCase() === symbol);

        const newsItems = extractRows(newsPayload)
          .filter((row) => String(row?.symbol || '').toUpperCase() === symbol)
          .slice(0, 5);

        const expected = expectedPayload?.data?.[0] || expectedPayload?.data || expectedPayload || null;

        setSignal(signalRows[0] || null);
        setNewsRows(newsItems);
        setExpectedMove(expected && typeof expected === 'object' ? expected : null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Failed to load deep dive');
          setSignal(null);
          setNewsRows([]);
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
    const setup = signal?.strategy || signal?.class || 'Momentum Continuation';
    if (String(setup).toLowerCase().includes('vwap')) {
      return 'Wait for VWAP reclaim and hold before entry. Risk below reclaim candle low.';
    }
    return 'Trade ORB breakout above previous high with volume confirmation. Scale partials into strength.';
  }, [signal]);

  return (
    <div className="space-y-3">
      <Card>
        <h3 className="m-0">Deep Dive</h3>
        <div className="mt-1 text-sm muted">WHY {symbol || 'this stock'} matters today</div>
      </Card>

      <Card>
        {loading ? <LoadingSpinner message={`Loading ${symbol} deep dive...`} /> : null}
        {!loading && error ? <div className="text-sm" style={{ color: 'var(--accent-red)' }}>{error}</div> : null}
        {!loading && !error ? (
          <div className="space-y-3 text-sm">
            <div className="rounded p-3" style={{ background: 'var(--bg-elevated)' }}>
              <div className="muted text-xs">Ticker Header</div>
              <div className="text-lg font-semibold">{symbol || '--'}</div>
              <div>
                Price change {signal ? formatPercent(signal.change_percent || signal.gap_percent || 0) : '--'}
              </div>
            </div>

            <div className="rounded p-3" style={{ background: 'var(--bg-elevated)' }}>
              <div className="muted text-xs">Strategy Setup</div>
              <div>{signal?.strategy || signal?.class || 'No active setup signal'}</div>
            </div>

            <div className="rounded p-3" style={{ background: 'var(--bg-elevated)' }}>
              <div className="muted text-xs">Catalyst Explanation</div>
              <div>{newsRows[0]?.headline || 'No fresh catalyst headline available.'}</div>
            </div>

            <div className="rounded p-3" style={{ background: 'var(--bg-elevated)' }}>
              <div className="muted text-xs">Trade Plan</div>
              <div>{tradePlan}</div>
              <div className="mt-2 muted">
                Expected move: {expectedMove?.expected_move_percent != null ? formatPercent(expectedMove.expected_move_percent) : '--'}
              </div>
              <div className="muted">
                Key levels: {signal?.gap_percent != null ? `Gap ${formatPercent(signal.gap_percent)}` : 'Await intraday confirmation'}
              </div>
            </div>

            <div className="rounded p-3" style={{ background: 'var(--bg-elevated)' }}>
              <div className="muted text-xs">Volume Profile</div>
              <div>Relative volume: {toNumber(signal?.relative_volume, 0).toFixed(2)}x</div>
              <div>Volume: {toNumber(signal?.volume, 0).toLocaleString()}</div>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
