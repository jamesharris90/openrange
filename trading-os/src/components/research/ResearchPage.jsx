"use client";

import dynamic from "next/dynamic";
import { Suspense, startTransition, useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getResearchFullSnapshot, getResearchSnapshot } from "@/lib/api/research";
import { QUERY_POLICY } from "@/lib/queries/policy";
import { cn } from "@/lib/utils";

import CatalystPanel from "@/components/research/CatalystPanel";
import DataConfidenceBadge from "@/components/research/DataConfidenceBadge";
import { formatCurrency, formatPercent, toneFromChange } from "@/components/research/formatters";
import ResearchChartPanel from "@/components/research/ResearchChartPanel";
import ResearchDecisionPanel from "@/components/research/ResearchDecisionPanel";
import VerdictBar from "@/components/research/VerdictBar";

const WARMING_COPY = "—";

function coverageTone(score) {
  if (score >= 100) return { label: 'Coverage Complete', variant: 'success' };
  if (score >= 60) return { label: 'Coverage Partial', variant: 'accent' };
  return { label: 'Coverage Low', variant: 'danger' };
}

function buildCoverageMessages(coverage) {
  const messages = [];
  if (!coverage?.has_technicals) {
    messages.push('Technical indicator history is unavailable for this symbol. Chart overlays and derived technical reads may be incomplete until OHLC and indicator backfill finishes.');
  }
  if (!coverage?.has_news) {
    messages.push('Symbol-specific news is unavailable right now. Catalyst panels will show explicit no-data states instead of fallback content.');
  }
  if (!coverage?.has_earnings) {
    messages.push('Historical earnings data is unavailable for this symbol. Earnings analytics are shown as unavailable instead of blank placeholders.');
  }
  return messages;
}

const OverviewTab = dynamic(() => import("@/components/research/tabs/OverviewTab"), {
  ssr: false,
  loading: () => <TabPanelSkeleton />,
});

const FundamentalsTab = dynamic(() => import("@/components/research/tabs/FundamentalsTab"), {
  ssr: false,
  loading: () => <TabPanelSkeleton />,
});

const EarningsTab = dynamic(() => import("@/components/research/tabs/EarningsTab"), {
  ssr: false,
  loading: () => <TabPanelSkeleton />,
});

const FlowTab = dynamic(() => import("@/components/research/tabs/FlowTab"), {
  ssr: false,
  loading: () => <TabPanelSkeleton />,
});

const TechnicalTab = dynamic(() => import("@/components/research/tabs/TechnicalTab"), {
  ssr: false,
  loading: () => <TabPanelSkeleton />,
});

const EMPTY_SCANNER = {
  momentum_flow: {
    price: null,
    change_percent: null,
    gap_percent: null,
    relative_volume: null,
    volume: null,
    premarket_change_percent: null,
    premarket_volume: null,
    change_from_open_percent: null,
  },
  market_structure: {
    market_cap: null,
    float_shares: null,
    short_float_percent: null,
    avg_volume: null,
    spread_percent: null,
    shares_outstanding: null,
    sector: null,
    exchange: null,
  },
  technical: {
    rsi14: null,
    atr_percent: null,
    adr_percent: null,
    from_52w_high_percent: null,
    from_52w_low_percent: null,
    above_vwap: null,
    above_sma20: null,
    above_sma50: null,
    above_sma200: null,
    squeeze_setup: null,
    new_hod: null,
    beta: null,
  },
  catalyst_events: {
    days_to_earnings: null,
    earnings_surprise_percent: null,
    has_news_today: null,
    recent_insider_buy: null,
    recent_upgrade: null,
    recent_insider_buy_summary: null,
    recent_upgrade_summary: null,
    institutional_ownership_percent: null,
    insider_ownership_percent: null,
  },
  fundamentals: {
    pe: null,
    ps: null,
    eps_growth_percent: null,
    revenue_growth_percent: null,
    debt_equity: null,
    roe_percent: null,
    fcf_yield_percent: null,
    dividend_yield_percent: null,
  },
  options_flow: {
    iv_rank: null,
    put_call_ratio: null,
    options_volume: null,
    options_volume_vs_30d: null,
    net_premium: null,
    unusual_options: null,
  },
};

const TABS = [
  { id: "overview", label: "Overview", Component: OverviewTab },
  { id: "technical", label: "Technical", Component: TechnicalTab },
  { id: "fundamentals", label: "Fundamentals", Component: FundamentalsTab },
  { id: "earnings", label: "Earnings", Component: EarningsTab },
  { id: "flow", label: "Flow & Score", Component: FlowTab },
];

