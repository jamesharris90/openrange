// Shared playbook utilities — derived entirely from existing system data

export type PlaybookTier = "A+" | "A" | "B" | "C";

/** Natural sort order: 0 = best */
export const TIER_ORDER: Record<PlaybookTier, number> = {
  "A+": 0,
  "A":  1,
  "B":  2,
  "C":  3,
};

export const PLAYBOOK_ACTION: Record<PlaybookTier, string> = {
  "A+": "Execute aggressively",
  "A":  "Execute with confirmation",
  "B":  "Watch / secondary setup",
  "C":  "Avoid",
};

// Border + text colour per tier — use directly in className
export const TIER_STYLE: Record<PlaybookTier, { badge: string; border: string; text: string }> = {
  "A+": {
    badge:  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    border: "border-emerald-500/25",
    text:   "text-emerald-400",
  },
  "A": {
    badge:  "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    border: "border-cyan-500/25",
    text:   "text-cyan-400",
  },
  "B": {
    badge:  "bg-amber-500/15 text-amber-400 border-amber-500/30",
    border: "border-amber-500/25",
    text:   "text-amber-400",
  },
  "C": {
    badge:  "bg-slate-700/50 text-slate-500 border-slate-700",
    border: "border-slate-700",
    text:   "text-slate-500",
  },
};

/**
 * Assign a playbook tier from normalised inputs.
 *
 * @param score          0–100 quality score (see computeSignalQuality / computeQualityScore)
 * @param confidence     0–100 confidence figure
 * @param regimeAligned  true when regime is confirmed "ALIGNED" (or proxy thereof)
 */
export function getPlaybookTier(
  score: number,
  confidence: number,
  regimeAligned: boolean,
): PlaybookTier {
  if (score >= 80 && confidence >= 75 && regimeAligned) return "A+";
  if (score >= 70) return "A";
  if (score >= 60) return "B";
  return "C";
}

/** Convenience label used in one-liners: "A+ — Execute aggressively" */
export function playbookLabel(tier: PlaybookTier): string {
  return `${tier} — ${PLAYBOOK_ACTION[tier]}`;
}

// ── Risk / position sizing ────────────────────────────────────────────────────

const MAX_RISK_GBP = 10;

export type PositionSize = {
  shares: number;
  positionValue: number; // shares × entry price (in the price currency)
  riskGbp: number;       // always MAX_RISK_GBP
  riskPerShare: number;
};

/**
 * Computes a position size that keeps risk at £10.
 * Prices are treated as USD (or whatever the quote currency is) for value display,
 * but the risk cap is always £10.
 */
export function calcPositionSize(
  entry: number | null | undefined,
  stop:  number | null | undefined,
): PositionSize | null {
  if (entry == null || stop == null) return null;
  const e = Number(entry);
  const s = Number(stop);
  if (!Number.isFinite(e) || !Number.isFinite(s) || e === s) return null;

  const riskPerShare = Math.abs(e - s);
  const rawShares    = MAX_RISK_GBP / riskPerShare;
  const shares       = Math.max(0, Math.floor(rawShares * 100) / 100); // 2dp, never negative

  return {
    shares,
    positionValue: Math.round(shares * e * 100) / 100,
    riskGbp:       MAX_RISK_GBP,
    riskPerShare:  Math.round(riskPerShare * 100) / 100,
  };
}
