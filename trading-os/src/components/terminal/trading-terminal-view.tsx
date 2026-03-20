"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/client";
import { QUERY_POLICY } from "@/lib/queries/policy";

type OpportunityRow = {
  id?: string | number;
  symbol?: string;
  strategy?: string;
  signal_type?: string;
  confidence?: number;
  confidence_percent?: number;
  confidence_contextual?: number;
  confidence_context_percent?: number;
  expected_move_percent?: number;
  entry?: number | string;
  stop_loss?: number | string;
  take_profit?: number | string;
  market_session?: string;
  rvol?: number;
  signal_ids?: string[];
};

type SignalRow = {
  id?: string;
  symbol?: string;
  signal_type?: string;
  catalyst_ids?: string[];
};

type CatalystRow = {
  event_uuid?: string;
  source_table?: string;
  catalyst_type?: string;
  headline?: string;
};

type MacroNarrativeRow = {
  id?: string;
  theme?: string;
  summary?: string;
  confidence?: number;
};

type MarketQuoteRow = {
  symbol?: string;
  relative_volume?: number;
};

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T[];
};

function toNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatPct(value: number | null): string {
  if (value == null) return "N/A";
  return `${value.toFixed(0)}%`;
}

function formatValue(value: unknown): string {
  if (value == null) return "N/A";
  if (typeof value === "number" && Number.isFinite(value)) return value.toString();
  if (typeof value === "string" && value.trim()) return value;
  return "N/A";
}

function confidenceStyle(value: number | null): string {
  if (value == null) return "text-slate-300";
  if (value > 70) return "text-emerald-300";
  if (value >= 50) return "text-amber-300";
  return "text-rose-300";
}

function glowStyle(value: number | null): string {
  if (value != null && value > 70) return "shadow-[0_0_28px_rgba(16,185,129,0.22)]";
  return "";
}

async function fetchOpportunities() {
  const payload = await apiGet<ApiEnvelope<OpportunityRow>>("/api/opportunities?limit=6");
  return Array.isArray(payload.data) ? payload.data.slice(0, 6) : [];
}

async function fetchSignals() {
  const payload = await apiGet<ApiEnvelope<SignalRow>>("/api/signals?limit=500");
  return Array.isArray(payload.data) ? payload.data : [];
}

async function fetchCatalysts() {
  const payload = await apiGet<ApiEnvelope<CatalystRow>>("/api/catalysts?limit=500");
  return Array.isArray(payload.data) ? payload.data : [];
}

async function fetchMacroNarratives() {
  const payload = await apiGet<ApiEnvelope<MacroNarrativeRow>>("/api/macro?limit=10");
  return Array.isArray(payload.data) ? payload.data : [];
}

async function fetchMarketProxyQuotes() {
  const payload = await apiGet<ApiEnvelope<MarketQuoteRow>>("/api/market/quotes?symbols=SPY,QQQ");
  return Array.isArray(payload.data) ? payload.data : [];
}

