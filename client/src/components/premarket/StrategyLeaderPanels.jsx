import { useMemo, useState } from 'react';
import TickerLogo from '../TickerLogo';
import Sparkline from '../charts/Sparkline';

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

  const panels = useMemo(() => buildPanels(rows), [rows]);
  const sliceCount = expanded ? 8 : 4;

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">Strategy Panels</h3>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="rounded border border-[var(--border-color)] px-2 py-1 text-xs">
          {expanded ? 'Collapse' : 'Expand'}
        </button>
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
