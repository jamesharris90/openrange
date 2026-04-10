import { useEffect, useMemo, useState } from 'react';
import TickerLogo from '../TickerLogo';
import Sparkline from '../charts/Sparkline';
import { apiJSON } from '../../config/api';

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toConfidencePercent(row) {
  const raw = row?.confidence_context_percent ?? row?.confidence_contextual ?? row?.confidence;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n <= 1) return n * 100;
  return n;
}

function pickCategory(strategy = '') {
  const s = String(strategy).toLowerCase();
  if (s.includes('day 2')) return 'Day 2 Continuation';
  if (s.includes('swing')) return 'Swing Trades';
  if (s.includes('momentum')) return 'Momentum Leaders';
  return 'Momentum Leaders';
}

function buildPanels(rows) {
  const panelMap = {
    'Gap Leaders': [...rows].sort((a, b) => toNum(b?.gap_percent) - toNum(a?.gap_percent)),
    'Momentum Leaders': [],
    'Day 2 Continuation': [],
    'Swing Trades': [],
  };

  rows.forEach((row) => {
    const strategy = row?.setup_type || row?.strategy || '';
    const cat = pickCategory(strategy);
    panelMap[cat].push(row);
  });

  panelMap['Momentum Leaders'] = panelMap['Momentum Leaders'].sort((a, b) => toNum(b?.strategy_score) - toNum(a?.strategy_score));
  panelMap['Day 2 Continuation'] = panelMap['Day 2 Continuation'].sort((a, b) => toNum(b?.strategy_score) - toNum(a?.strategy_score));
  panelMap['Swing Trades'] = panelMap['Swing Trades'].sort((a, b) => toNum(b?.strategy_score) - toNum(a?.strategy_score));

  return panelMap;
}

