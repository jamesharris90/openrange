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

function asHour(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours();
}

export default function StrategyEvaluationPage() {
  const [loading, setLoading] = useState(true);
  const [performance, setPerformance] = useState([]);
  const [trades, setTrades] = useState([]);
  const [experimentalSignals, setExperimentalSignals] = useState([]);
  const [error, setError] = useState('');

  const [strategyFilter, setStrategyFilter] = useState('ALL');
  const [sectorFilter, setSectorFilter] = useState('ALL');
  const [catalystFilter, setCatalystFilter] = useState('ALL');
  const [confidenceFilter, setConfidenceFilter] = useState('ALL');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [perfPayload, tradesPayload, earlyPayload] = await Promise.all([
          apiJSON('/api/strategy/performance'),
          apiJSON('/api/strategy/trades?limit=500'),
          apiJSON('/api/intelligence/early-accumulation').catch(() => ({ ok: false, items: [] })),
        ]);

        if (cancelled) return;
        setPerformance(Array.isArray(perfPayload?.items) ? perfPayload.items : []);
        setTrades(Array.isArray(tradesPayload?.items) ? tradesPayload.items : []);
        setExperimentalSignals(Array.isArray(earlyPayload?.items) ? earlyPayload.items : []);
      } catch (err) {
        if (!cancelled) {
          setPerformance([]);
          setTrades([]);
          setExperimentalSignals([]);
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

  const strategies = useMemo(() => ['ALL', ...new Set(trades.map((row) => String(row?.strategy || 'Unknown')))], [trades]);
  const sectors = useMemo(() => ['ALL', ...new Set(trades.map((row) => String(row?.sector || 'Unknown')))], [trades]);
  const catalysts = useMemo(() => ['ALL', ...new Set(trades.map((row) => String(row?.catalyst_type || 'unknown')))], [trades]);
  const confidences = useMemo(() => ['ALL', ...new Set(trades.map((row) => String(row?.confidence || 'N/A')))], [trades]);

  const filteredTrades = useMemo(() => {
    return trades.filter((row) => {
      const strategy = String(row?.strategy || 'Unknown');
      const sector = String(row?.sector || 'Unknown');
      const catalyst = String(row?.catalyst_type || 'unknown');
      const confidence = String(row?.confidence || 'N/A');

      if (strategyFilter !== 'ALL' && strategy !== strategyFilter) return false;
      if (sectorFilter !== 'ALL' && sector !== sectorFilter) return false;
      if (catalystFilter !== 'ALL' && catalyst !== catalystFilter) return false;
      if (confidenceFilter !== 'ALL' && confidence !== confidenceFilter) return false;
      return true;
    });
  }, [trades, strategyFilter, sectorFilter, catalystFilter, confidenceFilter]);

  const totals = useMemo(() => {
    const totalTrades = filteredTrades.length;
    const avgMove = totalTrades
      ? filteredTrades.reduce((acc, row) => acc + toNumber(row?.result_percent), 0) / totalTrades
      : 0;
    const wins = filteredTrades.filter((row) => toNumber(row?.result_percent) > 0).length;
    const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
    const avgHold = totalTrades
      ? filteredTrades.reduce((acc, row) => acc + toNumber(row?.hold_hours), 0) / totalTrades
      : 0;
    return { totalTrades, avgMove, winRate, avgHold };
  }, [filteredTrades]);

  const thirtyDay = useMemo(() => {
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const rows = filteredTrades.filter((row) => {
      const ts = row?.entry_time ? new Date(row.entry_time).getTime() : 0;
      return ts > cutoff;
    });
    const total = rows.length;
    const avg = total ? rows.reduce((acc, row) => acc + toNumber(row?.result_percent), 0) / total : 0;
    const wins = rows.filter((row) => toNumber(row?.result_percent) > 0).length;
    return {
      total,
      avg,
      winRate: total ? (wins / total) * 100 : 0,
    };
  }, [filteredTrades]);

  const strategyBars = useMemo(() => {
    const map = new Map();
    for (const row of filteredTrades) {
      const key = String(row?.strategy || 'Unknown');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }

    const rows = Array.from(map.entries()).map(([strategy, items]) => {
      const total = items.length;
      const avg = total ? items.reduce((acc, row) => acc + toNumber(row?.result_percent), 0) / total : 0;
      const winRate = total ? (items.filter((row) => toNumber(row?.result_percent) > 0).length / total) * 100 : 0;
      return { strategy, total, avg, winRate };
    });

    const maxTrades = Math.max(1, ...rows.map((row) => row.total));
    return rows.map((row) => ({ ...row, widthPct: (row.total / maxTrades) * 100 }));
  }, [filteredTrades]);

  const timingHistogram = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, entries: 0, exits: 0 }));
    for (const row of filteredTrades) {
      const e = asHour(row?.entry_time);
      const x = asHour(row?.exit_time);
      if (e != null) buckets[e].entries += 1;
      if (x != null) buckets[x].exits += 1;
    }
    const maxCount = Math.max(1, ...buckets.map((b) => Math.max(b.entries, b.exits)));
    return { buckets, maxCount };
  }, [filteredTrades]);

  const scoreVsOutcome = useMemo(() => {
    return filteredTrades.slice(0, 40).map((row) => ({
      id: row?.id,
      symbol: row?.symbol,
      score: toNumber(row?.max_move),
      outcome: toNumber(row?.result_percent),
    }));
  }, [filteredTrades]);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Strategy Evaluation"
          subtitle="Performance tracking with 30-day analytics, timing behavior, and filterable outcome diagnostics."
        />
      </Card>

      {loading ? (
        <Card><LoadingSpinner message="Loading strategy metrics..." /></Card>
      ) : error ? (
        <Card><div className="muted">{error}</div></Card>
      ) : (
        <>
          <Card>
            <div className="grid gap-2 md:grid-cols-4">
              <label>
                <div className="muted text-xs">Strategy</div>
                <select className="input-field" value={strategyFilter} onChange={(e) => setStrategyFilter(e.target.value)}>
                  {strategies.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <div className="muted text-xs">Sector</div>
                <select className="input-field" value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)}>
                  {sectors.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <div className="muted text-xs">Catalyst</div>
                <select className="input-field" value={catalystFilter} onChange={(e) => setCatalystFilter(e.target.value)}>
                  {catalysts.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <div className="muted text-xs">Confidence</div>
                <select className="input-field" value={confidenceFilter} onChange={(e) => setConfidenceFilter(e.target.value)}>
                  {confidences.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </div>
          </Card>

          <div className="grid gap-2 md:grid-cols-4">
            <Card>
              <div className="muted text-xs">Win Rate</div>
              <div className="text-2xl font-semibold">{pct(totals.winRate)}</div>
            </Card>
            <Card>
              <div className="muted text-xs">Avg Move</div>
              <div className="text-2xl font-semibold">{pct(totals.avgMove)}</div>
            </Card>
            <Card>
              <div className="muted text-xs">Avg Hold Time</div>
              <div className="text-2xl font-semibold">{fmt(totals.avgHold, 2)}h</div>
            </Card>
            <Card>
              <div className="muted text-xs">Total Trades</div>
              <div className="text-2xl font-semibold">{totals.totalTrades}</div>
            </Card>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <Card>
              <div className="muted text-xs">30-Day Trades</div>
              <div className="text-xl font-semibold">{thirtyDay.total}</div>
            </Card>
            <Card>
              <div className="muted text-xs">30-Day Avg Move</div>
              <div className="text-xl font-semibold">{pct(thirtyDay.avg)}</div>
            </Card>
            <Card>
              <div className="muted text-xs">30-Day Win Rate</div>
              <div className="text-xl font-semibold">{pct(thirtyDay.winRate)}</div>
            </Card>
          </div>

          <Card>
            <h3 className="m-0 mb-3">Win Rate by Strategy</h3>
            {!strategyBars.length ? (
              <div className="muted">No strategy performance data available.</div>
            ) : (
              <div className="space-y-2">
                {strategyBars.map((row) => (
                  <div key={String(row?.strategy || 'unknown')}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span>{row?.strategy || 'Unknown'}</span>
                      <span className="muted">Win {pct(row?.winRate)} | Avg {pct(row?.avg)} | Trades {row?.total}</span>
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
            <h3 className="m-0 mb-3">Signal vs Outcome (Recent 40)</h3>
            {!scoreVsOutcome.length ? (
              <div className="muted">No recent trade points available.</div>
            ) : (
              <div className="space-y-1 text-xs">
                {scoreVsOutcome.map((row) => (
                  <div key={String(row?.id || row?.symbol)} className="flex items-center justify-between rounded border border-[var(--border-color)] px-2 py-1">
                    <span>{row?.symbol || '--'}</span>
                    <span className="muted">Signal {fmt(row?.score, 2)} vs Outcome {pct(row?.outcome)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Entry vs Exit Timing</h3>
            <div className="space-y-1 text-xs">
              {timingHistogram.buckets.map((bucket) => (
                <div key={bucket.hour} className="grid grid-cols-[48px_1fr_1fr] items-center gap-2">
                  <span>{String(bucket.hour).padStart(2, '0')}:00</span>
                  <div className="h-2 rounded bg-[var(--bg-card-hover)]">
                    <div className="h-2 rounded bg-[var(--accent-green, #22c55e)]" style={{ width: `${(bucket.entries / timingHistogram.maxCount) * 100}%` }} />
                  </div>
                  <div className="h-2 rounded bg-[var(--bg-card-hover)]">
                    <div className="h-2 rounded bg-[var(--accent-orange, #f59e0b)]" style={{ width: `${(bucket.exits / timingHistogram.maxCount) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="muted mt-2 text-xs">Green = entries, Orange = exits</div>
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Experimental Signals</h3>
            {!experimentalSignals.length ? (
              <div className="muted">No early accumulation signals available.</div>
            ) : (
              <div className="overflow-auto">
                <table className="data-table data-table--compact min-w-[840px]">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Pressure</th>
                      <th style={{ textAlign: 'right' }}>Score</th>
                      <th style={{ textAlign: 'right' }}>Liquidity Surge</th>
                      <th style={{ textAlign: 'right' }}>Float Rotation</th>
                      <th style={{ textAlign: 'right' }}>Max Move %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {experimentalSignals.slice(0, 20).map((row) => (
                      <tr key={String(row?.id || `${row?.symbol}-${row?.detected_at}`)}>
                        <td>{row?.symbol || '--'}</td>
                        <td>{row?.pressure_level || '--'}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(row?.accumulation_score, 2)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(row?.liquidity_surge, 2)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(row?.float_rotation, 2)}</td>
                        <td style={{ textAlign: 'right' }}>{pct(row?.max_move_percent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Deep Dive Trades</h3>
            {!filteredTrades.length ? (
              <div className="muted">No trade evaluations available for current filters.</div>
            ) : (
              <div className="overflow-auto">
                <table className="data-table data-table--compact min-w-[1180px]">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Strategy</th>
                      <th>Sector</th>
                      <th>Catalyst</th>
                      <th>Confidence</th>
                      <th style={{ textAlign: 'right' }}>Entry Price</th>
                      <th style={{ textAlign: 'right' }}>Exit Price</th>
                      <th style={{ textAlign: 'right' }}>Result</th>
                      <th style={{ textAlign: 'right' }}>Hold (h)</th>
                      <th>Entry Time</th>
                      <th>Exit Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrades.slice(0, 300).map((row) => {
                      const result = toNumber(row?.result_percent);
                      return (
                        <tr key={String(row?.id || `${row?.symbol}-${row?.entry_time}`)}>
                          <td>{row?.symbol || '--'}</td>
                          <td>{row?.strategy || '--'}</td>
                          <td>{row?.sector || '--'}</td>
                          <td>{row?.catalyst_type || '--'}</td>
                          <td>{row?.confidence || '--'}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(row?.entry_price, 3)}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(row?.exit_price, 3)}</td>
                          <td style={{ textAlign: 'right', color: result >= 0 ? 'var(--positive-color, #10b981)' : 'var(--negative-color, #ef4444)' }}>{pct(result)}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(row?.hold_hours, 2)}</td>
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
