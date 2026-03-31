"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Minus, TrendingUp } from "lucide-react";

import { apiGet } from "@/lib/api/client";
import { QUERY_POLICY } from "@/lib/queries/policy";
import { toFixedSafe, percentSafe } from "@/lib/number";
import {
  getPlaybookTier, playbookLabel, calcPositionSize,
  TIER_STYLE, TIER_ORDER, type PlaybookTier,
} from "@/lib/playbook";
import { getCachedMarketMode, type MarketMode } from "@/lib/marketMode";

// ─── Types ────────────────────────────────────────────────────────────────────

type TopFocusSignal = {
  rank: number;
  symbol: string;
  trade_score: number;
  regime_alignment: string;
  confidence: number;
  price: number;
  change_percent: number;
  relative_volume: number;
  why: string | null;
  consequence: string | null;
  plan: string | null;
  performance_note: string | null;
  regime_context: string | null;
  direction: "LONG" | "SHORT" | "NEUTRAL" | "UNKNOWN";
  entry: number | null;
  stop: number | null;
  target: number | null;
  updated_at: string;
};

type TopFocusResponse = {
  focus_mode: boolean;
  regime: {
    trend: string;
    volatility: string;
    liquidity: string;
    session: string;
  } | null;
  signals: TopFocusSignal[];
  meta: {
    total_evaluated: number;
    total_passed: number;
    total_filtered: number;
  };
};

type OverviewPayload = {
  indices?: Record<string, { symbol?: string; price?: number | string | null; change_percent?: number | string | null }>;
  volatility?: { VIX?: { price?: number | string | null } };
  breadth?: { advancers?: number; decliners?: number };
};

type EarningsItem = {
  symbol?: string;
  event_date?: string;
  report_date?: string;
  time?: string;
  report_time?: string;
  eps_estimate?: number | null;
  expected_move?: number | null;
};

type PrepSignal = {
  symbol: string;
  why: string | null;
  how_to_trade: string | null;
  consequence: string | null;
  confidence: number;
  expected_move: number | null;
  trade_score: number | null;
  trade_class: string | null;
  event_type: string | null;
  created_at: string;
};

type WatchlistRow = {
  symbol: string;
  price: number | null;
  change_percent: number | null;
  gap_percent: number | null;
  relative_volume: number | null;
  volume_ratio: number | null;
  news_count: number;
  earnings_flag: number;
  score: number;
  stage: string | null;
  updated_at: string;
  // Phase 4: session-aware premarket fields
  premarket_price: number | null;
  premarket_volume: number | null;
  premarket_gap: number | null;
  premarket_candles: number | null;
  premarket_data_quality: number | null;
  premarket_activity_score: number | null;
};

type WatchlistResponse = {
  success: boolean;
  count: number;
  data: WatchlistRow[];
};

type SimLiveResponse = {
  ok: boolean;
  active_count: number;
  simulated_pnl_today: number;
  win_rate_today: number | null;
  win_rate_7d: number | null;
  total_evaluated_today: number;
  total_evaluated_7d: number;
  avg_return_today: number;
  avg_return_7d: number;
  best_setup: { setup: string; win_rate: number; total: number } | null;
  worst_setup: { setup: string; win_rate: number; total: number } | null;
};

type PrepResponse = {
  ok: boolean;
  market_mode: MarketMode;
  market_reason: string;
  data_window: string;
  last_session: string;
  top_signals: PrepSignal[];
  carryover: PrepSignal[];
  earnings: Array<{ symbol: string; report_date: string; report_time: string; eps_estimate: number }>;
  news_clusters: Array<{ id: number; headline: string; symbol: string; source: string; published_at: string; priority_score: number; catalyst_type: string }>;
  meta: { signals_count: number; carryover_count: number; earnings_count: number; news_count: number };
};

function modeBadgeClass(mode: MarketMode) {
  if (mode === "LIVE")   return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
  if (mode === "RECENT") return "text-amber-400 border-amber-500/40 bg-amber-500/10";
  return "text-slate-400 border-slate-600 bg-slate-800/40";
}