export function TradingTerminalView() {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const opportunitiesQuery = useQuery({
    queryKey: ["terminal", "opportunities"],
    queryFn: fetchOpportunities,
    ...QUERY_POLICY.fast,
  });

  const signalsQuery = useQuery({
    queryKey: ["terminal", "signals"],
    queryFn: fetchSignals,
    ...QUERY_POLICY.fast,
  });

  const catalystsQuery = useQuery({
    queryKey: ["terminal", "catalysts"],
    queryFn: fetchCatalysts,
    ...QUERY_POLICY.fast,
  });

  const macroQuery = useQuery({
    queryKey: ["terminal", "macro"],
    queryFn: fetchMacroNarratives,
    ...QUERY_POLICY.fast,
  });

  const quotesQuery = useQuery({
    queryKey: ["terminal", "quotes", "spy-qqq"],
    queryFn: fetchMarketProxyQuotes,
    ...QUERY_POLICY.fast,
  });

  const opportunities = opportunitiesQuery.data ?? [];
  const signals = signalsQuery.data ?? [];
  const catalysts = catalystsQuery.data ?? [];
  const macros = macroQuery.data ?? [];
  const quotes = quotesQuery.data ?? [];

  const signalById = useMemo(() => {
    const map = new Map<string, SignalRow>();
    signals.forEach((row) => {
      if (!row?.id) return;
      map.set(String(row.id), row);
    });
    return map;
  }, [signals]);

  const catalystByEventUuid = useMemo(() => {
    const map = new Map<string, CatalystRow>();
    catalysts.forEach((row) => {
      if (!row?.event_uuid) return;
      map.set(String(row.event_uuid), row);
    });
    return map;
  }, [catalysts]);

  const marketSession = opportunities[0]?.market_session || "N/A";

  const avgMarketRvol = useMemo(() => {
    const values = quotes
      .map((row) => toNumber(row?.relative_volume))
      .filter((value): value is number => value != null);
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }, [quotes]);

  const macroSummary = macros[0] || null;

  const isLoading = opportunitiesQuery.isLoading
    || signalsQuery.isLoading
    || catalystsQuery.isLoading
    || macroQuery.isLoading
    || quotesQuery.isLoading;

  const hasAnyError = opportunitiesQuery.isError
    || signalsQuery.isError
    || catalystsQuery.isError
    || macroQuery.isError
    || quotesQuery.isError;

  function getCardKey(row: OpportunityRow, idx: number) {
    return `${String(row?.symbol || "")}:${idx}`;
  }

  function relatedSignals(row: OpportunityRow): SignalRow[] {
    const signalIds = Array.isArray(row?.signal_ids) ? row.signal_ids : [];
    return signalIds
      .map((id) => signalById.get(String(id)))
      .filter((value): value is SignalRow => Boolean(value));
  }

  function relatedCatalysts(row: OpportunityRow): CatalystRow[] {
    const signalRows = relatedSignals(row);
    const catalystIds = signalRows.flatMap((signal) => Array.isArray(signal.catalyst_ids) ? signal.catalyst_ids : []);
    return catalystIds
      .map((id) => catalystByEventUuid.get(String(id)))
      .filter((value): value is CatalystRow => Boolean(value));
  }

  function buildNarrative(row: OpportunityRow): string {
    const symbol = String(row?.symbol || "").toUpperCase();
    const strategy = String(row?.strategy || "setup").trim();
    const contextual = toNumber(row?.confidence_context_percent);
    const rvol = toNumber(row?.rvol);
    const session = String(row?.market_session || "N/A");

    const catalystsForRow = relatedCatalysts(row);
    const sourceSet = new Set(catalystsForRow.map((item) => String(item.source_table || "unknown")));
    const sourcesText = Array.from(sourceSet).join(", ") || "no catalyst source table linked";

    return `${symbol} is flagged under ${strategy}. Context-adjusted confidence is ${formatPct(contextual)} during ${session} with RVOL ${rvol == null ? "N/A" : rvol.toFixed(2)}. Linked catalyst sources: ${sourcesText}.`;
  }

  return (
    <div className="min-h-[calc(100vh-130px)] rounded-2xl border border-slate-800 bg-background p-4 shadow-lg">
      <section className="mb-4 rounded-2xl border border-slate-800 bg-panel p-4">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Context Strip</div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Market Session</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">{marketSession}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Avg Market RVOL (SPY/QQQ)</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">{avgMarketRvol == null ? "N/A" : avgMarketRvol.toFixed(2)}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Macro Sentiment Summary</div>
            <div className="mt-1 text-sm text-slate-100">{macroSummary?.summary || "N/A"}</div>
            <div className="mt-1 text-[11px] text-slate-400">
              Theme: {macroSummary?.theme || "N/A"} | Confidence: {toNumber(macroSummary?.confidence)?.toFixed(2) ?? "N/A"}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-panel p-4">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Top Opportunities</div>
        {isLoading ? <div className="text-sm text-slate-400">Loading strict backend data...</div> : null}
        {hasAnyError ? <div className="text-sm text-rose-300">Failed to load strict backend data.</div> : null}
        {!isLoading && !hasAnyError && opportunities.length === 0 ? (
          <div className="text-sm text-slate-300">No high-quality opportunities right now</div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {opportunities.map((row, idx) => {
            const key = getCardKey(row, idx);
            const contextualPercent = toNumber(row?.confidence_context_percent);
            const basePercent = toNumber(row?.confidence_percent);
            const relatedSignalTypes = relatedSignals(row)
              .map((signal) => String(signal.signal_type || "").trim())
              .filter((value) => Boolean(value));
            const signalType = relatedSignalTypes[0] || null;
            const displayStrategy = String(row?.strategy || signalType || "N/A");

            const catalystRows = relatedCatalysts(row);
            const newsRows = catalystRows.filter((c) => c.source_table === "news_articles");
            const intelRows = catalystRows.filter((c) => c.source_table === "intel_news");
            const earningsRows = catalystRows.filter((c) => c.source_table === "earnings_calendar");
            const isIntelBacked = intelRows.length > 0;

            return (
              <div
                key={key}
                className={`rounded-2xl border border-slate-800 bg-slate-950/50 p-4 transition ${glowStyle(contextualPercent)}`}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-bold text-slate-100">{String(row?.symbol || "").toUpperCase()}</div>
                    <div className="text-xs text-slate-400">{displayStrategy}{signalType && row?.strategy ? ` / ${signalType}` : ""}</div>
                  </div>
                  <div className={`text-right text-3xl font-extrabold leading-none ${confidenceStyle(contextualPercent)}`}>
                    {formatPct(contextualPercent)}
                    <div className="mt-1 text-[11px] font-medium text-slate-400">Adjusted</div>
                  </div>
                </div>

                <div className="mb-3 text-xs text-slate-400">Base: {formatPct(basePercent)}</div>

                <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                  <div>Expected Move %: {formatValue(row?.expected_move_percent)}</div>
                  <div>Session: {formatValue(row?.market_session)}</div>
                  <div>Entry: {formatValue(row?.entry)}</div>
                  <div>RVOL: {toNumber(row?.rvol)?.toFixed(2) ?? "N/A"}</div>
                  <div>Stop: {formatValue(row?.stop_loss)}</div>
                  <div>Target: {formatValue(row?.take_profit)}</div>
                </div>

                <button
                  type="button"
                  onClick={() => setExpandedKey((prev) => (prev === key ? null : key))}
                  className="mt-3 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200"
                >
                  {expandedKey === key ? "Hide Why" : "Show Why"}
                </button>

                {expandedKey === key ? (
                  <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-300">
                    <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">Narrative</div>
                    <div className="mb-3 leading-relaxed text-slate-200">{buildNarrative(row)}</div>

                    <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">is_intel_backed</div>
                    <div className={`mb-3 inline-flex rounded px-2 py-0.5 ${isIntelBacked ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-300"}`}>
                      {isIntelBacked ? "true" : "false"}
                    </div>

                    <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Catalyst Sources: News</div>
                    <ul className="mb-2 space-y-1">
                      {newsRows.length > 0 ? newsRows.slice(0, 3).map((item, i) => <li key={`news-${i}`}>- {item.headline || "N/A"}</li>) : <li>- None</li>}
                    </ul>

                    <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Catalyst Sources: Intel</div>
                    <ul className="mb-2 space-y-1">
                      {intelRows.length > 0 ? intelRows.slice(0, 3).map((item, i) => <li key={`intel-${i}`}>- {item.headline || "N/A"}</li>) : <li>- None</li>}
                    </ul>

                    <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Catalyst Sources: Earnings</div>
                    <ul className="space-y-1">
                      {earningsRows.length > 0 ? earningsRows.slice(0, 3).map((item, i) => <li key={`earn-${i}`}>- {item.headline || "N/A"}</li>) : <li>- None</li>}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
