/**
 * Strategy filter chips — one per OpenRange strategy definition (PDF).
 * Each chip applies a filter preset to the earnings data.
 * Clicking a selected chip deselects it (returns to "All").
 */

const STRATEGIES = [
  // ── I. Momentum Continuation ──────────────────────────────────────────────
  {
    id: 'orb',
    label: 'ORB',
    fullLabel: 'Opening Range Breakout',
    group: 'Momentum',
    color: '#2563eb',
    desc: 'High relative volume (>1.5x) with gap or strong move',
    filter: r => (r.rvol != null && r.rvol > 1.5) || (r.gapPercent != null && r.gapPercent > 2),
  },
  {
    id: 'gap_go',
    label: 'Gap & Go',
    fullLabel: 'Premarket High Break',
    group: 'Momentum',
    color: '#0891b2',
    desc: 'Catalyst-driven gap up >3% with momentum',
    filter: r => r.gapPercent != null && r.gapPercent > 3,
  },
  {
    id: 'micro_pullback',
    label: 'Micro Pullback',
    fullLabel: 'Front-Side Momentum',
    group: 'Momentum',
    color: '#059669',
    desc: 'Positive day with elevated volume — early pullback candidate',
    filter: r => r.rvol != null && r.rvol > 1 && r.changePercent != null && r.changePercent > 0 && r.changePercent < 5,
  },
  {
    id: 'trend_day',
    label: 'Trend Day',
    fullLabel: 'Trend Day Continuation',
    group: 'Momentum',
    color: '#7c3aed',
    desc: 'Strong up move >1.5% with elevated volume (>1.3x)',
    filter: r => r.changePercent != null && r.changePercent > 1.5 && r.rvol != null && r.rvol > 1.3,
  },

  // ── II. Reversal / Reclaim ─────────────────────────────────────────────────
  {
    id: 'vwap_reclaim',
    label: 'VWAP Reclaim',
    fullLabel: 'VWAP Reclaim',
    group: 'Reversal',
    color: '#d97706',
    desc: 'Positive session with above-average participation',
    filter: r => r.changePercent != null && r.changePercent > 0 && r.rvol != null && r.rvol > 1.2,
  },
  {
    id: 'double_bottom',
    label: 'Dbl Bottom',
    fullLabel: 'Double Bottom / Higher Low',
    group: 'Reversal',
    color: '#be185d',
    desc: 'Oversold (RSI<35) but turning positive today',
    filter: r => r.rsi14 != null && r.rsi14 < 35 && r.changePercent != null && r.changePercent > 0,
  },
  {
    id: 'red_green',
    label: 'Red-to-Green',
    fullLabel: 'Red-to-Green Move',
    group: 'Reversal',
    color: '#16a34a',
    desc: 'Gapped down but showing positive momentum reversal',
    filter: r => r.rvol != null && r.rvol > 1.5 && r.gapPercent != null && r.gapPercent < 0 && r.changePercent != null && r.changePercent > -2,
  },

  // ── III. Expansion / Compression ──────────────────────────────────────────
  {
    id: 'vol_expansion',
    label: 'Vol Expansion',
    fullLabel: 'Volatility Expansion Break',
    group: 'Expansion',
    color: '#ea580c',
    desc: 'Very high volume (>2x) with large price move >3%',
    filter: r => r.rvol != null && r.rvol > 2 && r.changePercent != null && Math.abs(r.changePercent) > 3,
  },
  {
    id: 'ema_squeeze',
    label: 'EMA Squeeze',
    fullLabel: 'EMA Compression Squeeze',
    group: 'Expansion',
    color: '#8b5cf6',
    desc: 'Moderate volume (1-1.8x), tight price action <2% — coiling',
    filter: r => r.rvol != null && r.rvol >= 1 && r.rvol <= 1.8 && r.changePercent != null && Math.abs(r.changePercent) < 2,
  },

  // ── IV. Exhaustion / Backside ──────────────────────────────────────────────
  {
    id: 'blowoff',
    label: 'Blow-Off Top',
    fullLabel: 'Blow-Off Top (Exhaustion)',
    group: 'Exhaustion',
    color: '#dc2626',
    desc: 'Extreme up move >7% — potential exhaustion',
    filter: r => r.changePercent != null && r.changePercent > 7,
  },
  {
    id: 'breakdown',
    label: 'LH/LL Break',
    fullLabel: 'Lower High / Lower Low Breakdown',
    group: 'Exhaustion',
    color: '#991b1b',
    desc: 'Sharp sell-off >5% — breakdown candidate',
    filter: r => r.changePercent != null && r.changePercent < -5,
  },
  {
    id: 'liquidity_sweep',
    label: 'PDH/PDL Sweep',
    fullLabel: 'PDH/PDL Liquidity Sweep',
    group: 'Exhaustion',
    color: '#475569',
    desc: 'High volume (>1.5x) with significant move >2% either direction',
    filter: r => r.rvol != null && r.rvol > 1.5 && r.changePercent != null && Math.abs(r.changePercent) > 2,
  },
];

export { STRATEGIES };

export default function StrategyChips({ active, onSelect }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1">
      {STRATEGIES.map(s => {
        const isActive = active === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(isActive ? null : s.id)}
            title={`${s.fullLabel}: ${s.desc}`}
            className={`
              inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold
              transition-all duration-150 whitespace-nowrap
              ${isActive
                ? 'text-white shadow-sm'
                : 'border-[var(--border-color)] text-[var(--text-secondary)] bg-transparent hover:border-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }
            `}
            style={isActive ? { backgroundColor: s.color, borderColor: s.color } : {}}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
