import { useEffect, useMemo, useState } from 'react';
import TickerLogo from '../TickerLogo';
import { apiJSON } from '../../config/api';
import OpportunityBreakdown from './OpportunityBreakdown';
import { ConfidenceGauge, ExpectedMoveRange } from '../terminal/SignalVisuals';

function toNum(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function TopOpportunity({ onSelectTicker }) {
  const [items, setItems] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/intelligence/priority');
        if (!cancelled) {
          const rows = Array.isArray(payload?.results)
            ? payload.results
            : Array.isArray(payload)
              ? payload
              : [];
          setItems(rows.slice(0, 3));
          setActiveItem(rows[0] || null);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setActiveItem(null);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!items.length) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-300">
        <h3 className="m-0 mb-2 text-sm font-semibold uppercase tracking-wide text-slate-100">Top 3 Trades Right Now</h3>
        <div>No qualifying setups right now</div>
      </div>
    );
  }

  const selected = activeItem || items[0];

  return (
    <div className="space-y-2">
      <div className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-left">
        <h3 className="m-0 mb-3 text-sm font-semibold uppercase tracking-wide text-slate-100">Top 3 Trades Right Now</h3>

        <div className="grid gap-3 md:grid-cols-3">
          {items.map((item, idx) => {
            const symbol = String(item?.symbol || '').toUpperCase();
            const confidence = toNum(item?.adjusted_confidence ?? item?.confidence ?? item?.opportunity_score, 0);
            const quality = toNum(item?.trade_quality ?? item?.quality_score ?? item?.priority_score, 0);
            const expectedMove = toNum(item?.expected_move_percent ?? item?.expected_move ?? item?.move_percent, 0);
            const low = Number(item?.expected_move_low);
            const high = Number(item?.expected_move_high);
            const current = Number(item?.current_price ?? item?.price);
            const active = String(selected?.symbol || '').toUpperCase() === symbol;

            return (
              <button
                key={`${symbol || 'row'}-${idx}`}
                type="button"
                onClick={() => {
                  setActiveItem(item);
                  setShowBreakdown(true);
                  onSelectTicker?.(symbol);
                }}
                className={`rounded-lg border p-3 text-left ${active ? 'border-cyan-400/40 bg-slate-800' : 'border-slate-700 bg-slate-950 hover:border-slate-500'}`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TickerLogo symbol={symbol} className="h-6 w-6" />
                    <div className="text-lg font-semibold text-slate-100">{symbol || '--'}</div>
                  </div>
                  <span className="rounded border border-cyan-500/30 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
                    {item?.strategy || 'Setup'}
                  </span>
                </div>

                <ConfidenceGauge value={confidence} />

                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Trade Quality</span>
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${quality >= 70 ? 'bg-emerald-500/20 text-emerald-300' : quality >= 40 ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'}`}>
                    {quality.toFixed(0)}
                  </span>
                </div>

                <div className="mt-2 rounded border border-slate-700 bg-slate-900 p-2 text-xs">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Expected Move</div>
                  <div className="font-semibold text-cyan-300">{expectedMove ? `${expectedMove.toFixed(2)}%` : 'No qualifying setups right now'}</div>
                  <div className="mt-1">
                    <ExpectedMoveRange low={low} high={high} current={current} />
                  </div>
                </div>

                <div className="mt-2 text-xs text-slate-300">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Why Moving</div>
                  <div className="line-clamp-2">{item?.why_moving || item?.catalyst || item?.headline || 'No qualifying setups right now'}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div className="rounded border border-slate-700 bg-slate-950 p-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Why Tradeable</div>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-300">
              {(String(selected?.why_tradeable || 'No qualifying setups right now')).split(/[.;]\s+/).filter(Boolean).slice(0, 3).map((point, idx) => (
                <li key={`tradeable-${idx}`}>{point}</li>
              ))}
            </ul>
          </div>

          <div className="rounded border border-slate-700 bg-slate-950 p-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Execution Plan</div>
            <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded border border-slate-700 bg-slate-900 p-1.5">
                <div className="text-[10px] text-slate-500">Entry</div>
                <div className="font-semibold text-slate-100">{selected?.execution_plan?.entry ? `$${toNum(selected.execution_plan.entry).toFixed(2)}` : selected?.entry ? `$${toNum(selected.entry).toFixed(2)}` : '--'}</div>
              </div>
              <div className="rounded border border-slate-700 bg-slate-900 p-1.5">
                <div className="text-[10px] text-slate-500">Stop</div>
                <div className="font-semibold text-rose-300">{selected?.execution_plan?.stop ? `$${toNum(selected.execution_plan.stop).toFixed(2)}` : selected?.stop_loss ? `$${toNum(selected.stop_loss).toFixed(2)}` : '--'}</div>
              </div>
              <div className="rounded border border-slate-700 bg-slate-900 p-1.5">
                <div className="text-[10px] text-slate-500">Target</div>
                <div className="font-semibold text-emerald-300">{selected?.execution_plan?.target ? `$${toNum(selected.execution_plan.target).toFixed(2)}` : selected?.take_profit ? `$${toNum(selected.take_profit).toFixed(2)}` : '--'}</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded border border-slate-700 bg-slate-900 p-1.5">
                <div className="text-[10px] text-slate-500">R:R</div>
                <div className={`font-semibold ${toNum(selected?.risk_reward) >= 2 ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {toNum(selected?.risk_reward) > 0 ? `${toNum(selected.risk_reward).toFixed(1)}:1` : '--'}
                </div>
              </div>
              <div className="rounded border border-slate-700 bg-slate-900 p-1.5">
                <div className="text-[10px] text-slate-500">Size (shares)</div>
                <div className="font-semibold text-slate-100">
                  {toNum(selected?.position_size) > 0 ? toNum(selected.position_size).toFixed(0) : '--'}
                </div>
              </div>
              <div className="rounded border border-slate-700 bg-slate-900 p-1.5">
                <div className="text-[10px] text-slate-500">Max Risk</div>
                <div className="font-semibold text-slate-100">£10</div>
              </div>
            </div>
            {selected?.how_to_trade && (
              <div className="mt-2 text-[10px] leading-relaxed text-slate-400">{selected.how_to_trade}</div>
            )}
          </div>
        </div>

        <div className="mt-2 text-xs text-slate-500">Select a trade card for full explainability breakdown.</div>
      </div>

      <OpportunityBreakdown item={selected} open={showBreakdown} onClose={() => setShowBreakdown(false)} />
    </div>
  );
}