function toneClasses(tone) {
  if (tone === "positive") {
    return "text-emerald-300";
  }

  if (tone === "negative") {
    return "text-rose-300";
  }

  return "text-slate-100";
}

function MetaBadge({ meta }) {
  if (meta?.stale) {
    return <Badge variant="accent">Cached · Refreshing</Badge>;
  }

  if (meta?.cached) {
    return <Badge variant="success">Cached · Fresh</Badge>;
  }

  return <Badge variant="success">Live Fill</Badge>;
}

function StatTile({ label, value, tone = "neutral" }) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-2 text-xl font-semibold ${toneClasses(tone)}`}>{value}</div>
    </div>
  );
}

function TabPanelSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="h-48 animate-pulse rounded-3xl border border-slate-800/70 bg-slate-900/50" />
      <div className="h-48 animate-pulse rounded-3xl border border-slate-800/70 bg-slate-900/50" />
    </div>
  );
}

function ResearchSymbolLogo({ symbol }) {
  const normalized = String(symbol || "").trim().toUpperCase();

  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/80 shadow-[0_0_0_1px_rgba(15,23,42,0.35)]">
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tracking-[0.14em] text-slate-300">
        {normalized.slice(0, 2) || "--"}
      </span>
      {/* logo.dev is loaded directly here because this widget hides broken logos without requiring Next remote image config */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://img.logo.dev/ticker/${encodeURIComponent(normalized)}?size=96&format=png`}
        alt={`${normalized} logo`}
        className="absolute inset-0 h-full w-full object-cover"
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
      />
    </div>
  );
}

function ResearchSkeleton({ symbol }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_32%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.10),transparent_28%),#020617] px-4 py-6 md:px-6">
      <div className="w-full space-y-4">
        <div className="h-44 animate-pulse rounded-[2rem] border border-slate-800/70 bg-slate-900/50" />
        <div className="flex gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={`${symbol}-${index}`} className="h-10 w-24 animate-pulse rounded-full border border-slate-800/70 bg-slate-900/50" />
          ))}
        </div>
        <TabPanelSkeleton />
      </div>
    </div>
  );
}

function mapSnapshotToFullPayload(symbol, snapshot) {
  if (!snapshot?.data) {
    return null;
  }

  const source = snapshot?.meta?.source || "snapshot";
  const updatedAt = snapshot?.meta?.updated_at || null;

  return {
    success: true,
    profile: {
      symbol,
      company_name: null,
      sector: snapshot.data?.overview?.sector ?? null,
      industry: snapshot.data?.overview?.industry ?? null,
      exchange: snapshot.data?.overview?.exchange ?? null,
      country: snapshot.data?.overview?.country ?? null,
      website: null,
      description: null,
      updated_at: updatedAt,
      source,
    },
    price: {
      symbol,
      price: snapshot.data?.overview?.price ?? null,
      change_percent: snapshot.data?.overview?.change_percent ?? null,
      atr: null,
      updated_at: updatedAt,
      source,
    },
    fundamentals: {
      symbol,
      revenue_growth: snapshot.data?.fundamentals?.revenue_growth ?? null,
      eps_growth: snapshot.data?.fundamentals?.eps_growth ?? null,
      gross_margin: snapshot.data?.fundamentals?.margins?.gross_margin ?? null,
      net_margin: snapshot.data?.fundamentals?.margins?.net_margin ?? null,
      free_cash_flow: snapshot.data?.fundamentals?.cashflow?.free_cash_flow ?? null,
      trends: [],
      updated_at: updatedAt,
      source,
    },
    earnings: {
      symbol,
      next: {
        date: snapshot.data?.earnings?.next_date ?? null,
        eps_estimate: snapshot.data?.earnings?.eps_estimate ?? null,
        expected_move_percent: snapshot.data?.earnings?.expected_move ?? null,
      },
      history: [],
      updated_at: updatedAt,
      source,
    },
    earningsInsight: {
      beatRate: 0,
      missRate: 0,
      avgSurprise: 0,
      expectedMove: snapshot.data?.earnings?.expected_move ?? 0,
      tradeable: false,
    },
    ownership: snapshot.data?.ownership ?? {},
    decision: snapshot.decision ?? null,
    why_moving: snapshot.why_moving ?? null,
    data_confidence: snapshot.data_confidence ?? snapshot.data?.data_confidence ?? null,
    data_confidence_label: snapshot.data_confidence_label ?? snapshot.data?.data_confidence_label ?? null,
    context: snapshot.context ?? {},
    meta: {
      source,
      cached: Boolean(snapshot?.meta?.cached),
      stale: Boolean(snapshot?.meta?.stale),
      updated_at: updatedAt,
    },
  };
}

