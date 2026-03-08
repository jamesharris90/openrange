import { useEffect, useMemo, useState } from 'react';
import Card from '../components/shared/Card';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function fmt(value, digits = 2) {
  return toNumber(value).toFixed(digits);
}

function pct(value) {
  return `${fmt(value, 2)}%`;
}

export default function StrategyEvaluationPage() {
  const [loading, setLoading] = useState(true);
  const [performance, setPerformance] = useState([]);
  const [trades, setTrades] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [perfPayload, tradesPayload] = await Promise.all([
          apiJSON('/api/strategy/performance'),
          apiJSON('/api/strategy/trades?limit=300'),
        ]);

        if (cancelled) return;
        setPerformance(Array.isArray(perfPayload?.items) ? perfPayload.items : []);
        setTrades(Array.isArray(tradesPayload?.items) ? tradesPayload.items : []);
      } catch (err) {
        if (!cancelled) {
          setPerformance([]);
          setTrades([]);
          setError(err?.message || 'Failed to load strategy evaluation data.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    const totalTrades = trades.length;
    const avgMove = totalTrades
      ? trades.reduce((acc, row) => acc + toNumber(row?.result_percent), 0) / totalTrades
      : 0;
    const wins = trades.filter((row) => toNumber(row?.result_percent) > 0).length;
    const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
    return { totalTrades, avgMove, winRate };
  }, [trades]);

  const strategyBars = useMemo(() => {
    const maxTrades = Math.max(1, ...performance.map((row) => toNumber(row?.total_trades, 0)));
    return performance.map((row) => ({
      ...row,
      widthPct: (toNumber(row?.total_trades, 0) / maxTrades) * 100,
    }));
  }, [performance]);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Strategy Evaluation"
          subtitle="Performance tracking for strategy signals, outcomes, and edge durability."
        />
      </Card>

      {loading ? (
        <Card><LoadingSpinner message="Loading strategy metrics..." /></Card>
      ) : error ? (
        <Card><div className="muted">{error}</div></Card>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-3">
            <Card>
              <div className="muted text-xs">Win Rate</div>
              <div className="text-2xl font-semibold">{pct(totals.winRate)}</div>
            </Card>
            <Card>
              <div className="muted text-xs">Avg Move</div>
              <div className="text-2xl font-semibold">{pct(totals.avgMove)}</div>
            </Card>
            <Card>
              <div className="muted text-xs">Total Trades</div>
              <div className="text-2xl font-semibold">{totals.totalTrades}</div>
            </Card>
          </div>

          <Card>
            <h3 className="m-0 mb-3">Best Strategies</h3>
            {!strategyBars.length ? (
              <div className="muted">No strategy performance data available.</div>
            ) : (
              <div className="space-y-2">
                {strategyBars.map((row) => (
                  <div key={String(row?.strategy || 'unknown')}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span>{row?.strategy || 'Unknown'}</span>
                      <span className="muted">Win {pct(row?.win_rate)} | Avg {pct(row?.avg_move)} | Trades {toNumber(row?.total_trades, 0)}</span>
                    </div>
                    <div className="h-2 w-full rounded bg-[var(--bg-card-hover)]">
                      <div className="h-2 rounded bg-[var(--accent-blue)]" style={{ width: `${Math.max(4, row.widthPct)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Signal Success Rate Over Time</h3>
            {!trades.length ? (
              <div className="muted">No trades recorded yet.</div>
            ) : (
              <div className="space-y-1 text-xs">
                {trades.slice(0, 40).map((row) => {
                  const result = toNumber(row?.result_percent);
                  return (
                    <div key={String(row?.id || `${row?.symbol}-${row?.entry_time}`)} className="flex items-center justify-between rounded border border-[var(--border-color)] px-2 py-1">
                      <span>{row?.entry_time ? new Date(row.entry_time).toLocaleString() : '--'} - {row?.symbol || '--'}</span>
                      <span style={{ color: result >= 0 ? 'var(--positive-color, #10b981)' : 'var(--negative-color, #ef4444)' }}>{pct(result)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Deep Dive Trades</h3>
            {!trades.length ? (
              <div className="muted">No trade evaluations available.</div>
            ) : (
              <div className="overflow-auto">
                <table className="data-table data-table--compact min-w-[980px]">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Strategy</th>
                      <th style={{ textAlign: 'right' }}>Entry Price</th>
                      <th style={{ textAlign: 'right' }}>Exit Price</th>
                      <th style={{ textAlign: 'right' }}>Result</th>
                      <th style={{ textAlign: 'right' }}>Max Move</th>
                      <th>Entry Time</th>
                      <th>Exit Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.slice(0, 250).map((row) => {
                      const result = toNumber(row?.result_percent);
                      return (
                        <tr key={String(row?.id || `${row?.symbol}-${row?.entry_time}`)}>
                          <td>{row?.symbol || '--'}</td>
                          <td>{row?.strategy || '--'}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(row?.entry_price, 3)}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(row?.exit_price, 3)}</td>
                          <td style={{ textAlign: 'right', color: result >= 0 ? 'var(--positive-color, #10b981)' : 'var(--negative-color, #ef4444)' }}>{pct(result)}</td>
                          <td style={{ textAlign: 'right' }}>{pct(row?.max_move)}</td>
                          <td>{row?.entry_time ? new Date(row.entry_time).toLocaleString() : '--'}</td>
                          <td>{row?.exit_time ? new Date(row.exit_time).toLocaleString() : '--'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </PageContainer>
  );
}