function modePulse(mode: MarketMode) {
  if (mode === "LIVE") return <span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-400 animate-pulse" />;
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function regimeBannerClass(trend: string) {
  if (trend === "BULL") return "border-emerald-500/25 bg-emerald-950/40";
  if (trend === "BEAR") return "border-rose-500/25 bg-rose-950/40";
  return "border-yellow-500/25 bg-yellow-950/30";
}

function regimeTrendClass(trend: string) {
  if (trend === "BULL") return "text-emerald-400";
  if (trend === "BEAR") return "text-rose-400";
  return "text-yellow-400";
}

function regimeBadgeClass(trend: string) {
  if (trend === "BULL") return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
  if (trend === "BEAR") return "text-rose-400 border-rose-500/30 bg-rose-500/10";
  return "text-yellow-400 border-yellow-500/30 bg-yellow-500/10";
}

function alignmentDot(alignment: string) {
  if (alignment === "ALIGNED")    return "bg-emerald-400";
  if (alignment === "PARTIAL")    return "bg-yellow-400";
  if (alignment === "MISALIGNED") return "bg-rose-400";
  return "bg-slate-500";
}

function directionChip(direction: string) {
  if (direction === "LONG")  return <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">LONG</span>;
  if (direction === "SHORT") return <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">SHORT</span>;
  return <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">NEUTRAL</span>;
}

function signalDirective(signal: TopFocusSignal): string {
  const cons = (signal.consequence ?? "").trim();
  if (cons && cons.toLowerCase() !== "no edge" && cons.length > 5) return cons;
  const dir = signal.direction === "LONG" ? "Long" : signal.direction === "SHORT" ? "Short" : "Neutral";
  return `${dir} bias`;
}

function ChangeTag({ value }: { value: number }) {
  if (!Number.isFinite(value)) return null;
  if (value > 0) return (
    <span className="flex items-center gap-0.5 text-emerald-400 text-xs font-medium">
      <ArrowUp className="size-3" />{percentSafe(value, 2)}
    </span>
  );
  if (value < 0) return (
    <span className="flex items-center gap-0.5 text-rose-400 text-xs font-medium">
      <ArrowDown className="size-3" />{percentSafe(Math.abs(value), 2)}
    </span>
  );
  return <span className="flex items-center gap-0.5 text-slate-400 text-xs"><Minus className="size-3" />0.00%</span>;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function OpportunityCard({ signal, tier, onClick }: {
  signal: TopFocusSignal;
  tier: PlaybookTier;
  onClick: () => void;
}) {
  const quality    = signal.trade_score ?? 0;
  const directive  = signalDirective(signal);
  const ts         = TIER_STYLE[tier];
  const pos        = calcPositionSize(signal.entry, signal.stop);

  return (
    <article
      onClick={onClick}
      className={`cursor-pointer rounded-xl border bg-slate-900/50 p-4 transition hover:bg-slate-900 ${ts.border}`}
    >
      {/* Playbook tier — top row, dominant */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-400 text-[11px]">#{signal.rank}</span>
          <span className="font-bold text-slate-100 text-sm">{signal.symbol}</span>
          {directionChip(signal.direction)}
        </div>
        <div className="text-right shrink-0">
          <div className={`text-3xl font-black tabular-nums ${ts.text}`}>{tier}</div>
          <div className={`text-[9px] uppercase tracking-widest font-semibold mt-0.5 ${ts.text} opacity-60`}>
            {quality}/100
          </div>
        </div>
      </div>

      {/* Playbook action */}
      <div className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider mb-2 ${ts.badge}`}>
        {playbookLabel(tier)}
      </div>

      {/* Directive */}
      <div className="text-xs text-slate-300 leading-snug mb-3 line-clamp-2">{directive}</div>

      {/* Stats row */}
      <div className="flex items-center gap-3 mb-2">
        <ChangeTag value={signal.change_percent} />
        {signal.relative_volume > 0 && (
          <span className="text-[11px] text-slate-500">{toFixedSafe(signal.relative_volume, 1)}x vol</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full shrink-0 ${alignmentDot(signal.regime_alignment)}`} />
          <span className="text-[10px] text-slate-500">{signal.regime_alignment}</span>
        </div>
      </div>

      {/* Execution levels */}
      {(signal.entry || signal.stop || signal.target) && (
        <div className="grid grid-cols-3 gap-1 text-center text-[11px] mb-2">
          <div className="rounded bg-slate-800/60 py-1">
            <div className="text-slate-500">Entry</div>
            <div className="text-slate-200">{signal.entry ? `$${toFixedSafe(signal.entry, 2)}` : "—"}</div>
          </div>
          <div className="rounded bg-slate-800/60 py-1">
            <div className="text-slate-500">Stop</div>
            <div className="text-rose-300">{signal.stop ? `$${toFixedSafe(signal.stop, 2)}` : "—"}</div>
          </div>
          <div className="rounded bg-slate-800/60 py-1">
            <div className="text-slate-500">Target</div>
            <div className="text-emerald-300">{signal.target ? `$${toFixedSafe(signal.target, 2)}` : "—"}</div>
          </div>
        </div>
      )}

      {/* Position size */}
      {pos && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-[10px] text-slate-500 flex items-center justify-between">
          <span>£10 risk · {pos.shares} shares</span>
          <span className="font-mono">${pos.positionValue.toLocaleString()} exposure</span>
        </div>
      )}

      {signal.performance_note && (
        <div className="mt-1.5 text-[10px] text-slate-600">{signal.performance_note}</div>
      )}
    </article>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export function DashboardView() {
  const router   = useRouter();
  const modeInfo = getCachedMarketMode();

  const focusQuery = useQuery({
    queryKey: ["dashboard", "top-focus"],
    queryFn: () => apiGet<TopFocusResponse>("/api/intelligence/top-focus?limit=3"),
    ...QUERY_POLICY.fast,
  });

  // PREP fallback — always fetched so RECENT/PREP mode shows data instantly
  const prepQuery = useQuery({
    queryKey: ["dashboard", "prep"],
    queryFn: () => apiGet<PrepResponse>("/api/intelligence/prep"),
    ...QUERY_POLICY.medium,
    enabled: modeInfo.mode !== "LIVE",
  });

  const overviewQuery = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: () => apiGet<OverviewPayload>("/api/market/overview").catch(() => ({} as OverviewPayload)),
    ...QUERY_POLICY.fast,
  });

  const newsQuery = useQuery({
    queryKey: ["dashboard", "news"],
    queryFn: () => apiGet<{ data?: Array<{ symbol?: string; headline?: string; source?: string; created_at?: string }> }>("/api/catalysts?limit=10").catch(() => ({ data: [] })),
    ...QUERY_POLICY.medium,
  });

  const earningsQuery = useQuery({
    queryKey: ["dashboard", "earnings-today"],
    queryFn: () => {
      const today = new Date().toISOString().slice(0, 10);
      return apiGet<{ data?: EarningsItem[] } | EarningsItem[]>(
        `/api/earnings/calendar?from=${today}&to=${today}`
      ).catch(() => ({ data: [] }));
    },
    ...QUERY_POLICY.slow,
  });

  const watchlistQuery = useQuery({
    queryKey: ["dashboard", "premarket-watchlist"],
    queryFn: () => apiGet<WatchlistResponse>("/api/premarket/watchlist?limit=20").catch(() => ({ success: false, count: 0, data: [] })),
    ...QUERY_POLICY.medium,
  });

  const simQuery = useQuery({
    queryKey: ["dashboard", "sim-live"],
    queryFn: () => apiGet<SimLiveResponse>("/api/simulation/live").catch(() => ({ ok: false } as SimLiveResponse)),
    ...QUERY_POLICY.slow,
  });

  const signals = focusQuery.data?.signals ?? [];
  const regime  = focusQuery.data?.regime  ?? null;
  const meta    = focusQuery.data?.meta;
  const prepData = prepQuery.data;
  const watchlist = watchlistQuery.data?.data ?? [];
  const indices = overviewQuery.data?.indices ?? {};
  const vixKey = Object.keys(overviewQuery.data?.volatility ?? {}).find((k) => k.toUpperCase().includes("VIX")) ?? "";
  const vix = vixKey ? toNum((overviewQuery.data?.volatility as Record<string, { price?: unknown }>)?.[vixKey]?.price, NaN) : NaN;
  const news = Array.isArray(newsQuery.data?.data) ? newsQuery.data.data : [];
  const earningsRaw = Array.isArray(earningsQuery.data) ? earningsQuery.data : (earningsQuery.data as { data?: EarningsItem[] })?.data ?? [];

  return (
    <div className="space-y-5">

      {/* ── Market Mode + Regime Banner ── */}
      <section className={`rounded-xl border px-5 py-4 ${regime ? regimeBannerClass(regime.trend) : "border-slate-800 bg-slate-900/40"}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            {/* MODE badge — always visible */}
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold tracking-widest ${modeBadgeClass(modeInfo.mode)}`}>
              {modePulse(modeInfo.mode)}{modeInfo.mode}
            </span>
            <span className="text-[11px] text-slate-500">{modeInfo.reason}</span>
            {regime && (
              <>
                <div className="h-3 w-px bg-slate-700" />
                <div className="flex items-center gap-2">
                  <TrendingUp className="size-4 text-slate-500" />
                  <span className="text-xs uppercase tracking-widest text-slate-500">Regime</span>
                </div>
                <span className={`text-xl font-black tracking-tight ${regimeTrendClass(regime.trend)}`}>
                  {regime.trend}
                </span>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${regimeBadgeClass(regime.trend)}`}>
                    {regime.volatility} VOL
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs text-slate-400">
                    {regime.liquidity} LIQ
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs text-slate-400">
                    {regime.session}
                  </span>
                </div>
              </>
            )}
          </div>
          {meta && (
            <span className="text-[11px] text-slate-500">
              {meta.total_passed} signals · {meta.total_filtered} filtered
            </span>
          )}
        </div>
      </section>

      {/* ── Market Overview Row ── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(indices).slice(0, 3).map(([ticker, row]) => {
          const price = toNum((row as { price?: unknown })?.price, NaN);
          const cp = toNum((row as { change_percent?: unknown })?.change_percent, NaN);
          return (
            <div key={ticker} className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2.5">
              <div className="text-[11px] uppercase text-slate-500">{ticker}</div>
              <div className="mt-0.5 font-semibold text-slate-100">
                {Number.isFinite(price) ? `$${toFixedSafe(price, 2)}` : "—"}
              </div>
              <ChangeTag value={cp} />
            </div>
          );
        })}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2.5">
          <div className="text-[11px] uppercase text-slate-500">VIX</div>
          <div className="mt-0.5 font-semibold text-slate-100">
            {Number.isFinite(vix) ? toFixedSafe(vix, 2) : "—"}
          </div>
          {overviewQuery.data?.breadth && (
            <div className="mt-0.5 text-[11px] text-slate-500">
              {overviewQuery.data.breadth.advancers}A / {overviewQuery.data.breadth.decliners}D
            </div>
          )}
        </div>
      </section>

      {/* ── KPI Row ── */}
      <section className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">High Conviction</div>
          <div className="mt-1 text-2xl font-black text-emerald-400 tabular-nums">
            {signals.filter(s => s.trade_score >= 70).length}
          </div>
          <div className="text-[11px] text-slate-600">setups ≥ 70 score</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">News (24h)</div>
          <div className="mt-1 text-2xl font-black text-blue-400 tabular-nums">
            {news.length}
          </div>
          <div className="text-[11px] text-slate-600">catalyst articles</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Earnings Today</div>
          <div className="mt-1 text-2xl font-black text-amber-400 tabular-nums">
            {earningsRaw.length}
          </div>
          <div className="text-[11px] text-slate-600">reports scheduled</div>
        </div>
      </section>

      {/* ── Main content grid ── */}
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">

        {/* Left: Top Opportunities */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {modeInfo.mode === "LIVE" ? "Best Setups Today" : modeInfo.mode === "RECENT" ? "Recent Setups" : "Prep Watchlist"}
            </h2>
            <div className="flex items-center gap-2">
              {(focusQuery.isLoading || prepQuery.isLoading) && (
                <span className="text-[11px] text-slate-600">Loading...</span>
              )}
              {prepData?.data_window && modeInfo.mode !== "LIVE" && (
                <span className="text-[10px] text-slate-600">{prepData.data_window} window</span>
              )}
            </div>
          </div>

          {/* Live signals — always try first */}
          {signals.length > 0 ? (() => {
            const scored = signals.map(sig => ({
              sig,
              tier: getPlaybookTier(
                sig.trade_score ?? 0,
                sig.confidence ?? sig.trade_score ?? 0,
                sig.regime_alignment === "ALIGNED",
              ),
              quality: sig.trade_score ?? 0,
            }));
            const eliteFirst = [...scored].sort(
              (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.quality - a.quality
            );
            const elite = eliteFirst.filter(x => x.tier === "A+" || x.tier === "A");
            const display = elite.length > 0 ? elite.slice(0, 3) : eliteFirst.slice(0, 1);
            return (
              <>
                {elite.length === 0 && (
                  <p className="mb-2 text-[11px] text-slate-600">
                    No A+/A setups right now — showing best available
                  </p>
                )}
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {display.map(({ sig, tier }) => (
                    <OpportunityCard
                      key={sig.symbol}
                      signal={sig}
                      tier={tier}
                      onClick={() => router.push(`/research/${sig.symbol}`)}
                    />
                  ))}
                </div>
                {eliteFirst.length > display.length && (
                  <div className="mt-3 text-right">
                    <Link
                      href="/stocks-in-play"
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 transition"
                    >
                      +{eliteFirst.length - display.length} more setups in Stocks In Play →
                    </Link>
                  </div>
                )}
              </>
            );
          })()

          /* PREP/RECENT fallback — show signals from wider window */
          : !focusQuery.isLoading && prepData?.top_signals && prepData.top_signals.length > 0 ? (
            <>
              <p className="mb-2 text-[11px] text-slate-500">
                {modeInfo.mode === "LIVE"
                  ? "No LIVE signals — showing recent data"
                  : `No LIVE signals — showing ${modeInfo.mode} opportunities (${prepData.data_window})`}
              </p>
              <div className="space-y-2">
                {prepData.top_signals.slice(0, 5).map((sig) => (
                  <div
                    key={sig.symbol}
                    onClick={() => router.push(`/research/${sig.symbol}`)}
                    className="cursor-pointer rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 hover:bg-slate-900 transition flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-slate-100 text-sm">{sig.symbol}</span>
                        {sig.trade_class && (
                          <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">{sig.trade_class}</span>
                        )}
                        {sig.event_type && (
                          <span className="rounded bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-400">{sig.event_type}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-2">{sig.why ?? "Signal candidate"}</p>
                      {sig.consequence && (
                        <p className="mt-0.5 text-[11px] text-slate-600 line-clamp-1">{sig.consequence}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-lg font-black tabular-nums text-slate-200">{sig.confidence ?? "—"}</div>
                      <div className="text-[10px] text-slate-600">conf</div>
                    </div>
                  </div>
                ))}
              </div>
            </>

          /* Loading skeletons */
          ) : focusQuery.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-44 animate-pulse rounded-xl border border-slate-800 bg-slate-900/30" />
              ))}
            </div>

          /* Genuine empty — no data at all */
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-6 text-center">
              <p className="text-sm text-slate-500 mb-1">
                {modeInfo.mode === "PREP"
                  ? "PREP MODE — building watchlist for next open"
                  : "No signals scored yet"}
              </p>
              <p className="text-[11px] text-slate-600 mb-4">{modeInfo.reason}</p>
              <Link
                href="/stocks-in-play"
                className="inline-block rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-700 transition"
              >
                Browse all opportunities →
              </Link>
            </div>
          )}
        </section>

        {/* Right: News + Earnings */}
        <div className="space-y-4">

          {/* News highlights */}
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              News Highlights
            </h2>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {news.slice(0, 8).map((item, i) => (
                <div
                  key={`${String(item.symbol)}-${i}`}
                  className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                >
                  <div className="flex items-center gap-1.5">
                    {item.symbol && (
                      <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-slate-200">
                        {item.symbol}
                      </span>
                    )}
                    {item.created_at && (
                      <span className="text-[10px] text-slate-600">
                        {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400 line-clamp-2">
                    {item.headline}
                  </div>
                </div>
              ))}
              {news.length === 0 && !newsQuery.isLoading && (
                <div className="rounded-lg border border-slate-800 px-3 py-3 text-xs text-slate-600">
                  No news in last 24h
                </div>
              )}
            </div>
          </section>

          {/* Earnings today / upcoming */}
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {earningsRaw.length > 0 ? "Earnings Today" : "Earnings Upcoming"}
            </h2>
            {(() => {
              const displayEarnings = earningsRaw.length > 0
                ? earningsRaw
                : (prepData?.earnings ?? []).map(e => ({
                    symbol: e.symbol,
                    report_date: e.report_date,
                    time: e.report_time,
                    eps_estimate: e.eps_estimate,
                  } as EarningsItem));
              return displayEarnings.length > 0 ? (
                <div className="space-y-1">
                  {displayEarnings.slice(0, 6).map((row, i) => (
                    <div key={`${String(row.symbol)}-${i}`} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs">
                      <span className="font-semibold text-slate-200">{row.symbol}</span>
                      <div className="flex items-center gap-2 text-slate-500">
                        <span>{row.time ?? row.report_time ?? "—"}</span>
                        {row.report_date && <span className="text-slate-600">{new Date(row.report_date).toLocaleDateString([], { month: "short", day: "numeric" })}</span>}
                        {row.expected_move != null && (
                          <span className="text-yellow-400">±{toFixedSafe(row.expected_move, 1)}%</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-slate-800 px-3 py-3 text-xs text-slate-600">
                  No earnings in next 3 days
                </div>
              );
            })()}
          </section>
        </div>
      </div>

      {/* ── Premarket Watchlist ── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Premarket Watchlist</h2>
          {watchlistQuery.isLoading && <span className="text-[11px] text-slate-600">Loading...</span>}
          {watchlist.length > 0 && <span className="text-[11px] text-slate-600">{watchlist.length} symbols</span>}
        </div>
        {watchlist.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left">Symbol</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2 text-right">PM Price</th>
                  <th className="px-3 py-2 text-right">PM Gap%</th>
                  <th className="px-3 py-2 text-right">PM Volume</th>
                  <th className="px-3 py-2 text-right">RVOL</th>
                  <th className="px-3 py-2 text-right">News</th>
                  <th className="px-3 py-2 text-center">Quality</th>
                  <th className="px-3 py-2 text-center">Earnings</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((row) => {
                  const pmGap  = row.premarket_gap  ?? row.gap_percent;
                  const pmVol  = row.premarket_volume;
                  const pmQual = row.premarket_data_quality;
                  const qualCls = pmQual == null
                    ? "bg-slate-700/60 text-slate-500"
                    : pmQual >= 80 ? "bg-emerald-500/20 text-emerald-400"
                    : pmQual >= 50 ? "bg-amber-500/20 text-amber-400"
                    : "bg-red-500/20 text-red-400";
                  return (
                    <tr
                      key={row.symbol}
                      onClick={() => router.push(`/research/${row.symbol}`)}
                      className="cursor-pointer border-b border-slate-800/50 transition hover:bg-slate-800/40 last:border-0"
                    >
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-100">{row.symbol}</div>
                        {row.stage && (
                          <div className={`text-[9px] font-bold uppercase ${row.stage === 'ACTIVE' ? "text-emerald-500" : row.stage === 'EARLY' ? "text-blue-400" : "text-slate-600"}`}>
                            {row.stage}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={`font-bold tabular-nums ${row.score >= 70 ? "text-emerald-400" : row.score >= 45 ? "text-amber-400" : "text-slate-400"}`}>
                          {row.score}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                        {row.premarket_price != null ? `$${toNum(row.premarket_price).toFixed(2)}` : <span className="text-slate-600">—</span>}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${toNum(pmGap) > 0 ? "text-emerald-400" : toNum(pmGap) < 0 ? "text-rose-400" : "text-slate-500"}`}>
                        {pmGap != null ? `${toNum(pmGap) > 0 ? "+" : ""}${toNum(pmGap).toFixed(2)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                        {pmVol != null && pmVol > 0
                          ? pmVol >= 1_000_000 ? `${(pmVol / 1_000_000).toFixed(1)}M`
                          : pmVol >= 1_000 ? `${(pmVol / 1_000).toFixed(0)}K`
                          : String(pmVol)
                          : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                        {row.relative_volume != null ? `${toNum(row.relative_volume).toFixed(1)}x` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-blue-400">
                        {row.news_count > 0 ? row.news_count : <span className="text-slate-600">0</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {pmQual != null ? (
                          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${qualCls}`}>
                            {pmQual}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-600">N/A</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.earnings_flag === 1 ? (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">EPS</span>
                        ) : (
                          <span className="text-slate-700">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : !watchlistQuery.isLoading ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-4 text-xs text-slate-600">
            Premarket data unavailable — session engine runs every 10 min
          </div>
        ) : null}
      </section>

      {/* ── System Performance ── */}
      <section>
        <h2 className="mb-2 text-[11px] uppercase tracking-widest text-slate-500">System Performance</h2>
        {simQuery.data?.ok ? (() => {
          const sim = simQuery.data!;
          const wrToday = sim.win_rate_today;
          const wr7d    = sim.win_rate_7d;
          const wrClass = (wr: number | null) =>
            wr == null ? "text-slate-500"
            : wr >= 60  ? "text-emerald-400"
            : wr >= 40  ? "text-amber-400"
            : "text-rose-400";
          const avgRetClass = (v: number) =>
            v > 0 ? "text-emerald-400" : v < 0 ? "text-rose-400" : "text-slate-400";
          return (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Win Rate Today</div>
                <div className={`mt-1 text-2xl font-black tabular-nums ${wrClass(wrToday)}`}>
                  {wrToday != null ? `${wrToday}%` : "—"}
                </div>
                <div className="text-[11px] text-slate-600">{sim.total_evaluated_today} signals</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Win Rate 7d</div>
                <div className={`mt-1 text-2xl font-black tabular-nums ${wrClass(wr7d)}`}>
                  {wr7d != null ? `${wr7d}%` : "—"}
                </div>
                <div className="text-[11px] text-slate-600">{sim.total_evaluated_7d} signals</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Avg Return</div>
                <div className={`mt-1 text-2xl font-black tabular-nums ${avgRetClass(sim.avg_return_today)}`}>
                  {Number.isFinite(sim.avg_return_today) ? `${sim.avg_return_today > 0 ? "+" : ""}${sim.avg_return_today.toFixed(2)}%` : "—"}
                </div>
                <div className="text-[11px] text-slate-600">today per signal</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Best Setup</div>
                <div className="mt-1 text-sm font-bold text-slate-100 truncate">
                  {sim.best_setup?.setup ?? "—"}
                </div>
                {sim.best_setup && (
                  <div className="text-[11px] text-emerald-400">{sim.best_setup.win_rate}% win ({sim.best_setup.total})</div>
                )}
              </div>
            </div>
          );
        })() : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-4 text-xs text-slate-600">
            Performance data unavailable — evaluation engine runs every 5 min
          </div>
        )}
      </section>
    </div>
  );
}