export default function StrategyLeaderPanels({ rows = [], onSelectTicker }) {
  const [expanded, setExpanded] = useState(false);
  const [top5, setTop5] = useState([]);
  const [missed, setMissed] = useState([]);
  const [outcomes, setOutcomes] = useState([]);
  const [strategyRanking, setStrategyRanking] = useState([]);
  const [calibration, setCalibration] = useState([]);
  const [replay, setReplay] = useState([]);

  const panels = useMemo(() => buildPanels(rows), [rows]);
  const sliceCount = expanded ? 8 : 4;
  const total = outcomes.length || 1;
  const wins = outcomes.filter((o) => String(o?.outcome || '').toUpperCase() === 'WIN').length;
  const losses = outcomes.filter((o) => String(o?.outcome || '').toUpperCase() === 'LOSS').length;
  const neutral = outcomes.filter((o) => String(o?.outcome || '').toUpperCase() === 'NEUTRAL').length;

  useEffect(() => {
    let cancelled = false;

    async function loadIntelligencePanels() {
      try {
        const [top5Payload, missedPayload, outcomesPayload, replayPayload] = await Promise.all([
          apiJSON('/api/intelligence/top5').catch(() => null),
          apiJSON('/api/intelligence/missed').catch(() => null),
          apiJSON('/api/intelligence/outcomes').catch(() => null),
          apiJSON('/api/intelligence/replay').catch(() => null),
        ]);

        if (cancelled) return;

        const top5Rows = Array.isArray(top5Payload?.results)
          ? top5Payload.results
          : Array.isArray(top5Payload)
            ? top5Payload
            : [];
        const missedRows = Array.isArray(missedPayload)
          ? missedPayload
          : Array.isArray(missedPayload?.results)
            ? missedPayload.results
            : [];
        const outcomeRows = Array.isArray(outcomesPayload)
          ? outcomesPayload
          : Array.isArray(outcomesPayload?.results)
            ? outcomesPayload.results
            : [];
        const replayRows = Array.isArray(replayPayload)
          ? replayPayload
          : Array.isArray(replayPayload?.results)
            ? replayPayload.results
            : [];

        setTop5(top5Rows.slice(0, 5));
        setMissed(missedRows.slice(0, 5));
        setOutcomes(outcomeRows.slice(0, 10));
        setReplay(replayRows.slice(0, 10));
      } catch {
        if (!cancelled) {
          setTop5([]);
          setMissed([]);
          setOutcomes([]);
          setReplay([]);
        }
      }
    }

    loadIntelligencePanels();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fetch('/api/intelligence/calibration')
      .then((res) => res.json())
      .then((data) => setCalibration(Array.isArray(data) ? data : []))
      .catch(() => setCalibration([]));
  }, []);

  useEffect(() => {
    fetch('/api/intelligence/strategy-ranking')
      .then((res) => res.json())
      .then((data) => setStrategyRanking(Array.isArray(data) ? data : []))
      .catch(() => setStrategyRanking([]));
  }, []);

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">Strategy Panels</h3>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="rounded border border-[var(--border-color)] px-2 py-1 text-xs">
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="mb-2 text-xs font-semibold text-[var(--text-muted)]">Top 5 TQI (Secondary)</div>
          {top5.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)]">No qualifying setups right now</div>
          ) : (
            <div className="space-y-1 text-xs">
              {top5.map((row, idx) => (
                <button
                  key={`top5-${row?.symbol || 'row'}-${idx}`}
                  type="button"
                  className="flex w-full items-center justify-between rounded border border-[var(--border-color)] px-2 py-1 text-left"
                  onClick={() => onSelectTicker?.(String(row?.symbol || '').toUpperCase())}
                >
                  <span>{String(row?.symbol || '--').toUpperCase()}</span>
                  <span className="text-[var(--text-muted)]">TQI {toNum(row?.trade_quality, 0).toFixed(0)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="mb-2 text-xs font-semibold text-[var(--text-muted)]">Missed Opportunities (Learning)</div>
          {missed.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)]">No qualifying setups right now</div>
          ) : (
            <div className="space-y-1 text-xs">
              {missed.map((row, idx) => (
                <button
                  key={`missed-${row?.symbol || 'row'}-${idx}`}
                  type="button"
                  className="flex w-full items-center justify-between rounded border border-[var(--border-color)] px-2 py-1 text-left"
                  onClick={() => onSelectTicker?.(String(row?.symbol || '').toUpperCase())}
                >
                  <span>{String(row?.symbol || '--').toUpperCase()}</span>
                  <span className="text-amber-400">+{toNum(row?.move_since_signal, 0).toFixed(2)}%</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mb-3 grid gap-3 lg:grid-cols-3">
        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="mb-2 text-xs font-semibold text-[var(--text-muted)]">Outcome Panel (Last 10)</div>
          {outcomes.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)]">No outcome data available</div>
          ) : (
            <div className="space-y-1 text-xs">
              {outcomes.map((row, idx) => {
                const outcome = String(row?.outcome || 'NEUTRAL').toUpperCase();
                const outcomeClass = outcome === 'WIN'
                  ? 'text-emerald-400'
                  : outcome === 'LOSS'
                    ? 'text-rose-400'
                    : 'text-amber-300';
                return (
                  <button
                    key={`outcome-${row?.symbol || 'row'}-${idx}`}
                    type="button"
                    className="flex w-full items-center justify-between rounded border border-[var(--border-color)] px-2 py-1 text-left"
                    onClick={() => onSelectTicker?.(String(row?.symbol || '').toUpperCase())}
                  >
                    <span>{String(row?.symbol || '--').toUpperCase()}</span>
                    <span className={outcomeClass}>{outcome}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="mb-2 text-xs font-semibold text-[var(--text-muted)]">Strategy Performance</div>
          {strategyRanking.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)]">No strategy data</div>
          ) : (
            <div className="space-y-1 text-xs">
              {strategyRanking.map((row, idx) => (
                <div
                  key={`strategy-${row?.strategy || 'row'}-${idx}`}
                  className="flex items-center justify-between rounded border border-[var(--border-color)] px-2 py-1"
                >
                  <strong className="truncate pr-2">{String(row?.strategy || 'unknown')}</strong>
                  <span className="text-[var(--text-muted)]">{toNum(row?.win_rate, 0).toFixed(0)}%</span>
                  <span className="text-[var(--text-muted)]">Score: {toNum(row?.score, 0).toFixed(0)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="mb-2 text-xs font-semibold text-[var(--text-muted)]">Replay Panel</div>
          {replay.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)]">No replay data available</div>
          ) : (
            <div className="space-y-1 text-xs">
              {replay.map((row, idx) => (
                <button
                  key={`replay-${row?.symbol || 'row'}-${idx}`}
                  type="button"
                  className="w-full rounded border border-[var(--border-color)] px-2 py-1 text-left"
                  onClick={() => onSelectTicker?.(String(row?.symbol || '').toUpperCase())}
                >
                  <div className="flex items-center justify-between">
                    <span>{String(row?.symbol || '--').toUpperCase()}</span>
                    <span className="text-[var(--text-muted)]">{String(row?.strategy || 'N/A')}</span>
                  </div>
                  <div className="truncate text-[var(--text-muted)]">{String(row?.narrative || 'No narrative')}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <h3 className="mb-2 text-xs font-semibold text-[var(--text-muted)]">Calibration (Predicted vs Actual)</h3>
          {calibration.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No calibration data yet</p>
          ) : (
            <div className="space-y-1 text-xs">
              {calibration.map((c, i) => (
                <div key={`calibration-${i}`} className="flex items-center justify-between rounded border border-[var(--border-color)] px-2 py-1">
                  <span>{toNum(c?.confidence_bucket, 0).toFixed(0)}%</span>
                  <span className="text-[var(--text-muted)]">→</span>
                  <span>{toNum(c?.actual, 0).toFixed(0)}% actual</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <h3 className="mb-2 text-xs font-semibold text-[var(--text-muted)]">Outcome Mix</h3>
          <div className="h-3 w-full overflow-hidden rounded bg-[var(--bg-primary)]">
            <div className="flex h-full w-full">
              <div style={{ width: `${(wins / total) * 100}%`, background: 'green' }} />
              <div style={{ width: `${(losses / total) * 100}%`, background: 'red' }} />
              <div style={{ width: `${(neutral / total) * 100}%`, background: 'gray' }} />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>Wins: {wins}</span>
            <span>Losses: {losses}</span>
            <span>Neutral: {neutral}</span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {Object.entries(panels)?.map(([title, list]) => {
          const top = list.slice(0, sliceCount);
          return (
            <div key={title}>
              <div className="mb-2 text-xs font-semibold text-[var(--text-muted)]">{title}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {top.length === 0 ? (
                  <div className="text-xs text-[var(--text-muted)]">No market data available yet.</div>
                ) : top?.map((row, index) => {
                  const symbol = String(row?.symbol || '').toUpperCase();
                  const change = toNum(row?.gap_percent ?? row?.change_percent, 0);
                  const adjustedConfidence = toConfidencePercent(row);
                  return (
                    <button
                      key={`${title}-${symbol}-${index}`}
                      type="button"
                      onClick={() => onSelectTicker?.(symbol)}
                      className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-left"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <TickerLogo symbol={symbol} className="h-5 w-5" />
                          <span className="font-semibold">{symbol}</span>
                        </div>
                        <span className={change >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">{row?.sector || 'Unknown sector'}</div>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">
                        Confidence: {adjustedConfidence == null ? 'N/A' : `${adjustedConfidence.toFixed(0)}%`} (Adjusted)
                      </div>
                      <div className="mt-1">
                        <Sparkline symbol={symbol} positive={change >= 0} width={140} height={28} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
