/**
 * conditionClassifier.ts
 *
 * Reads snapshot data and surfaces condition tags.
 * Purely data-driven — no hardcoded strategy recommendations.
 * Describes what the market environment IS, not what to do.
 */

import type { MarketSession } from "./marketSession";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Condition = {
  label: string;
  color: string;
  description: string;
};

type IndexRow = {
  symbol: string;
  label?: string;
  price: number;
  changesPercentage: number;
};

type StockRow = {
  symbol: string;
  name?: string;
  price: number;
  changesPercentage: number;
  volume: number;
};

type Snapshot = {
  indices?: IndexRow[];
  active?: StockRow[];
  fear?: { value: number; valueClassification: string } | null;
  earnings?: Array<{ symbol: string; time?: string }>;
  sectors?: Array<{ sector: string; changesPercentage: number }>;
  gainers?: StockRow[];
  losers?: StockRow[];
};

// ── Classifier ────────────────────────────────────────────────────────────────

export function classifyConditions(
  snapshot: Snapshot,
  session: MarketSession
): Condition[] {
  const conditions: Condition[] = [];

  const indices = snapshot?.indices ?? [];
  const active = snapshot?.active ?? [];
  const fear = snapshot?.fear ?? null;
  const earnings = snapshot?.earnings ?? [];

  const vixRow = indices.find((i) => i.symbol === "VIX");
  const spyRow = indices.find((i) => i.symbol === "SPY");
  const vixPrice = vixRow?.price ?? 20;
  const spyChange = Math.abs(spyRow?.changesPercentage ?? 0);
  const spyDirection = (spyRow?.changesPercentage ?? 0);

  // ── VIX Regime ─────────────────────────────────────────────────────────────
  if (vixPrice < 14) {
    conditions.push({
      label: "ULTRA-LOW VOL",
      color: "#22d3ee",
      description:
        "Compressed ranges — mean reversion, tight stops, theta strategies viable. Directional setups need extra confirmation.",
    });
  } else if (vixPrice < 18) {
    conditions.push({
      label: "LOW VOL",
      color: "#22c55e",
      description:
        "Orderly tape — VWAP reversion, range scalps, and clean chart patterns tend to work reliably.",
    });
  } else if (vixPrice < 22) {
    conditions.push({
      label: "NORMAL VOL",
      color: "#eab308",
      description:
        "Balanced environment — momentum and mean reversion both viable. Standard risk parameters apply.",
    });
  } else if (vixPrice < 30) {
    conditions.push({
      label: "ELEVATED VOL",
      color: "#f97316",
      description:
        "Wider ranges and faster moves — reduce position size, expect more noise, directional conviction needed.",
    });
  } else {
    conditions.push({
      label: "CRISIS VOL",
      color: "#ef4444",
      description:
        "Extreme volatility — institutional hedging active, gaps are wide. Trade small if at all.",
    });
  }

  // ── Fear & Greed ────────────────────────────────────────────────────────────
  if (fear) {
    const fv = fear.value;
    if (fv <= 20) {
      conditions.push({
        label: "EXTREME FEAR",
        color: "#ef4444",
        description:
          "Market is extremely fearful — historically associated with contrarian bounce setups and capitulation bottoms.",
      });
    } else if (fv <= 35) {
      conditions.push({
        label: "FEAR",
        color: "#f97316",
        description:
          "Risk-off sentiment dominant — defensive rotation, lower beta, shorter time horizons.",
      });
    } else if (fv >= 80) {
      conditions.push({
        label: "EXTREME GREED",
        color: "#a855f7",
        description:
          "Market is extremely extended — reversal risk elevated, longs are crowded, mean reversion setups worth monitoring.",
      });
    } else if (fv >= 65) {
      conditions.push({
        label: "GREED",
        color: "#4a9eff",
        description:
          "Risk-on sentiment — momentum continuation favoured, dip-buyers active.",
      });
    } else {
      conditions.push({
        label: "NEUTRAL SENTIMENT",
        color: "#94a3b8",
        description:
          "Mixed market sentiment — no strong directional bias from fear/greed. Stock-specific catalysts matter more.",
      });
    }
  }

  // ── Index character (S&P 500 via SPY) ─────────────────────────────────────
  if (spyChange < 0.2) {
    conditions.push({
      label: "FLAT TAPE",
      color: "#64748b",
      description:
        "Index moving less than 0.2% — stock-specific catalysts dominate. No directional index bets.",
    });
  } else if (spyChange < 0.5) {
    conditions.push({
      label: "RANGE DAY",
      color: "#a3a3a3",
      description:
        "Modest index movement — VWAP levels act as magnets. Mean reversion plays tend to resolve faster.",
    });
  } else if (spyChange > 1.5) {
    conditions.push({
      label: "TREND DAY",
      color: spyDirection > 0 ? "#22c55e" : "#ef4444",
      description:
        spyDirection > 0
          ? "Strong upside tape — trend continuation setups are high-probability. Fading strength is dangerous."
          : "Strong downside tape — sellers in control. Short-side continuation setups in play.",
    });
  } else if (spyChange > 0.8) {
    conditions.push({
      label: "DIRECTIONAL",
      color: spyDirection > 0 ? "#4ade80" : "#f87171",
      description:
        spyDirection > 0
          ? "Meaningful upside move — lean with the trend, dips are shallow."
          : "Meaningful downside pressure — bounces are sell opportunities.",
    });
  }

  // ── Session context ─────────────────────────────────────────────────────────
  if (session.orbWindow) {
    conditions.push({
      label: "ORB WINDOW LIVE",
      color: "#f59e0b",
      description:
        "First 30 minutes — opening range is being established. Wait for the range to define before taking directional positions.",
    });
  }

  if (session.ukWindow) {
    conditions.push({
      label: "UK PRIME WINDOW",
      color: "#60a5fa",
      description:
        "UK traders are most active (2:30–4:00 PM BST) — liquidity tends to pick up around US open overlap.",
    });
  }

  if (session.phase === "powerhour") {
    conditions.push({
      label: "POWER HOUR",
      color: "#f97316",
      description:
        "Final hour — institutional rebalancing and index arbitrage can create fast moves. Gaps often fill or extend.",
    });
  }

  if (session.phase === "premarket") {
    conditions.push({
      label: "PRE-MARKET SCAN",
      color: "#8b5cf6",
      description:
        "Pre-market session — gaps are forming. Large pre-market movers set the watchlist for the open.",
    });
  }

  if (session.phase === "overnight") {
    conditions.push({
      label: "OVERNIGHT SESSION",
      color: "#475569",
      description:
        "Overnight — futures driving price discovery. Low liquidity; gaps may emerge by 4:00 AM ET.",
    });
  }

  if (session.phase === "afterhours") {
    conditions.push({
      label: "AFTER-HOURS",
      color: "#6366f1",
      description:
        "Extended hours — thin liquidity, earnings reactions often gap or reverse by the open.",
    });
  }

  // ── Volume concentration ────────────────────────────────────────────────────
  const topActive = active[0];
  if (topActive && topActive.volume > 80_000_000) {
    const top3 = active
      .slice(0, 3)
      .map((a) => a.symbol)
      .join(", ");
    conditions.push({
      label: "HEAVY FLOW",
      color: "#f59e0b",
      description: `Concentrated volume in ${top3} — institutional participation is significant in these names.`,
    });
  }

  // ── Earnings density ────────────────────────────────────────────────────────
  if (earnings.length > 15) {
    conditions.push({
      label: "EARNINGS SEASON",
      color: "#ec4899",
      description:
        "Peak earnings — binary event risk across many sectors. Single-stock volatility elevated; IV crush risk for options.",
    });
  } else if (earnings.length > 5) {
    conditions.push({
      label: "EARNINGS ACTIVE",
      color: "#f472b6",
      description:
        `${earnings.length} earnings reports today — sympathy moves and sector rotations likely around report times.`,
    });
  }

  return conditions;
}
