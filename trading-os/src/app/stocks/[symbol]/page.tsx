"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ExpectedMoveBar } from "@/components/ExpectedMoveBar";
import { StockChart } from "@/components/StockChart";
import { getPlaybookTier, playbookLabel, calcPositionSize, TIER_STYLE } from "@/lib/playbook";

// ── types ─────────────────────────────────────────────────────────────────────

type EarningsEntry = {
  report_date: string;
  report_time: string | null;
  eps_estimate: number | null;
  eps_actual: number | null;
  rev_estimate: number | null;
  rev_actual: number | null;
  eps_surprise_pct: number | null;
  rev_surprise_pct: number | null;
  guidance: string | null;
};

type StockData = {
  symbol: string;
  price: number;
  change_percent: number;
  volume: number;
  avg_volume_30d: number | null;
  relative_volume: number | null;
  market_cap: number | null;
  sector: string | null;
  industry: string | null;
  company_name: string | null;
  exchange: string | null;
  updated_at: string | null;
  fundamentals: {
    eps_last: number | null;
    eps_est: number | null;
    revenue: number | null;
    pe: number | null;
    dividend_yield: number | null;
  };
  earnings: {
    next: {
      report_date: string;
      report_time: string | null;
      eps_estimate: number | null;
      rev_estimate: number | null;
    } | null;
    history: EarningsEntry[];
  };
  news: Array<{
    id: number | null;
    headline: string | null;
    source: string | null;
    url: string | null;
    published_at: string | null;
    summary: string | null;
    catalyst_type: string | null;
    news_score: number | null;
    sentiment: string | null;
  }>;
  options: {
    implied_volatility: number | null;
    expected_move_percent: number | null;
    put_call_ratio: number | null;
  };
};

// ── formatters ────────────────────────────────────────────────────────────────

const fmt = {
  price: (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return "—";
    return n >= 1000 ? `$${Number(n).toFixed(0)}` : `$${Number(n).toFixed(2)}`;
  },
  vol: (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const v = Number(n);
    if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (v >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6)  return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3)  return `${(v / 1e3).toFixed(0)}K`;
    return String(v);
  },
  mcap: (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const v = Number(n);
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
    return `$${v.toLocaleString()}`;
  },
  rvol: (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    return `${Number(n).toFixed(2)}x`;
  },
  eps: (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    return `$${Number(n).toFixed(2)}`;
  },
  pct: (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const v = Number(n);
    return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
  },
  date: (d: string | null | undefined) => {
    if (!d) return "—";
    return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  },
  ago: (d: string | null | undefined) => {
    if (!d) return "";
    const ms = Date.now() - new Date(d).getTime();
    const h = Math.floor(ms / 3_600_000);
    if (h < 1) return `${Math.floor(ms / 60_000)}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  },
};

// ── helpers ───────────────────────────────────────────────────────────────────

function sentimentFromKeywords(headline: string | null | undefined): "bullish" | "bearish" | "neutral" {
  if (!headline) return "neutral";
  const h = headline.toLowerCase();
  const bull = ["beat", "surge", "jump", "soar", "rally", "gain", "upgrade", "record", "profit", "growth", "rise", "strong", "exceed", "outperform", "positive"];
  const bear = ["miss", "drop", "fall", "crash", "decline", "cut", "downgrade", "loss", "weak", "disappoint", "below", "concern", "risk", "warning", "down"];
  const b = bull.filter(w => h.includes(w)).length;
  const r = bear.filter(w => h.includes(w)).length;
  return b > r ? "bullish" : r > b ? "bearish" : "neutral";
}

function normaliseTime(t: unknown): "BMO" | "AMC" | "TNS" | "TBD" {
  const s = String(t ?? "").toUpperCase();
  if (s.includes("BMO") || s.includes("PRE") || s.includes("BEFORE")) return "BMO";
  if (s.includes("AMC") || s.includes("AFTER")) return "AMC";
  if (s.includes("TNS")) return "TNS";
  return "TBD";
}

function ivLabel(iv: number | null): { label: "HIGH" | "NORMAL" | "LOW"; color: string } {
  if (iv == null) return { label: "LOW", color: "text-[var(--muted-foreground)]" };
  if (iv > 0.6)  return { label: "HIGH",   color: "text-[var(--bear)]" };
  if (iv >= 0.3) return { label: "NORMAL", color: "text-amber-500" };
  return             { label: "LOW",    color: "text-[var(--muted-foreground)]" };
}

// ── small UI components ───────────────────────────────────────────────────────

function Badge({ children, variant }: { children: React.ReactNode; variant: "bull" | "bear" | "amber" | "cyan" | "muted" | "blue" | "green" }) {
  const cls: Record<string, string> = {
    bull:  "bg-[var(--bull)]/15 text-[var(--bull)] border-[var(--bull)]/30",
    bear:  "bg-[var(--bear)]/15 text-[var(--bear)] border-[var(--bear)]/30",
    amber: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    cyan:  "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    muted: "bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)]",
    blue:  "bg-blue-500/15 text-blue-400 border-blue-500/30",
    green: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide border ${cls[variant]}`}>
      {children}
    </span>
  );
}

function StatPill({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">{label}</span>
      <span className="mt-0.5 text-sm font-mono tabular-nums text-[var(--foreground)] leading-tight">{value}</span>
    </div>
  );
}

// R:R visual bar ──────────────────────────────────────────────────────────────

