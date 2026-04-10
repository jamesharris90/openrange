import React from 'react';

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function confidenceTone(confidence) {
  if (confidence > 85) return 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40';
  if (confidence >= 70) return 'bg-amber-500/15 text-amber-300 border-amber-400/40';
  return 'bg-rose-500/15 text-rose-300 border-rose-400/40';
}

function priorityBorder(priority) {
  const key = String(priority || '').toUpperCase();
  if (key === 'HIGH') return 'border-emerald-400/45';
  if (key === 'MEDIUM') return 'border-amber-400/45';
  return 'border-slate-600/70';
}

function limitLines(text, maxChars = 180) {
  const value = String(text || '').trim();
  if (!value) return 'No narrative provided yet.';
  return value.length > maxChars ? `${value.slice(0, maxChars - 3)}...` : value;
}

function formatHow(how) {
  if (!how || typeof how !== 'object') {
    return {
      entry: '--',
      stop: '--',
      target: '--',
    };
  }

  return {
    entry: String(how.entry || '--'),
    stop: String(how.risk || how.stop || '--'),
    target: String(how.target || '--'),
  };
}

function generateShortSummary(signal) {
  const summary = String(signal?.summary || signal?.catalyst_summary || '').trim();
  if (summary) return summary;

  const why = String(signal?.why || '').trim();
  if (!why) return 'No summary available yet.';

  const sentence = why.split(/[.!?]/).map((part) => part.trim()).find(Boolean);
  return sentence ? `${sentence}.` : why;
}

export default function SignalCard({ signal, isTop = false }) {
  const confidence = toNumber(signal?.confidence, 0);
  const symbol = String(signal?.symbol || '--').toUpperCase();
  const bias = String(signal?.bias || 'neutral').toLowerCase();
  const edge = toNumber(signal?.historical_edge, 0.5);
  const tradeScore = Math.round((confidence * 0.6) + (edge * 100 * 0.4));
  const expectedMove = toNumber(signal?.expected_move ?? signal?.expectedMove ?? signal?.move_percent, 0);
  const conviction = tradeScore > 80 ? 'STRONG' : tradeScore > 65 ? 'MODERATE' : 'WEAK';
  const age = Number(signal?.signal_age_minutes);
  const hasAge = Number.isFinite(age);
  const ageForState = hasAge ? age : Number.POSITIVE_INFINITY;
  const tradeState = ageForState < 30 ? 'ACTIONABLE' : ageForState < 240 ? 'MONITOR' : 'EXPIRED';
  const riskLevel = expectedMove > 100 ? 'HIGH RISK' : expectedMove > 50 ? 'MEDIUM RISK' : 'LOW RISK';
  const summary = generateShortSummary(signal);
  const how = formatHow(signal?.how);
  const badgeClass = confidenceTone(confidence);
  const catalystType = String(signal?.catalyst_type || 'technical').toLowerCase();
  const earningsFlag = Boolean(signal?.earnings_flag);

  let ageLabel = 'LIVE';
  if (hasAge && age > 30 && age <= 240) ageLabel = 'RECENT';
  if (hasAge && age > 240) ageLabel = 'OLDER';

  let opacityClass = '';
  if (hasAge && age > 600) opacityClass = ' opacity-40';
  else if (hasAge && age > 240) opacityClass = ' opacity-60';

  const focusClass = isTop
    ? ' scale-[1.02] border-cyan-300/70 shadow-[0_14px_32px_rgba(6,182,212,0.18)]'
    : '';

  const convictionClass = conviction === 'STRONG'
    ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
    : conviction === 'MODERATE'
      ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
      : 'border-rose-400/40 bg-rose-500/10 text-rose-200';

  const tradeStateClass = tradeState === 'ACTIONABLE'
    ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
    : tradeState === 'MONITOR'
      ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
      : 'border-rose-400/40 bg-rose-500/10 text-rose-200';

  const riskClass = riskLevel === 'HIGH RISK'
    ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
    : riskLevel === 'MEDIUM RISK'
      ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
      : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200';

  return (
    <article className={`rounded-2xl border ${priorityBorder(signal?.priority)} bg-slate-900/75 p-4 shadow-[0_12px_28px_rgba(2,6,23,0.35)] transition-transform${focusClass}${opacityClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-bold tracking-wide text-slate-100">{symbol}</div>
          <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-400">{String(signal?.priority || 'LOW')} priority</div>
        </div>
        <span className="rounded-full border border-cyan-400/35 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-200">
          Trade Score: {tradeScore}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full border px-2 py-0.5 font-semibold tracking-[0.12em] ${tradeStateClass}`}>
          {tradeState}
        </span>
        <span className={`rounded-full border px-2 py-0.5 font-semibold tracking-[0.12em] ${riskClass}`}>
          {riskLevel}
        </span>
      </div>

      <div className="mt-2 rounded-lg border border-slate-700/70 bg-slate-950/55 px-2.5 py-2 text-xs leading-5 text-slate-200">
        {summary}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-md border px-2 py-1 ${badgeClass}`}>
          Confidence: {Math.round(confidence)}%
        </span>
        <span className="rounded-md border border-cyan-400/35 bg-cyan-500/10 px-2 py-1 text-cyan-200">
          Edge: {Math.round(edge * 100)}%
        </span>
        <span className={`rounded-md border px-2 py-1 ${convictionClass}`}>
          Conviction: {conviction}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-indigo-400/35 bg-indigo-500/10 px-2 py-1 text-indigo-200">
          {catalystType}
        </span>
        <span className="rounded-md border border-slate-600/70 bg-slate-800/70 px-2 py-1 text-slate-200">
          {bias}
        </span>
        <span className="rounded-md border border-emerald-400/35 bg-emerald-500/10 px-2 py-1 text-emerald-200">
          {earningsFlag ? 'earnings' : 'non-earnings'}
        </span>
      </div>

      <div className="mt-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Why</div>
        <p className="mt-1 line-clamp-3 text-sm leading-5 text-slate-200">{limitLines(signal?.why)}</p>
      </div>

      <div className="mt-3 rounded-xl border border-slate-700/70 bg-slate-950/55 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">How</div>
        <div className="mt-2 space-y-1.5 text-xs text-slate-200">
          <div><span className="font-semibold text-slate-100">ENTRY:</span> {how.entry}</div>
          <div><span className="font-semibold text-slate-100">RISK:</span> {how.stop}</div>
          <div><span className="font-semibold text-slate-100">TARGET:</span> {how.target}</div>
        </div>
      </div>

      {hasAge ? (
        <div className="mt-3 text-xs text-slate-400">🕒 {Math.floor(age / 60)}h ago ({ageLabel})</div>
      ) : null}
    </article>
  );
}
