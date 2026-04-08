"use client";

// ── types ──────────────────────────────────────────────────────────────────────

export type ExpectedMoveBarProps = {
  /** Current market price (reference midpoint) */
  currentPrice: number;
  /** Expected move as a percentage, e.g. 3.5 = ±3.5% */
  expectedMovePercent: number;
  /**
   * Today's change percent — used to compute where the dot sits inside the
   * range and to determine glow colour.  Optional; if absent the dot is
   * centred and neutral.
   */
  changePct?: number;
};

// ── helpers ────────────────────────────────────────────────────────────────────

function fmt2(n: number) {
  return n >= 1000 ? n.toFixed(0) : n.toFixed(2);
}

// ── component ─────────────────────────────────────────────────────────────────

/**
 * TradingView-style expected-move bar.
 *
 * Visual:
 *   $LOW [────────────●────────────] $HIGH
 *
 * The dot represents where today's price sits inside the ±expectedMove range.
 * Glow colour indicates directional bias:
 *   near upper bound → green   (bullish momentum)
 *   near lower bound → red     (bearish momentum)
 *   middle           → neutral grey
 */
export function ExpectedMoveBar({ currentPrice, expectedMovePercent, changePct = 0 }: ExpectedMoveBarProps) {
  const em = Math.max(0.1, Math.abs(expectedMovePercent));

  // Range computed from a reference price (where price was before today's move)
  // so the dot actually moves as the stock moves.
  const refPrice = changePct !== 0
    ? currentPrice / (1 + changePct / 100)
    : currentPrice;

  const lower = refPrice * (1 - em / 100);
  const upper = refPrice * (1 + em / 100);

  // Position of current price within the range [0, 1], clamped for display
  const rangeSpan = upper - lower;
  const rawPos    = rangeSpan > 0 ? (currentPrice - lower) / rangeSpan : 0.5;
  const pos       = Math.min(1, Math.max(0, rawPos));          // display position
  const posLeft   = `${(pos * 100).toFixed(1)}%`;

  // Dot has broken outside the expected range
  const isAbove = rawPos > 1;
  const isBelow = rawPos < 0;
  const isBreaking = isAbove || isBelow;

  // Colour zones
  const isNearUpper = pos > 0.65;
  const isNearLower = pos < 0.35;

  const dotGlow   = isNearUpper ? "shadow-[0_0_6px_2px_rgba(34,197,94,0.45)]"  // green
                  : isNearLower ? "shadow-[0_0_6px_2px_rgba(239,68,68,0.45)]"   // red
                  :               "shadow-[0_0_4px_1px_rgba(148,163,184,0.25)]"; // grey

  const dotColor  = isNearUpper ? "bg-[var(--bull)]"
                  : isNearLower ? "bg-[var(--bear)]"
                  :               "bg-slate-400";

  const trackLeft  = "bg-[var(--bear)]/25";
  const trackRight = "bg-[var(--bull)]/25";

  // Warning state
  const withinRange = !isBreaking;
  const warningText = withinRange ? "Within expected range" : "Breaking expected range";
  const warningColor = withinRange
    ? "text-[var(--bull)]"
    : "text-[var(--bear)]";
  const warningDot = withinRange ? "bg-[var(--bull)]" : "bg-[var(--bear)]";

  return (
    <div>

      {/* ── Bar ─────────────────────────────────────────────────────────────── */}
      <div className="relative">

        {/* Price labels above */}
        <div className="flex justify-between items-center mb-2">
          <span className="text-[11px] font-mono text-[var(--bear)] tabular-nums">${fmt2(lower)}</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
            ±{em.toFixed(1)}%
          </span>
          <span className="text-[11px] font-mono text-[var(--bull)] tabular-nums">${fmt2(upper)}</span>
        </div>

        {/* Track */}
        <div className="relative h-2.5 rounded-full overflow-visible" style={{ background: "var(--muted)" }}>
          {/* Left (bear) zone */}
          <div className={`absolute inset-y-0 left-0 w-1/2 rounded-l-full ${trackLeft}`} />
          {/* Right (bull) zone */}
          <div className={`absolute inset-y-0 right-0 w-1/2 rounded-r-full ${trackRight}`} />
          {/* Centre tick */}
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-[var(--border)] opacity-60" />
          {/* Glow fill — subtle directional highlight */}
          {isNearUpper && (
            <div
              className="absolute inset-y-0 rounded-full bg-[var(--bull)]/15 transition-all duration-500"
              style={{ left: `${((0.5) * 100).toFixed(1)}%`, right: 0 }}
            />
          )}
          {isNearLower && (
            <div
              className="absolute inset-y-0 rounded-full bg-[var(--bear)]/15 transition-all duration-500"
              style={{ left: 0, right: `${((1 - 0.5) * 100).toFixed(1)}%` }}
            />
          )}
          {/* Dot */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-[var(--panel)] z-10 transition-all duration-500 ${dotColor} ${dotGlow}`}
            style={{ left: `calc(${posLeft} - 8px)` }}
          />
        </div>

        {/* Axis labels */}
        <div className="flex justify-between mt-1.5">
          <span className="text-[9px] uppercase tracking-widest text-[var(--muted-foreground)]">Down</span>
          <span className="text-[9px] uppercase tracking-widest text-[var(--muted-foreground)]">Flat</span>
          <span className="text-[9px] uppercase tracking-widest text-[var(--muted-foreground)]">Up</span>
        </div>
      </div>

      {/* ── Labels ──────────────────────────────────────────────────────────── */}
      <div className="mt-3 flex items-center justify-between">
        {/* Left: summary */}
        <div>
          <p className="text-[11px] text-[var(--muted-foreground)] leading-snug">
            Expected Move{" "}
            <span className="font-mono font-semibold text-[var(--foreground)]">±{em.toFixed(2)}%</span>
          </p>
          <p className="text-[11px] text-[var(--muted-foreground)] leading-snug">
            Range{" "}
            <span className="font-mono text-[var(--bear)]">${fmt2(lower)}</span>
            <span className="text-[var(--border)] mx-1">–</span>
            <span className="font-mono text-[var(--bull)]">${fmt2(upper)}</span>
          </p>
        </div>

        {/* Right: warning state */}
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${warningDot}`} />
          <span className={`text-[11px] font-semibold ${warningColor}`}>{warningText}</span>
        </div>
      </div>
    </div>
  );
}