export default function ResearchPage({ symbol }) {
  const normalized = String(symbol || "").trim().toUpperCase();
  const [activeTab, setActiveTab] = useState("overview");
  const [chartInterval, setChartInterval] = useState("1day");
  const [indicatorHoverTime, setIndicatorHoverTime] = useState(null);
  const deferredTab = useDeferredValue(activeTab);

  const snapshotQuery = useQuery({
    queryKey: ["fast", "researchSnapshot", normalized],
    queryFn: () => getResearchSnapshot(normalized),
    enabled: Boolean(normalized),
    ...QUERY_POLICY.fast,
  });

  const fullQuery = useQuery({
    queryKey: ["slow", "researchFull", normalized],
    queryFn: () => getResearchFullSnapshot(normalized),
    enabled: Boolean(normalized),
    ...QUERY_POLICY.slow,
  });

  const fullPayload = fullQuery.data && fullQuery.data.success !== false ? fullQuery.data : null;
  const snapshotPayload = mapSnapshotToFullPayload(normalized, snapshotQuery.data && snapshotQuery.data.success ? snapshotQuery.data : null);
  const payload = fullPayload ?? snapshotPayload;
  const fullDataPending = !fullPayload;

  if ((fullQuery.isLoading || fullQuery.isPending) && !payload && !snapshotQuery.data) {
    return <ResearchSkeleton symbol={normalized} />;
  }

  const partial = fullDataPending || fullQuery.isError || fullQuery.data?.success === false;
  const safe = {
    profile: payload?.profile ?? {},
    price: payload?.price ?? {},
    fundamentals: payload?.fundamentals ?? {},
    earnings: payload?.earnings ?? { history: [], next: null },
    earningsInsight: payload?.earningsInsight ?? {
      beatRate: 0,
      missRate: 0,
      avgSurprise: 0,
      expectedMove: 0,
      tradeable: false,
    },
    earningsEdge: payload?.earnings?.edge ?? payload?.earningsEdge ?? {
      beat_rate: 0,
      avg_move: 0,
      avg_up_move: 0,
      avg_down_move: 0,
      directional_bias: "MIXED",
      consistency: 0,
      edge_score: 0,
      edge_label: "NO_EDGE",
      read: "No upcoming earnings scheduled.",
      sample_size: 0,
      earnings_pattern: [],
      beatRate: 0,
      missRate: 0,
      avgMove: 0,
      beatAvgMove: 0,
      avgUpMove: 0,
      avgDownMove: 0,
      directionalBias: "MIXED",
      consistencyScore: 0,
      edgeScore: 0,
      edgeLabel: "NO_EDGE",
      avgDrift1d: null,
      avgDrift3d: null,
      followThroughPercent: 0,
      reliabilityScore: 0,
      confidenceLabel: "LOW",
      earningsPattern: [],
    },
    tradeProbability: payload?.tradeProbability ?? {
      beatFollowThrough: 0,
      reliabilityScore: 0,
    },
    decision: payload?.decision ?? {
      symbol: normalized,
      tradeable: false,
      confidence: 20,
      setup: "NO_SETUP",
      bias: "NEUTRAL",
      driver: "NO_DRIVER",
      earnings_edge: {
        label: "NO_EDGE",
        score: 0,
        bias: "NEUTRAL",
      },
      risk_flags: ["LOW_CONVICTION", "NO_STRUCTURED_SETUP"],
      status: "AVOID",
      action: "AVOID",
      why: "No clean driver confirmed.",
      how: "Wait for a cleaner setup.",
      risk: "Avoid trading without confirmation.",
      narrative: {
        why_this_matters: "No clean catalyst or setup is confirmed right now.",
        what_to_do: "Wait for a clear driver, stronger volume, and a structured setup.",
        what_to_avoid: "Avoid forcing a trade into low-conviction conditions.",
      },
      execution_plan: null,
      source: "truth_engine",
    },
    why_moving: payload?.why_moving ?? {
      driver: 'NO_DRIVER',
      summary: 'No earnings within 48 hours, no high-impact news, RVOL is below 2.0, and no confirmed breakout or breakdown is present.',
      tradeability: 'LOW',
      confidence_score: 20,
      bias: 'NEUTRAL',
      what_to_do: 'DO NOT TRADE. Wait for a confirmed catalyst or RVOL above 2.0.',
      what_to_avoid: 'Do not build a position off low-volume drift or recycled headlines.',
      setup: 'No clean setup',
      action: 'WAIT',
      trade_plan: null,
    },
    ownership: payload?.ownership ?? {},
    indicators: payload?.indicators ?? {
      price: null,
      vwap: null,
      ema9: null,
      ema20: null,
      macd: { macd: null, signal: null, histogram: null, state: "neutral" },
      structure: { above_vwap: null, ema_trend: "neutral", macd_state: "neutral" },
      panels: { "1min": [], "5min": [], "1day": [] },
      updated_at: null,
    },
    coverage: payload?.coverage ?? {
      symbol: normalized,
      has_news: false,
      has_earnings: false,
      has_technicals: false,
      news_count: 0,
      earnings_count: 0,
      last_news_at: null,
      last_earnings_at: null,
      coverage_score: 0,
      status: 'LOW',
      tradeable: false,
      last_checked: null,
    },
    score: payload?.score ?? {
      final_score: 0,
      tqi: 0,
      tqi_label: 'D',
      coverage_score: Number(payload?.coverage?.coverage_score || 0),
      data_confidence: Number(payload?.data_confidence || 0),
      data_confidence_label: payload?.data_confidence_label || 'POOR',
      tradeable: false,
      updated_at: null,
    },
    scanner: payload?.scanner ?? EMPTY_SCANNER,
    data_confidence: Number(payload?.data_confidence || 0),
    data_confidence_label: payload?.data_confidence_label || 'POOR',
    freshness_score: Number(payload?.freshness_score || 0),
    source_quality: Number(payload?.source_quality || 0),
    context: payload?.context ?? {},
    meta: payload?.meta ?? {},
  };
  const research = {
    symbol: normalized,
    earnings: {
      next_date: safe.earnings?.next?.date ?? null,
    },
    ownership: safe.ownership,
  };
  const context = safe.context;
  const meta = safe.meta;
  const terminal = {
    profile: safe.profile,
    price: safe.price,
    fundamentals: safe.fundamentals,
    earnings: {
      ...safe.earnings,
      pattern: safe.earnings?.pattern ?? safe.earnings?.edge?.earnings_pattern ?? safe.earningsEdge?.earnings_pattern ?? [],
      edge: safe.earnings?.edge ?? safe.earningsEdge,
      read: safe.earnings?.read ?? safe.earningsEdge?.read ?? 'No upcoming earnings scheduled.',
    },
    earningsInsight: safe.earningsInsight,
    earningsEdge: safe.earningsEdge,
    tradeProbability: safe.tradeProbability,
    indicators: safe.indicators,
    coverage: safe.coverage,
    score: safe.score,
    scanner: safe.scanner,
    data_confidence: safe.data_confidence,
    data_confidence_label: safe.data_confidence_label,
    freshness_score: safe.freshness_score,
    source_quality: safe.source_quality,
    decision: safe.decision,
    why_moving: safe.why_moving,
    context: safe.context,
  };
  const activeConfig = TABS.find((tab) => tab.id === deferredTab) || TABS[0];
  const ActiveComponent = activeConfig.Component;
  const priceTone = toneFromChange(terminal.price?.change_percent);
  const companyName = String(terminal.profile?.company_name || "").trim();
  const coverageBadge = coverageTone(Number(terminal.coverage?.coverage_score || 0));
  const coverageMessages = buildCoverageMessages(terminal.coverage);
  const partialDescription = fullQuery.isError
    ? `Rendering cached and partial data for ${normalized}. The full research payload failed and can be retried.`
    : `Rendering the fast research snapshot for ${normalized} while the full terminal payload finishes loading.`;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_32%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.10),transparent_28%),linear-gradient(180deg,#020617_0%,#020817_60%,#020617_100%)] px-4 py-6 md:px-6">
      <div className="w-full space-y-4">
        {partial ? (
          <Card className="border-amber-900/60 bg-amber-950/10">
            <CardHeader>
              <CardTitle>{fullQuery.isError ? "Partial Research Mode" : "Loading Full Research"}</CardTitle>
              <CardDescription>
                {partialDescription}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <button
                type="button"
                onClick={() => {
                  void fullQuery.refetch();
                }}
                className="rounded-full border border-amber-700/50 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/20"
              >
                Retry
              </button>
            </CardContent>
          </Card>
        ) : null}

        <VerdictBar
          symbol={normalized}
          companyName={companyName}
          price={terminal.price}
          decision={safe.decision}
          context={context}
          score={{
            data_confidence: terminal.data_confidence,
            data_confidence_label: terminal.data_confidence_label,
          }}
        />

        <Card className="overflow-hidden border-slate-800/80 bg-[linear-gradient(135deg,rgba(8,15,29,0.96),rgba(15,23,42,0.92))]">
          <CardContent className="p-0">
            <div className="space-y-5 p-6 md:p-7">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <ResearchSymbolLogo symbol={normalized} />
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-300/75">Research Console</div>
                      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h1 className="text-2xl font-semibold tracking-[0.08em] text-slate-50 md:text-3xl">{normalized}</h1>
                        {companyName ? <div className="text-lg font-medium tracking-tight text-slate-200 md:text-xl">{companyName}</div> : null}
                      </div>
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                        Institutional decision engine for why it is moving, whether it is tradeable, and what deserves action.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <MetaBadge meta={meta} />
                    <DataConfidenceBadge
                      score={terminal.data_confidence}
                      label={terminal.data_confidence_label}
                      coverageScore={terminal.coverage?.coverage_score}
                      freshnessScore={terminal.freshness_score}
                      sourceQuality={terminal.source_quality}
                      hasNews={terminal.coverage?.has_news}
                    />
                    {fullPayload ? <Badge variant={coverageBadge.variant}>{`${coverageBadge.label} · ${Number(terminal.coverage?.coverage_score || 0)}%`}</Badge> : <Badge variant="accent">Loading Coverage</Badge>}
                    {fullQuery.isFetching ? <Badge variant="accent">Updating</Badge> : null}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <StatTile label="Price" value={formatCurrency(terminal.price.price)} tone={priceTone} />
                  <StatTile label="Change" value={formatPercent(terminal.price.change_percent)} tone={priceTone} />
                  <StatTile label="Expected Move" value={formatPercent(terminal.earningsInsight.expectedMove)} />
                  <StatTile label="Sector" value={terminal.profile.sector || WARMING_COPY} />
                </div>
            </div>
          </CardContent>
        </Card>

        {fullPayload && coverageMessages.length > 0 ? (
          <Card className="border-slate-800/80 bg-slate-950/50">
            <CardHeader>
              <CardTitle>Coverage Status</CardTitle>
              <CardDescription>
                Data coverage is below full for {normalized}. Panels render explicit unavailable states where the source data is missing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-300">
              <div className="grid gap-3 md:grid-cols-3">
                <StatTile label="Coverage" value={`${Number(terminal.coverage?.coverage_score || 0)}%`} />
                <StatTile label="Data Confidence" value={`${Math.round(Number(terminal.data_confidence || 0))} · ${terminal.data_confidence_label || 'POOR'}`} />
                <StatTile label="News Articles" value={String(Number(terminal.coverage?.news_count || 0))} />
                <StatTile label="Earnings Rows" value={String(Number(terminal.coverage?.earnings_count || 0))} />
              </div>
              <div className="rounded-2xl border border-dashed border-slate-800/80 bg-slate-950/45 p-4">
                {coverageMessages.map((message) => (
                  <p key={message} className="leading-7">{message}</p>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <ResearchChartPanel
          symbol={normalized}
          indicators={terminal.indicators}
          showPanels
          interval={chartInterval}
          onIntervalChange={setChartInterval}
          hoverTime={indicatorHoverTime}
          onHoverTimeChange={setIndicatorHoverTime}
        />

        <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
          <div className="space-y-4">
            <ResearchDecisionPanel payload={safe.decision} currentPrice={terminal.price?.price} context={context} />
          </div>
          <div className="space-y-4 xl:sticky xl:top-28 xl:self-start">
            <CatalystPanel symbol={normalized} />
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-800/80 bg-slate-950/45 p-2">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => startTransition(() => setActiveTab(tab.id))}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-semibold transition",
                  activeTab === tab.id
                    ? "bg-cyan-500 text-slate-950"
                    : "bg-slate-900/70 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <Suspense fallback={<TabPanelSkeleton />}>
          <ActiveComponent
            symbol={normalized}
            research={research}
            context={context}
            meta={meta}
            terminal={terminal}
            chartSync={{
              interval: chartInterval,
              hoverTime: indicatorHoverTime,
              onHoverTimeChange: setIndicatorHoverTime,
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}