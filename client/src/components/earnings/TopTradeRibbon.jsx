import { memo, useMemo } from 'react';

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pickFinalScore(row) {
  const direct = toNum(row?.final_score, null);
  if (direct != null) return direct;
  const score = toNum(row?.score, null);
  if (score != null) return score;
  return 0;
}

function normalizeConfidence(value) {
  const numeric = toNum(value, null);
  if (numeric != null) return Math.max(0, Math.min(100, numeric));

  const text = String(value || '').trim().toUpperCase();
  if (text === 'HIGH') return 85;
  if (text === 'MEDIUM') return 65;
  if (text === 'LOW') return 45;

  return 50;
}

function decisionStatus(confidence) {
  if (confidence >= 75) return { label: 'HIGH CONVICTION', cls: 'text-green-400 border-green-400/40 bg-green-500/10' };
  if (confidence >= 60) return { label: 'ACTIONABLE', cls: 'text-yellow-300 border-yellow-300/40 bg-yellow-500/10' };
  return { label: 'WATCH', cls: 'text-gray-300 border-gray-500/40 bg-gray-500/10' };
}

function urgencyStatus(sessionPhase, rvol) {
  const phase = String(sessionPhase || '').trim().toLowerCase();
  const volume = toNum(rvol, 0);

  if (phase === 'market_open' && volume > 2) return { label: 'LIVE', cls: 'text-green-300 border-green-400/40 bg-green-500/10' };
  if (phase === 'premarket_peak') return { label: 'BUILDING', cls: 'text-yellow-300 border-yellow-300/40 bg-yellow-500/10' };
  return { label: 'EARLY', cls: 'text-gray-300 border-gray-500/40 bg-gray-500/10' };
}

function TopTradeRibbon({ row, onOpen }) {
  const computed = useMemo(() => {
    if (!row) return null;

    const finalScore = pickFinalScore(row);
    const confidence = normalizeConfidence(row.trade_confidence ?? row.top_confidence);
    const status = decisionStatus(confidence);
    const urgency = urgencyStatus(row.session_phase, row.rvol);

    return {
      symbol: row.symbol || 'N/A',
      finalScore,
      strategy: row.setup || row.strategy || 'Setup pending',
      confidence,
      status,
      entryTrigger: row.execution_plan || 'Wait for confirmation',
      urgency,
    };
  }, [row]);

  if (!computed) {
    return (
      <div className="w-full rounded-2xl border border-gray-700 bg-[#111827] p-4 text-sm text-gray-300">
        No Top Trade available for this window.
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen?.(row.symbol, row)}
      className="sticky top-2 z-20 w-full rounded-2xl border border-cyan-400/40 bg-[#111827] p-4 text-left shadow-lg shadow-cyan-500/10 transition hover:border-cyan-300/70"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Top Trade Now</div>
          <div className="mt-1 text-3xl font-bold text-white">{computed.symbol}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${computed.status.cls}`}>
            {computed.status.label}
          </span>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${computed.urgency.cls}`}>
            {computed.urgency.label}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <div className="text-xs text-gray-400">Final Score</div>
          <div className="text-lg font-semibold text-white">{computed.finalScore.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-400">Strategy</div>
          <div className="text-sm font-semibold text-white">{computed.strategy}</div>
        </div>
        <div>
          <div className="text-xs text-gray-400">Trade Confidence</div>
          <div className="text-lg font-semibold text-white">{computed.confidence.toFixed(0)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-400">Decision Status</div>
          <div className="text-sm font-semibold text-white">{computed.status.label}</div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Entry Trigger</div>
        <div className="mt-1 text-lg font-semibold text-white">
          {computed.entryTrigger}
        </div>
      </div>
    </button>
  );
}

export default memo(TopTradeRibbon);