function RRBar({ entry, stop, target, isBullish }: { entry: number; stop: number; target: number; isBullish: boolean }) {
  const risk   = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const total  = risk + reward;
  if (total === 0) return null;
  const riskW   = (risk   / total) * 100;
  const rewardW = (reward / total) * 100;
  const rr      = reward / risk;

  return (
    <div className="space-y-1.5 mt-3">
      {/* Bar */}
      <div className="flex h-3 rounded overflow-hidden gap-px">
        <div className="rounded-l bg-[var(--bear)]/55 transition-all" style={{ width: `${riskW}%` }} />
        <div className="w-px bg-[var(--foreground)]/60 shrink-0" />
        <div className="rounded-r bg-[var(--bull)]/55 transition-all" style={{ width: `${rewardW}%` }} />
      </div>
      {/* Labels row */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[var(--bear)] font-mono">{fmt.price(stop)}</span>
        <span className={`font-mono font-bold tabular-nums ${rr >= 2 ? "text-[var(--bull)]" : rr >= 1 ? "text-amber-400" : "text-[var(--bear)]"}`}>
          {rr.toFixed(1)}R
        </span>
        <span className="text-[var(--bull)] font-mono">{fmt.price(target)}</span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
        <span>Stop</span>
        <span className="text-[var(--foreground)]">{isBullish ? "Long" : "Short"} @ {fmt.price(entry)}</span>
        <span>Target</span>
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function StockPage() {
  const params = useParams();
  const symbol = String(params?.symbol ?? "").toUpperCase();

  const [stockData, setStockData] = useState<StockData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setError(false);

    fetch(`/api/stocks/${symbol}`, { cache: "no-store" })
      .then(r => r.json())
      .then(json => {
        if (json?.success && json.symbol) {
          setStockData(json as StockData);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [symbol]);

  // ── derived ──────────────────────────────────────────────────────────────────

  const chg    = stockData?.change_percent ?? 0;
  const rv     = Number(stockData?.relative_volume ?? 0);
  const vol    = Number(stockData?.volume ?? 0);
  const avg    = Number(stockData?.avg_volume_30d ?? 0);
  const absChg = Math.abs(chg);

  const nextEarnings    = stockData?.earnings.next    ?? null;
  const earningsHistory = stockData?.earnings.history ?? [];

  // News filtered to last 48h, newest first
  const recentNews = useMemo(() => {
    const cutoff = Date.now() - 48 * 3_600_000;
    return (stockData?.news ?? []).filter(a => {
      if (!a.published_at) return false;
      return new Date(a.published_at).getTime() >= cutoff;
    }).sort((a, b) => new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime());
  }, [stockData]);

  const expectedMove = useMemo(() => {
    const opt = stockData?.options?.expected_move_percent;
    if (opt != null && Number.isFinite(opt)) return Math.abs(opt);
    if (absChg > 0) return Math.max(0.5, absChg);
    return null;
  }, [stockData, absChg]);

  const catalystLabel = useMemo(() => {
    if (rv > 3 && recentNews.length > 0) return "NEWS + VOLUME";
    if (recentNews.length > 0)           return "NEWS";
    if (nextEarnings != null)            return "EARNINGS";
    if (rv > 2)                          return "UNUSUAL VOLUME";
    return null;
  }, [rv, recentNews.length, nextEarnings]);

  // ── trade structure ──────────────────────────────────────────────────────────
  const tradeStructure = useMemo(() => {
    if (!stockData?.price || expectedMove == null) return null;

    const price     = stockData.price;
    const em        = expectedMove;
    const changePct = chg;
    const rvol      = rv;

    const refPrice  = changePct !== 0 ? price / (1 + changePct / 100) : price;
    const lower     = refPrice * (1 - em / 100);
    const upper     = refPrice * (1 + em / 100);
    const rangeSpan = upper - lower;
    const rawPos    = rangeSpan > 0 ? (price - lower) / rangeSpan : 0.5;

    type PositionState = "EXTENDED_UP" | "EXTENDED_DOWN" | "MID_RANGE";
    const positionState: PositionState =
      rawPos > 1 ? "EXTENDED_UP" : rawPos < 0 ? "EXTENDED_DOWN" : "MID_RANGE";

    type MomentumTier = "STRONG_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "STRONG_BEARISH";
    const momentumTier: MomentumTier =
      changePct >  5 ? "STRONG_BULLISH" :
      changePct >  2 ? "BULLISH" :
      changePct < -5 ? "STRONG_BEARISH" :
      changePct < -2 ? "BEARISH" :
      "NEUTRAL";

    type LiquidityTier = "HIGH" | "NORMAL" | "LOW";
    const liquidityTier: LiquidityTier =
      rvol > 1.5 ? "HIGH" : rvol >= 0.8 ? "NORMAL" : "LOW";

    type Bias = "Bullish" | "Bearish" | "Neutral";
    const bias: Bias =
      momentumTier === "STRONG_BULLISH" || momentumTier === "BULLISH" ? "Bullish" :
      momentumTier === "STRONG_BEARISH" || momentumTier === "BEARISH" ? "Bearish" :
      "Neutral";

    return { positionState, momentumTier, liquidityTier, bias, em, rawPos };
  }, [stockData, expectedMove, chg, rv]);

  // ── market intelligence (sharp, actionable copy) ─────────────────────────────
  const marketIntelligence = useMemo(() => {
    type Variant = "bull" | "bear" | "amber" | "muted";
    const pos   = tradeStructure?.positionState;
    const mcap  = Number(stockData?.market_cap ?? 0);
    const first = recentNews[0]?.headline ?? null;
    const clip  = (s: string, n = 80) => s.length > n ? s.slice(0, n) + "…" : s;

    // ── Why is it moving ────────────────────────────────────────────────────
    let whyValue: string, whySub: string, whyVariant: Variant;
    if (!stockData) {
      whyValue = "No data"; whySub = ""; whyVariant = "muted";
    } else if (absChg > 5 && rv > 2) {
      whyValue = chg > 0
        ? "Confirmed breakout — price surge with volume behind it"
        : "Confirmed breakdown — heavy selling with volume";
      whyVariant = chg > 0 ? "bull" : "bear";
      whySub = first ? `Catalyst: ${clip(first)}` : "No news catalyst found";
    } else if (absChg > 3 && rv > 1.5) {
      whyValue = chg > 0
        ? "Strong move, volume expanding — buyers in control"
        : "Strong selling, volume expanding — sellers in control";
      whyVariant = chg > 0 ? "bull" : "bear";
      whySub = first ? clip(first) : "No news catalyst";
    } else if (absChg > 2 && rv <= 1.5) {
      whyValue = chg > 0
        ? "Price up but volume lagging — move not yet confirmed"
        : "Selling pressure, no volume expansion — weak move";
      whyVariant = chg > 0 ? "amber" : "bear";
      whySub = first ? clip(first) : "No news catalyst";
    } else if (rv > 2 && absChg < 1) {
      whyValue = "Volume surge without price — possible accumulation";
      whyVariant = "amber";
      whySub = first ? clip(first) : "No news catalyst";
    } else if (absChg < 1 && rv < 1) {
      whyValue = "Off radar — no price action or volume signal";
      whyVariant = "muted";
      whySub = "";
    } else {
      whyValue = chg > 0 ? "Mild bullish drift — no strong catalyst visible" : chg < 0 ? "Mild selling pressure — no strong catalyst" : "Flat — no edge";
      whyVariant = chg > 0 ? "amber" : chg < 0 ? "bear" : "muted";
      whySub = first ? clip(first) : "";
    }

    // ── Is it tradeable ─────────────────────────────────────────────────────
    let tradeableValue: string, tradeableSub: string, tradeableVariant: Variant;
    if (!stockData) {
      tradeableValue = "No data"; tradeableSub = ""; tradeableVariant = "muted";
    } else if (vol < 100_000) {
      tradeableValue = "Thin tape — wide spreads, avoid size";
      tradeableVariant = "bear";
      tradeableSub = `Only ${fmt.vol(vol)} shares today`;
    } else if (rv > 3 && vol > 1_000_000) {
      tradeableValue = `Highly in play — ${rv.toFixed(1)}x volume surge`;
      tradeableVariant = "bull";
      tradeableSub = "Elevated institutional interest possible";
    } else if (rv > 2) {
      tradeableValue = `In play — ${rv.toFixed(1)}x normal volume`;
      tradeableVariant = "amber";
      tradeableSub = `${fmt.vol(vol)} traded today`;
    } else if (vol > 1_000_000 && mcap > 2_000_000_000) {
      tradeableValue = "Liquid, large cap — clean entry/exit possible";
      tradeableVariant = "bull";
      tradeableSub = `${fmt.vol(vol)} vol · ${fmt.mcap(mcap)}`;
    } else if (vol > 500_000) {
      tradeableValue = "Adequate liquidity for standard size";
      tradeableVariant = "muted";
      tradeableSub = `${fmt.vol(vol)} traded`;
    } else {
      tradeableValue = "Low volume — reduce position size";
      tradeableVariant = "bear";
      tradeableSub = `${fmt.vol(vol)} traded`;
    }

    // ── How should it trade ──────────────────────────────────────────────────
    let howValue: string, howSub: string, howVariant: Variant;
    if (!stockData || expectedMove == null) {
      howValue = "Insufficient data"; howSub = ""; howVariant = "muted";
    } else if (absChg > expectedMove) {
      howValue = chg > 0
        ? "Outside expected range — chasing is low probability here"
        : "Below expected range — short squeeze risk, avoid new shorts";
      howVariant = "bear";
      howSub = `Move (${absChg.toFixed(1)}%) beyond expected ±${expectedMove.toFixed(1)}%`;
    } else if (pos === "MID_RANGE" && absChg < 1) {
      howValue = "Inside range, flat — no setup yet, wait for move";
      howVariant = "muted";
      howSub = `Within ±${expectedMove.toFixed(1)}% expected move`;
    } else if (pos === "MID_RANGE" && chg > 1) {
      howValue = "Building inside range — watch for breakout above resistance";
      howVariant = "bull";
      howSub = `Within ±${expectedMove.toFixed(1)}% expected move`;
    } else if (pos === "MID_RANGE" && chg < -1) {
      howValue = "Distributing inside range — watch for breakdown below support";
      howVariant = "bear";
      howSub = `Within ±${expectedMove.toFixed(1)}% expected move`;
    } else if (chg > 2) {
      howValue = "Upside momentum — pullback to VWAP/support offers entry";
      howVariant = "bull";
      howSub = `+${chg.toFixed(2)}% with room to ±${expectedMove.toFixed(1)}%`;
    } else if (chg < -2) {
      howValue = "Downside pressure — fade rallies into resistance";
      howVariant = "bear";
      howSub = `${chg.toFixed(2)}% with room to ±${expectedMove.toFixed(1)}%`;
    } else {
      howValue = "No clear directional edge — stand aside";
      howVariant = "muted"; howSub = "";
    }

    return {
      why:      { value: whyValue,       sub: whySub,       variant: whyVariant },
      tradeable:{ value: tradeableValue, sub: tradeableSub, variant: tradeableVariant },
      how:      { value: howValue,       sub: howSub,       variant: howVariant },
    };
  }, [stockData, chg, absChg, rv, vol, expectedMove, tradeStructure, recentNews]);

  // ── trade decision ───────────────────────────────────────────────────────────
  const tradeDecision = useMemo(() => {
    const price = stockData?.price;
    const em    = expectedMove;
    const pos   = tradeStructure?.positionState;

    type TradeClass = "A" | "B" | "C" | "UNTRADEABLE";
    let tradeClass: TradeClass;
    if (!stockData || em == null)        tradeClass = "UNTRADEABLE";
    else if (vol < 100_000)              tradeClass = "UNTRADEABLE";
    else if (rv > 2 && absChg >= 2 && absChg <= em) tradeClass = "A";
    else if (rv > 1.5)                   tradeClass = "B";
    else if (rv < 1)                     tradeClass = "C";
    else                                 tradeClass = "B";

    type SetupType = "Momentum Expansion" | "Breakout Extension" | "Breakdown Extension" | "Range" | "Exhaustion" | "—";
    let setupType: SetupType;
    if (!stockData || pos == null)                  setupType = "—";
    else if (chg > 0 && pos === "MID_RANGE")        setupType = "Momentum Expansion";
    else if (chg > 0 && pos === "EXTENDED_UP")      setupType = absChg < 2 ? "Exhaustion" : "Breakout Extension";
    else if (chg < 0 && pos === "EXTENDED_DOWN")    setupType = absChg < 2 ? "Exhaustion" : "Breakdown Extension";
    else if (pos === "MID_RANGE" && absChg < 1)     setupType = "Range";
    else if ((pos === "EXTENDED_UP" || pos === "EXTENDED_DOWN") && absChg < 2) setupType = "Exhaustion";
    else                                            setupType = "Range";

    // Execution plan
    let entry: number | null = null, stop: number | null = null, target: number | null = null, risk: number | null = null;
    if (price != null && em != null && chg !== 0) {
      const isBullish = chg > 0;
      entry = Math.round(price * 100) / 100;
      const stopDist = (em / 2 / 100) * entry;
      stop   = Math.round((isBullish ? entry - stopDist : entry + stopDist) * 100) / 100;
      risk   = Math.abs(entry - stop);
      target = Math.round((isBullish ? entry + 2 * risk : entry - 2 * risk) * 100) / 100;
    }

    // R:R
    const rr = (entry != null && stop != null && target != null && Math.abs(entry - stop) > 0)
      ? Math.abs(target - entry) / Math.abs(entry - stop)
      : null;

    // Setup label
    type SetupLabel = "GOOD SETUP" | "AVOID" | "WATCH";
    let setupLabel: SetupLabel;
    if (tradeClass === "UNTRADEABLE" || (rr != null && rr < 1)) setupLabel = "AVOID";
    else if ((tradeClass === "A" || tradeClass === "B") && rr != null && rr >= 2) setupLabel = "GOOD SETUP";
    else setupLabel = "WATCH";

    return { tradeClass, setupType, entry, stop, target, risk, rr, setupLabel };
  }, [stockData, chg, absChg, rv, vol, expectedMove, tradeStructure]);

  const CARD = "rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5";
  const SEC  = "text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-4";

  const Skeleton = ({ w = "w-24", h = "h-4" }: { w?: string; h?: string }) => (
    <div className={`${w} ${h} rounded bg-[var(--muted)] animate-pulse`} />
  );

  const isBullish = chg >= 0;

  // ── trade summary (Part 4) ────────────────────────────────────────────────────
  const tradeSummary = useMemo(() => {
    const cls = tradeDecision.tradeClass;
    // Confidence from trade class + rvol boost
    const baseConf: Record<string, number> = { A: 78, B: 62, C: 42, UNTRADEABLE: 15 };
    const rvolBonus = rv > 1 ? Math.min(15, (rv - 1) * 6) : 0;
    const conf = Math.min(95, Math.round((baseConf[cls] ?? 42) + rvolBonus));
    // Quality score: conf 40%, bias clarity 20%, rvol 20%, catalyst 20%
    const biasScore = absChg >= 3 ? 90 : absChg >= 1.5 ? 60 : 30;
    const rvolScore = Math.min(100, rv / 3 * 100);
    const catScore  = catalystLabel ? 70 : 30;
    const score = Math.round(conf * 0.40 + biasScore * 0.20 + rvolScore * 0.20 + catScore * 0.20);
    // Bias label
    const bias =
      absChg < 0.5       ? "NEUTRAL" as const :
      isBullish           ? "LONG"    as const :
                            "SHORT"   as const;
    const tier = getPlaybookTier(score, conf, cls === "A");
    const pos  = calcPositionSize(tradeDecision.entry, tradeDecision.stop);
    return { conf, score, bias, cls, tier, pos };
  }, [tradeDecision, rv, absChg, isBullish, catalystLabel]);

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-screen overflow-y-auto bg-[var(--background)]">

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-[var(--panel)] border-b border-[var(--border)]">
        <div className="px-6 pt-3 pb-0">
          <Link href="/screener" className="inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            ← Screener
          </Link>
        </div>

        <div className="px-6 py-4">
          {/* Row 1: logo + identity + price */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Logo */}
            <div className="w-9 h-9 rounded-lg overflow-hidden bg-[var(--muted)] shrink-0 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://img.logo.dev/ticker/${symbol}?size=64&format=png`}
                alt=""
                className="w-full h-full object-cover"
                onError={e => {
                  const el = e.currentTarget;
                  el.style.display = "none";
                  const p = el.parentElement;
                  if (p) p.innerHTML = `<span class="text-sm font-bold text-[var(--muted-foreground)]">${symbol.slice(0, 1)}</span>`;
                }}
              />
            </div>

            {/* Symbol + name */}
            <div className="flex flex-col min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)] font-mono leading-tight">{symbol}</h1>
              {stockData?.company_name && (
                <span className="text-[11px] text-[var(--muted-foreground)] truncate max-w-[220px]">{stockData.company_name}</span>
              )}
            </div>

            {/* Price + change */}
            {loading ? (
              <div className="flex items-center gap-2"><Skeleton w="w-24" h="h-7" /><Skeleton w="w-20" h="h-6" /></div>
            ) : stockData ? (
              <>
                <span className="text-2xl font-bold font-mono tabular-nums">{fmt.price(stockData.price)}</span>
                <span className={`px-2.5 py-0.5 rounded-md text-sm font-bold font-mono tabular-nums ${
                  chg > 0 ? "bg-[var(--bull)]/20 text-[var(--bull)]" :
                  chg < 0 ? "bg-[var(--bear)]/20 text-[var(--bear)]" :
                  "bg-[var(--muted)] text-[var(--muted-foreground)]"
                }`}>
                  {chg > 0 ? "+" : ""}{chg.toFixed(2)}%
                </span>
                {stockData.exchange && <Badge variant="muted">{stockData.exchange}</Badge>}
                {catalystLabel && (
                  <Badge variant={catalystLabel.includes("EARN") ? "amber" : catalystLabel.includes("VOLUME") ? "cyan" : "blue"}>
                    {catalystLabel}
                  </Badge>
                )}
                {/* Setup label in header */}
                {!loading && tradeDecision.setupLabel === "GOOD SETUP" && (
                  <Badge variant="green">GOOD SETUP</Badge>
                )}
                {!loading && tradeDecision.setupLabel === "AVOID" && (
                  <Badge variant="bear">AVOID</Badge>
                )}
              </>
            ) : error ? (
              <span className="text-sm text-[var(--muted-foreground)] opacity-60">{symbol} not found</span>
            ) : null}
          </div>

          {/* Row 2: stat pills */}
          {!loading && stockData && (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              <StatPill label="Mkt Cap"  value={fmt.mcap(stockData.market_cap)} />
              <StatPill label="Volume"   value={fmt.vol(stockData.volume)} />
              <StatPill label="Avg Vol"  value={fmt.vol(stockData.avg_volume_30d)} />
              <StatPill label="Rel Vol"  value={
                <span className={rv >= 2 ? "text-amber-500" : ""}>{fmt.rvol(stockData.relative_volume)}</span>
              } />
              {stockData.sector   && <StatPill label="Sector"   value={<span className="text-[var(--muted-foreground)]">{stockData.sector}</span>} />}
              {stockData.industry && <StatPill label="Industry" value={<span className="text-[var(--muted-foreground)] text-[11px]">{stockData.industry}</span>} />}
            </div>
          )}
        </div>
      </div>

      {/* ── TRADE SUMMARY ──────────────────────────────────────────────────── */}
      {!loading && stockData && (
        <div className="px-6 py-3 border-b border-[var(--border)] bg-[var(--background)]">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)]">Trade Summary</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Bias */}
              <div className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 ${
                tradeSummary.bias === "LONG"    ? "border-emerald-500/30 bg-emerald-950/40" :
                tradeSummary.bias === "SHORT"   ? "border-rose-500/30 bg-rose-950/40" :
                                                  "border-slate-700 bg-slate-900/40"
              }`}>
                <span className="text-[10px] uppercase tracking-widest text-slate-500">Bias</span>
                <span className={`text-sm font-black tracking-wide ${
                  tradeSummary.bias === "LONG"  ? "text-emerald-400" :
                  tradeSummary.bias === "SHORT" ? "text-rose-400" :
                                                  "text-slate-400"
                }`}>{tradeSummary.bias}</span>
              </div>
              {/* Setup */}
              <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 mr-1.5">Setup</span>
                <span className="text-xs font-semibold text-slate-300">{tradeDecision.setupType}</span>
              </div>
              {/* Confidence */}
              <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 mr-1.5">Confidence</span>
                <span className={`text-xs font-bold tabular-nums ${
                  tradeSummary.conf >= 70 ? "text-emerald-400" :
                  tradeSummary.conf >= 50 ? "text-amber-400"   : "text-slate-500"
                }`}>{tradeSummary.conf}%</span>
              </div>
              {/* Score */}
              <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 mr-1.5">Score</span>
                <span className={`text-xs font-black tabular-nums font-mono ${
                  tradeSummary.score >= 70 ? "text-emerald-400" :
                  tradeSummary.score >= 50 ? "text-amber-400"   : "text-slate-500"
                }`}>{tradeSummary.score}<span className="text-slate-600">/100</span></span>
              </div>
              {/* Setup label chip */}
              <div className={`rounded-lg border px-3 py-1.5 ml-auto ${
                tradeDecision.setupLabel === "GOOD SETUP" ? "border-emerald-500/30 bg-emerald-950/40 text-emerald-400" :
                tradeDecision.setupLabel === "AVOID"      ? "border-rose-500/30 bg-rose-950/40 text-rose-400" :
                                                            "border-amber-500/30 bg-amber-950/40 text-amber-400"
              }`}>
                <span className="text-xs font-bold tracking-wide">{tradeDecision.setupLabel}</span>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              {/* Playbook decision */}
              <div className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${TIER_STYLE[tradeSummary.tier].badge}`}>
                {playbookLabel(tradeSummary.tier)}
              </div>
              {/* Position size */}
              {tradeSummary.pos && (
                <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-[11px] text-slate-400">
                  <span className="text-slate-500">£10 risk ·</span>{" "}
                  <span className="font-mono font-semibold text-slate-300">{tradeSummary.pos.shares} shares</span>
                  <span className="text-slate-600"> · ${tradeSummary.pos.positionValue.toLocaleString()} exposure</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CONTENT ────────────────────────────────────────────────────────── */}
      <div className="flex-1 px-6 py-5 space-y-4 max-w-7xl mx-auto w-full">

        {/* ROW 1 — Chart */}
        <div className={CARD + " !p-0 overflow-hidden"}>
          {loading ? (
            <div className="w-full bg-[var(--muted)] animate-pulse" style={{ height: 300 }} />
          ) : (
            <StockChart
              symbol={symbol}
              currentPrice={stockData?.price}
              changePct={stockData?.change_percent}
            />
          )}
        </div>

        {/* ROW 2 — Expected Move + Options Context */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Expected Move */}
          <div className={CARD}>
            <p className={SEC}>Expected Move</p>
            {loading ? (
              <div className="space-y-3"><Skeleton w="w-full" h="h-8" /><Skeleton w="w-3/4" h="h-4" /></div>
            ) : !stockData?.price || expectedMove == null ? (
              <p className="text-sm text-[var(--muted-foreground)]">Options data unavailable</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="text-3xl font-bold font-mono tabular-nums">±{expectedMove.toFixed(1)}%</p>
                    <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
                      Options imply ±{expectedMove.toFixed(1)}% move
                    </p>
                  </div>
                  <Badge variant={expectedMove > 8 ? "bear" : expectedMove > 4 ? "amber" : "muted"}>
                    {expectedMove > 8 ? "High Vol" : expectedMove > 4 ? "Elevated" : "Normal"}
                  </Badge>
                </div>
                <ExpectedMoveBar
                  currentPrice={stockData.price}
                  expectedMovePercent={expectedMove}
                  changePct={stockData.change_percent}
                />
              </div>
            )}
          </div>

          {/* Options & Volatility — cleaner */}
          <div className={CARD}>
            <p className={SEC}>Options Context</p>
            {loading ? (
              <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} w="w-full" h="h-8" />)}</div>
            ) : !stockData?.options ? (
              <p className="text-sm text-[var(--muted-foreground)]">No options data</p>
            ) : (
              <div className="space-y-1">
                {/* IV row */}
                <div className="flex items-center justify-between py-2.5 border-b border-[var(--border)]">
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Implied Volatility</p>
                    <p className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5">Annualised, mean near-term</p>
                  </div>
                  <div className="text-right">
                    {stockData.options.implied_volatility != null ? (() => {
                      const iv = stockData.options.implied_volatility;
                      const { label, color } = ivLabel(iv);
                      return (
                        <>
                          <p className={`text-sm font-mono font-bold tabular-nums ${color}`}>
                            {(iv * 100).toFixed(1)}%
                          </p>
                          <p className={`text-[10px] font-semibold tracking-wide ${color}`}>{label}</p>
                        </>
                      );
                    })() : (
                      <p className="text-sm font-mono text-[var(--muted-foreground)]">—</p>
                    )}
                  </div>
                </div>

                {/* PCR row */}
                <div className="flex items-center justify-between py-2.5 border-b border-[var(--border)]">
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Put / Call Ratio</p>
                    <p className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5">
                      {stockData.options.put_call_ratio != null
                        ? stockData.options.put_call_ratio > 1.2 ? "Bearish skew"
                          : stockData.options.put_call_ratio < 0.8 ? "Bullish skew"
                          : "Neutral skew"
                        : "Near-term contracts"}
                    </p>
                  </div>
                  <p className={`text-sm font-mono font-bold tabular-nums ${
                    (stockData.options.put_call_ratio ?? 1) > 1.2 ? "text-[var(--bear)]"
                    : (stockData.options.put_call_ratio ?? 1) < 0.8 ? "text-[var(--bull)]"
                    : "text-[var(--foreground)]"
                  }`}>
                    {stockData.options.put_call_ratio != null ? stockData.options.put_call_ratio.toFixed(2) : "—"}
                  </p>
                </div>

                {/* Volume vs avg */}
                <div className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Volume vs 30d Avg</p>
                    <p className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5">
                      {vol > avg * 1.5 ? "Above average — elevated" : vol < avg * 0.5 ? "Below average — quiet" : "Normal range"}
                    </p>
                  </div>
                  <p className={`text-sm font-mono font-bold tabular-nums ${avg > 0 && vol > avg * 1.5 ? "text-amber-500" : ""}`}>
                    {avg > 0 ? `${((vol / avg) * 100).toFixed(0)}%` : "—"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ROW 3 — Market Intelligence */}
        {!loading && (
          <div className={CARD}>
            <p className={SEC}>Market Intelligence</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {([
                { title: "Why Is It Moving",    item: marketIntelligence.why },
                { title: "Is It Tradeable",     item: marketIntelligence.tradeable },
                { title: "How To Trade It",     item: marketIntelligence.how },
              ] as const).map(({ title, item }) => {
                const cfg = {
                  bull:  { bg: "bg-[var(--bull)]/8 border-[var(--bull)]/20",  dot: "bg-[var(--bull)]",  text: "text-[var(--bull)]" },
                  bear:  { bg: "bg-[var(--bear)]/8 border-[var(--bear)]/20",  dot: "bg-[var(--bear)]",  text: "text-[var(--bear)]" },
                  amber: { bg: "bg-amber-500/8 border-amber-500/20",           dot: "bg-amber-500",       text: "text-amber-400" },
                  muted: { bg: "bg-[var(--muted)]/40 border-[var(--border)]", dot: "bg-slate-500",       text: "text-[var(--foreground)]" },
                }[item.variant];
                return (
                  <div key={title} className={`rounded-xl border px-4 py-3.5 ${cfg.bg}`}>
                    <p className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] mb-2">{title}</p>
                    <div className="flex items-start gap-2">
                      <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                      <span className={`text-sm font-semibold leading-snug ${cfg.text}`}>{item.value}</span>
                    </div>
                    {item.sub && (
                      <p className="mt-2 text-[11px] text-[var(--muted-foreground)] leading-relaxed pl-3.5">{item.sub}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ROW 4 — Trade Decision */}
        {!loading && (
          <div className={CARD}>
            {/* Header row with setup label */}
            <div className="flex items-center justify-between mb-4">
              <p className={`${SEC} mb-0`}>Trade Decision</p>
              {(() => {
                const { setupLabel } = tradeDecision;
                const cfg = {
                  "GOOD SETUP": { bg: "bg-[var(--bull)]/15 border-[var(--bull)]/30 text-[var(--bull)]", icon: "✓" },
                  "AVOID":      { bg: "bg-[var(--bear)]/15 border-[var(--bear)]/30 text-[var(--bear)]", icon: "✗" },
                  "WATCH":      { bg: "bg-amber-500/15 border-amber-500/30 text-amber-400",              icon: "~" },
                }[setupLabel];
                return (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold tracking-wide ${cfg.bg}`}>
                    <span>{cfg.icon}</span>
                    {setupLabel}
                  </span>
                );
              })()}
            </div>

            {tradeDecision.tradeClass === "UNTRADEABLE" && !stockData ? (
              <p className="text-sm text-[var(--muted-foreground)]">Not enough data</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">

                {/* Class + setup */}
                {(() => {
                  const classCfg = {
                    A:          { bg: "bg-[var(--bull)]/10 border-[var(--bull)]/25", text: "text-[var(--bull)]",   dot: "bg-[var(--bull)]",   label: "Prime setup" },
                    B:          { bg: "bg-amber-500/10 border-amber-500/25",          text: "text-amber-400",       dot: "bg-amber-500",        label: "Valid setup" },
                    C:          { bg: "bg-[var(--muted)] border-[var(--border)]",     text: "text-[var(--muted-foreground)]", dot: "bg-slate-500", label: "Low conviction" },
                    UNTRADEABLE:{ bg: "bg-[var(--bear)]/10 border-[var(--bear)]/25", text: "text-[var(--bear)]",   dot: "bg-[var(--bear)]",   label: "Skip" },
                  }[tradeDecision.tradeClass];
                  return (
                    <div className={`rounded-xl border px-4 py-3.5 ${classCfg.bg}`}>
                      <p className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] mb-2">Trade Class</p>
                      <div className="flex items-center gap-2.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${classCfg.dot}`} />
                        <span className={`text-2xl font-black font-mono ${classCfg.text}`}>{tradeDecision.tradeClass}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{classCfg.label}</p>
                      <p className="mt-3 text-xs font-semibold text-[var(--foreground)]">{tradeDecision.setupType}</p>
                      <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                        {tradeDecision.setupType === "Momentum Expansion"  ? "Price building inside range" :
                         tradeDecision.setupType === "Breakout Extension"  ? "Price pushed above upper range" :
                         tradeDecision.setupType === "Breakdown Extension" ? "Price pushed below lower range" :
                         tradeDecision.setupType === "Exhaustion"          ? "Extended move losing momentum" :
                         tradeDecision.setupType === "Range"               ? "Contained within expected move" :
                         ""}
                      </p>
                    </div>
                  );
                })()}

                {/* R:R Visual */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-4 py-3.5">
                  <p className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] mb-1">Risk / Reward</p>
                  {tradeDecision.entry != null && tradeDecision.stop != null && tradeDecision.target != null && tradeDecision.rr != null ? (
                    <>
                      <div className="flex items-baseline gap-1.5 mb-0.5">
                        <span className={`text-2xl font-black font-mono tabular-nums ${tradeDecision.rr >= 2 ? "text-[var(--bull)]" : tradeDecision.rr >= 1 ? "text-amber-400" : "text-[var(--bear)]"}`}>
                          {tradeDecision.rr.toFixed(1)}R
                        </span>
                        <span className="text-[11px] text-[var(--muted-foreground)]">ratio</span>
                      </div>
                      <RRBar
                        entry={tradeDecision.entry}
                        stop={tradeDecision.stop}
                        target={tradeDecision.target}
                        isBullish={isBullish}
                      />
                    </>
                  ) : (
                    <p className="text-xs text-[var(--muted-foreground)] mt-2">No live price data</p>
                  )}
                </div>

                {/* Execution plan */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-4 py-3.5">
                  <p className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] mb-3">Execution</p>
                  {tradeDecision.entry == null ? (
                    <p className="text-xs text-[var(--muted-foreground)]">Insufficient data</p>
                  ) : (
                    <div className="space-y-2">
                      {([
                        { label: "Entry",  value: fmt.price(tradeDecision.entry),  color: "text-[var(--foreground)]",     dot: "bg-[var(--foreground)]/40" },
                        { label: "Stop",   value: fmt.price(tradeDecision.stop),   color: isBullish ? "text-[var(--bear)]" : "text-[var(--bull)]", dot: isBullish ? "bg-[var(--bear)]" : "bg-[var(--bull)]" },
                        { label: "Target", value: fmt.price(tradeDecision.target), color: isBullish ? "text-[var(--bull)]" : "text-[var(--bear)]", dot: isBullish ? "bg-[var(--bull)]" : "bg-[var(--bear)]" },
                        { label: "Risk $", value: tradeDecision.risk != null ? fmt.price(tradeDecision.risk) : "—", color: "text-[var(--muted-foreground)]", dot: "bg-[var(--muted-foreground)]/40" },
                      ] as const).map(({ label, value, color, dot }) => (
                        <div key={label} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                            <span className="text-[var(--muted-foreground)]">{label}</span>
                          </div>
                          <span className={`font-mono font-semibold tabular-nums ${color}`}>{value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        )}

        {/* ROW 5 — Earnings */}
        <div className={CARD}>
          <p className={SEC}>Earnings</p>
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><Skeleton w="w-full" h="h-28" /><Skeleton w="w-full" h="h-28" /></div>
          ) : !nextEarnings && earningsHistory.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No earnings data for {symbol}</p>
          ) : (
            <div className="space-y-4">
              {/* Next */}
              {nextEarnings && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)]">Next Report</p>
                    <Badge variant="amber">Upcoming</Badge>
                  </div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <p className="text-base font-semibold">{fmt.date(nextEarnings.report_date)}</p>
                    {nextEarnings.report_time && (
                      <span className={`text-sm font-mono font-semibold ${normaliseTime(nextEarnings.report_time) === "BMO" ? "text-amber-500" : normaliseTime(nextEarnings.report_time) === "AMC" ? "text-blue-400" : "text-[var(--muted-foreground)]"}`}>
                        {normaliseTime(nextEarnings.report_time)}
                      </span>
                    )}
                    {nextEarnings.eps_estimate != null && (
                      <span className="text-xs text-[var(--muted-foreground)]">EPS Est <span className="text-[var(--foreground)] font-mono font-semibold">{fmt.eps(nextEarnings.eps_estimate)}</span></span>
                    )}
                    {nextEarnings.rev_estimate != null && (
                      <span className="text-xs text-[var(--muted-foreground)]">Rev Est <span className="text-[var(--foreground)] font-mono font-semibold">{fmt.vol(nextEarnings.rev_estimate)}</span></span>
                    )}
                  </div>
                </div>
              )}

              {/* History */}
              {earningsHistory.length > 0 && (
                <div className="divide-y divide-[var(--border)]">
                  {earningsHistory.map((e, i) => {
                    const surp = e.eps_surprise_pct;
                    const beat = surp != null && surp >= 0;
                    return (
                      <div key={i} className="py-3 first:pt-0">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold">{fmt.date(e.report_date)}</span>
                            {e.report_time && <span className="text-[10px] font-mono text-[var(--muted-foreground)]">{normaliseTime(e.report_time)}</span>}
                          </div>
                          <div className="flex items-center gap-4 flex-wrap">
                            {e.eps_estimate != null && (
                              <div className="text-right">
                                <p className="text-[10px] text-[var(--muted-foreground)]">EPS Est</p>
                                <p className="text-xs font-mono">{fmt.eps(e.eps_estimate)}</p>
                              </div>
                            )}
                            {e.eps_actual != null && (
                              <div className="text-right">
                                <p className="text-[10px] text-[var(--muted-foreground)]">Actual</p>
                                <p className={`text-xs font-mono font-semibold ${beat ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>{fmt.eps(e.eps_actual)}</p>
                              </div>
                            )}
                            {surp != null && (
                              <Badge variant={beat ? "bull" : "bear"}>
                                {beat ? `BEAT +${surp.toFixed(1)}%` : `MISS ${surp.toFixed(1)}%`}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ROW 6 — Fundamentals (Finviz-style compact grid) */}
        <div className={CARD}>
          <p className={SEC}>Fundamentals</p>
          {loading ? (
            <div className="flex gap-6"><Skeleton w="w-24" h="h-10" /><Skeleton w="w-24" h="h-10" /><Skeleton w="w-24" h="h-10" /></div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-x-6 gap-y-4">
              {[
                { label: "Market Cap",  value: fmt.mcap(stockData?.market_cap) },
                { label: "Revenue",     value: stockData?.fundamentals?.revenue != null ? fmt.vol(stockData.fundamentals.revenue) : "—" },
                { label: "EPS (TTM)",   value: fmt.eps(stockData?.fundamentals?.eps_last) },
                { label: "EPS Est",     value: fmt.eps(stockData?.fundamentals?.eps_est) },
                { label: "P/E",         value: stockData?.fundamentals?.pe != null ? Number(stockData.fundamentals.pe).toFixed(1) : "—" },
                { label: "Sector",      value: stockData?.sector   ?? "—" },
                { label: "Industry",    value: stockData?.industry ?? "—" },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col min-w-0">
                  <span className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)]">{label}</span>
                  <span className="mt-1 text-xs font-mono font-semibold text-[var(--foreground)] leading-tight truncate" title={typeof value === "string" ? value : undefined}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ROW 7 — News (last 48h) */}
        <div className={CARD}>
          <div className="flex items-center justify-between mb-4">
            <p className={`${SEC} mb-0`}>Recent News</p>
            {recentNews.length > 0 && (
              <span className="text-[11px] text-[var(--muted-foreground)]">Last 48h · {recentNews.length} articles</span>
            )}
          </div>
          {loading ? (
            <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} w="w-full" h="h-14" />)}</div>
          ) : recentNews.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-[var(--muted-foreground)]">No recent catalysts</p>
              <p className="text-[11px] text-[var(--muted-foreground)]/50 mt-1">News ingests every 15 minutes</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {recentNews.map((article, i) => {
                const headline  = article.headline ?? "";
                const sentiment = article.sentiment ?? sentimentFromKeywords(headline);
                const sentVariant: "bull" | "bear" | "muted" =
                  sentiment === "bullish" ? "bull" : sentiment === "bearish" ? "bear" : "muted";
                return (
                  <div key={article.id ?? i} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        {article.url ? (
                          <a href={article.url} target="_blank" rel="noopener noreferrer"
                            className="text-sm text-[var(--foreground)] hover:text-blue-400 transition-colors leading-snug line-clamp-2 block">
                            {headline}
                          </a>
                        ) : (
                          <p className="text-sm text-[var(--foreground)] leading-snug line-clamp-2">{headline}</p>
                        )}
                        <div className="mt-1.5 flex items-center gap-2">
                          {article.source && <span className="text-[11px] text-[var(--muted-foreground)]">{article.source}</span>}
                          {article.source && article.published_at && <span className="text-[var(--border)] text-[11px]">·</span>}
                          {article.published_at && <span className="text-[11px] text-[var(--muted-foreground)]">{fmt.ago(article.published_at)}</span>}
                        </div>
                      </div>
                      <div className="shrink-0 pt-0.5">
                        <Badge variant={sentVariant}>
                          {sentiment === "bullish" ? "▲ Bull" : sentiment === "bearish" ? "▼ Bear" : "— Neutral"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
