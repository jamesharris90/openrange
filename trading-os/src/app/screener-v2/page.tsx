"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";

import { useTableControls } from "@/hooks/useTableControls";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type ScreenerRow = {
  symbol: string | null;
  price: number | null;
  change_percent: number | null;
  volume: number | null;
  rvol: number | null;
  gap_percent: number | null;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  vwap_position: "ABOVE" | "BELOW";
  momentum: "BULLISH" | "BEARISH";
  latest_news_at?: string | null;
  news_source: "fmp" | "database" | "none";
  earnings_date?: string | null;
  earnings_source: "fmp" | "database" | "yahoo" | "none";
  catalyst_type: "NEWS" | "RECENT_NEWS" | "EARNINGS" | "TECHNICAL" | "NONE";
  sector: string | null;
  instrument_type: "STOCK" | "ETF" | "ADR" | "REIT" | "FUND" | "OTHER";
  updated_at: string | null;
  why: string;
  driver_type: "MACRO" | "SECTOR" | "NEWS" | "EARNINGS" | "TECHNICAL";
  confidence: number;
  linked_symbols: string[];
  volume_last_5m: number | null;
  avg_5m_volume: number | null;
  rvol_acceleration: number | null;
  price_range_contraction: number | null;
  first_seen_timestamp: string | null;
  time_since_first_seen: number | null;
  state: "FORMING" | "CONFIRMED" | "EXTENDED" | "DEAD";
  early_signal: boolean;
};

type ScreenerResponse = {
  success: boolean;
  count: number;
  fallbackUsed: boolean;
  macro_context?: MacroContext;
  total?: number;
  meta?: {
    raw_universe_size?: number;
    final_scored_size?: number;
    returned_rows?: number;
    total_ms?: number;
  } | null;
  snapshot_at?: string;
  data: ScreenerRow[];
};

type WarmingUpResponse = {
  status: "warming_up";
};

type MacroContext = {
  regime: "risk_on" | "risk_off" | "mixed";
  drivers: string[];
  dominant_sectors: string[];
  weak_sectors: string[];
};

type OpportunityRow = {
  symbol: string;
  score: number;
  why: string;
  state: "FORMING" | "CONFIRMED";
  early_signal: boolean;
  bias: "continuation" | "reversal" | "chop";
  risk: "low" | "medium" | "high";
  confidence_reason: string;
  setup_type: "momentum continuation" | "mean reversion" | "breakout" | "fade" | "chop / avoid";
  watch: string;
  confidence: number;
  tradeable: boolean;
  entry_type: "breakout" | "pullback" | "reversal";
  entry_trigger: string;
  invalidation: string;
  timeframe: "intraday" | "swing";
  structure: "range" | "trend" | "extension";
};

type OpportunitiesResponse = {
  success: boolean;
  count: number;
  data: OpportunityRow[];
  snapshot_at?: string;
  macro_context?: MacroContext;
  report?: {
    valid: boolean;
    avg_confidence: number;
    removed_weak_setups: number;
    execution_ready: boolean;
  };
};

type MarketState = {
  is_market_open: boolean;
  is_premarket: boolean;
  is_afterhours: boolean;
  is_weekend: boolean;
  session: "LIVE" | "PREMARKET" | "AFTERHOURS" | "CLOSED";
  next_open: string | null;
  next_open_formatted?: {
    utc: string | null;
    et: string | null;
  };
  label: string;
};

type NextSessionEarningsRow = {
  symbol: string;
  earnings_date: string;
  eps_estimate: number | null;
  expected_move_percent: number | null;
  price: number | null;
  sector?: string | null;
};

type NextSessionCatalystRow = {
  symbol: string;
  headline: string | null;
  published_at: string | null;
  price: number | null;
  change_percent: number | null;
  relative_volume: number | null;
  volume: number | null;
  sector?: string | null;
};

type NextSessionMomentumRow = {
  symbol: string;
  price: number | null;
  change_percent: number | null;
  relative_volume: number | null;
  atr_percent: number | null;
  setup_type: string | null;
  setup_score: number | null;
  stream_score: number | null;
  headline: string | null;
  sector?: string | null;
};

type NextSessionPayload = {
  earnings: NextSessionEarningsRow[];
  catalysts: NextSessionCatalystRow[];
  momentum: NextSessionMomentumRow[];
  generated_at: string;
  message: string | null;
  missing_sources?: string[];
  meta?: {
    total_ms?: number;
    cache_ttl_ms?: number;
  };
};

type OpportunitiesModeResponse = {
  success: boolean;
  mode: "LIVE" | "NEXT_SESSION";
  market: MarketState;
  data: OpportunitiesResponse | NextSessionPayload | WarmingUpResponse;
};

type ScreenerFilters = {
  minVolume: string;
  minRvol: string;
  sector: string;
  instrumentType: "" | ScreenerRow["instrument_type"];
  catalyst: "ALL" | "NEWS" | "EARNINGS" | "TECHNICAL";
};

type ViewMode = "all" | "focus";
type ScreenMode = "ai" | "manual";

const DEFAULT_FILTERS: ScreenerFilters = {
  minVolume: "",
  minRvol: "",
  sector: "",
  instrumentType: "",
  catalyst: "ALL",
};

const INSTRUMENT_TYPE_LABELS: Record<ScreenerRow["instrument_type"], string> = {
  STOCK: "Stocks",
  ETF: "ETFs",
  ADR: "ADRs",
  REIT: "REITs",
  FUND: "Funds / Trusts",
  OTHER: "Other",
};

type SortKey = "composite" | "rvol" | "trend" | "momentum" | "gap";
type SortDirection = "asc" | "desc";

const SKELETON_ROWS = Array.from({ length: 10 }, (_, index) => index);

function compareNullableNumbers(left: number | null, right: number | null, direction: SortDirection) {
  const leftValue = left ?? Number.NEGATIVE_INFINITY;
  const rightValue = right ?? Number.NEGATIVE_INFINITY;
  return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
}

function trendRank(value: ScreenerRow["trend"]) {
  if (value === "BULLISH") return 2;
  if (value === "NEUTRAL") return 1;
  return 0;
}

function momentumRank(value: ScreenerRow["momentum"]) {
  return value === "BULLISH" ? 1 : 0;
}

function parseEmbeddedJson(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if ((!trimmed.startsWith("{") && !trimmed.startsWith("[")) || trimmed.length < 2) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function extractDisplayText(value: unknown, fallback: string | null = null) {
  const parsed = parseEmbeddedJson(value);
  if (typeof parsed === "string") {
    const trimmed = parsed.trim();
    return trimmed || fallback;
  }

  if (parsed && typeof parsed === "object") {
    const candidate = ["setup_type", "setup", "headline", "title", "label", "type"]
      .map((key) => (parsed as Record<string, unknown>)[key])
      .find((entry) => typeof entry === "string" && entry.trim());
    if (typeof candidate === "string") {
      return candidate.trim();
    }
  }

  return fallback;
}

function normalizeNextSessionRow<T extends Record<string, unknown>>(row: unknown): T | null {
  const parsed = parseEmbeddedJson(row);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as T;
}

function normalizeNextSessionPayload(payload: NextSessionPayload | null): NextSessionPayload | null {
  if (!payload) {
    return null;
  }

  const normalizeRows = <T extends Record<string, unknown>>(rows: unknown[]) => rows
    .map((row) => normalizeNextSessionRow<T>(row))
    .filter((row): row is T => Boolean(row));

  return {
    ...payload,
    earnings: normalizeRows<NextSessionEarningsRow>(Array.isArray(payload.earnings) ? payload.earnings : []),
    catalysts: normalizeRows<NextSessionCatalystRow>(Array.isArray(payload.catalysts) ? payload.catalysts : []),
    momentum: normalizeRows<NextSessionMomentumRow>(Array.isArray(payload.momentum) ? payload.momentum : []).map((row) => ({
      ...row,
      setup_type: extractDisplayText(row.setup_type, "Continuation"),
      headline: extractDisplayText(row.headline, null),
    })),
  };
}

function sortRows(rows: ScreenerRow[], sortKey: SortKey = "composite", sortDirection: SortDirection = "desc") {
  return [...rows].sort((left, right) => {
    if (sortKey === "rvol") {
      const result = compareNullableNumbers(left.rvol, right.rvol, sortDirection);
      if (result !== 0) return result;
    }

    if (sortKey === "trend") {
      const leftRank = trendRank(left.trend);
      const rightRank = trendRank(right.trend);
      if (leftRank !== rightRank) {
        return sortDirection === "asc" ? leftRank - rightRank : rightRank - leftRank;
      }
    }

    if (sortKey === "momentum") {
      const leftRank = momentumRank(left.momentum);
      const rightRank = momentumRank(right.momentum);
      if (leftRank !== rightRank) {
        return sortDirection === "asc" ? leftRank - rightRank : rightRank - leftRank;
      }
    }

    if (sortKey === "gap") {
      const result = compareNullableNumbers(left.gap_percent, right.gap_percent, sortDirection);
      if (result !== 0) return result;
    }

    const statePriority = { FORMING: 0, CONFIRMED: 1, EXTENDED: 2, DEAD: 3 } as const;
    const leftState = statePriority[left.state] ?? 4;
    const rightState = statePriority[right.state] ?? 4;
    if (leftState !== rightState) return leftState - rightState;

    const leftRvol = left.rvol ?? -1;
    const rightRvol = right.rvol ?? -1;
    if (rightRvol !== leftRvol) return rightRvol - leftRvol;

    const leftChange = Math.abs(left.change_percent ?? 0);
    const rightChange = Math.abs(right.change_percent ?? 0);
    if (rightChange !== leftChange) return rightChange - leftChange;

    return String(left.symbol ?? "").localeCompare(String(right.symbol ?? ""));
  });
}

function resolveUpdatedTimestamp(rows: ScreenerRow[]) {
  let latestTimestamp = 0;

  for (const row of rows) {
    const parsed = Date.parse(row.updated_at ?? "");
    if (!Number.isNaN(parsed) && parsed > latestTimestamp) {
      latestTimestamp = parsed;
    }
  }

  return latestTimestamp > 0 ? latestTimestamp : null;
}

function isWarmingUpResponse(payload: unknown): payload is WarmingUpResponse {
  return Boolean(payload && typeof payload === "object" && "status" in payload && payload.status === "warming_up");
}

function formatUpdatedTime(timestamp: number | null) {
  if (!timestamp) return "--:--:--";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function formatPrice(value: number | null) {
  if (value === null) return "—";
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number | null) {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatVolume(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatRvol(value: number | null) {
  if (value === null) return "—";
  if (value > 50) return ">50x";
  if (value > 100) return `${(value / 100).toFixed(1)}x`;
  return `${value.toFixed(2)}x`;
}

function formatGap(value: number | null) {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function getTrendTone(trend: ScreenerRow["trend"]) {
  if (trend === "BULLISH") return "text-emerald-400";
  if (trend === "BEARISH") return "text-rose-400";
  return "text-slate-300";
}

function getVwapTone(position: ScreenerRow["vwap_position"]) {
  return position === "ABOVE" ? "text-emerald-400" : "text-rose-400";
}

function getMomentumTone(momentum: ScreenerRow["momentum"]) {
  return momentum === "BULLISH" ? "text-emerald-400" : "text-rose-400";
}

function SortHeader({
  label,
  sortKey,
  activeSortKey,
  activeSortDirection,
  onSort,
}: {
  label: string;
  sortKey: Exclude<SortKey, "composite">;
  activeSortKey: SortKey;
  activeSortDirection: SortDirection;
  onSort: (sortKey: Exclude<SortKey, "composite">) => void;
}) {
  const active = activeSortKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "inline-flex items-center gap-2 font-medium transition-colors hover:text-slate-200",
        active && "text-emerald-300"
      )}
    >
      <span>{label}</span>
      <span className="text-[10px] tracking-[0.12em] text-slate-500">{active ? (activeSortDirection === "desc" ? "DESC" : "ASC") : "SORT"}</span>
    </button>
  );
}

function cleanReason(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) {
    return "No clear reason available.";
  }

  const sentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return sentence.trim();
}

function formatTimeSinceFirstSeen(value: number | null) {
  if (value === null) return "—";
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m`;
  return `${Math.floor(value / 3600)}h`;
}

function formatState(state: ScreenerRow["state"]) {
  switch (state) {
    case "FORMING":
      return {
        label: "Forming",
        className: "border-sky-500/30 bg-sky-500/10 text-sky-200",
      };
    case "CONFIRMED":
      return {
        label: "Confirmed",
        className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
      };
    case "EXTENDED":
      return {
        label: "Extended",
        className: "border-amber-500/30 bg-amber-500/10 text-amber-200",
      };
    default:
      return {
        label: "Dead",
        className: "border-slate-500/30 bg-slate-500/10 text-slate-300",
      };
  }
}

function formatCatalyst(type: ScreenerRow["catalyst_type"]) {
  switch (type) {
    case "NEWS":
      return { icon: "🟢", label: "News" };
    case "RECENT_NEWS":
      return { icon: "🟠", label: "Recent News" };
    case "EARNINGS":
      return { icon: "🟣", label: "Earnings" };
    case "TECHNICAL":
      return { icon: "🟡", label: "Technical" };
    default:
      return { icon: "⚪", label: "No clear catalyst" };
  }
}

function getNewsFreshness(publishedAt: string | null | undefined) {
  if (!publishedAt) {
    return { tone: "text-slate-400", label: "—" };
  }

  const publishedTime = Date.parse(publishedAt);
  if (Number.isNaN(publishedTime)) {
    return { tone: "text-slate-400", label: "—" };
  }

  const minutes = Math.max(0, Math.floor((Date.now() - publishedTime) / 60000));
  if (minutes < 60) return { tone: "text-emerald-400", label: `${Math.max(1, minutes)}m` };
  if (minutes < 1440) return { tone: "text-emerald-400", label: `${Math.floor(minutes / 60)}h` };
  if (minutes < 10080) return { tone: "text-amber-300", label: `${Math.floor(minutes / 1440)}d` };
  return { tone: "text-slate-400", label: `${Math.floor(minutes / 1440)}d` };
}

function getEarningsLabel(earningsDate: string | null | undefined) {
  if (!earningsDate) return "No data";

  const target = new Date(`${earningsDate}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return "No data";

  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const targetDay = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const dayDiff = Math.round((targetDay - today) / 86400000);

  if (dayDiff === 0) return "Today";
  if (dayDiff > 0) return `In ${dayDiff}d`;
  return `${Math.abs(dayDiff)}d ago`;
}

function formatDriverType(type: ScreenerRow["driver_type"]) {
  switch (type) {
    case "MACRO":
      return {
        label: "Macro",
        className: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200",
      };
    case "SECTOR":
      return {
        label: "Sector",
        className: "border-sky-500/30 bg-sky-500/10 text-sky-200",
      };
    case "NEWS":
      return {
        label: "News",
        className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
      };
    case "EARNINGS":
      return {
        label: "Earnings",
        className: "border-amber-500/30 bg-amber-500/10 text-amber-200",
      };
    default:
      return {
        label: "Technical",
        className: "border-slate-500/30 bg-slate-500/10 text-slate-200",
      };
  }
}

function formatConfidence(value: number) {
  if (value >= 0.8) {
    return {
      label: "HIGH",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    };
  }

  if (value >= 0.4) {
    return {
      label: "MED",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    };
  }

  return {
    label: "LOW",
    className: "border-slate-500/30 bg-slate-500/10 text-slate-200",
  };
}

function formatRegime(regime: MacroContext["regime"]) {
  if (regime === "risk_on") {
    return {
      label: "Risk On",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    };
  }

  if (regime === "risk_off") {
    return {
      label: "Risk Off",
      className: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    };
  }

  return {
    label: "Mixed",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  };
}

function resolveViewModeParam(value: string | null): ViewMode {
  return String(value || "").toLowerCase() === "focus" ? "focus" : "all";
}

function SkeletonTable() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70 shadow-[0_0_0_1px_rgba(15,23,42,0.4)]">
      <table className="min-w-full divide-y divide-slate-800 text-sm">
        <thead className="bg-slate-950/90 text-left text-[11px] uppercase tracking-[0.18em] text-slate-500">
          <tr>
            {[
              "Symbol",
              "Price",
              "% Change",
              "Volume",
              "RVOL",
              "Gap %",
              "Trend",
              "VWAP",
              "Momentum",
              "State",
              "Catalyst",
              "Why",
              "News",
              "Earnings",
              "Sector",
            ].map((label) => (
              <th key={label} className="px-4 py-3 font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SKELETON_ROWS.map((row) => (
            <tr key={row} className="animate-pulse border-t border-slate-900">
              {Array.from({ length: 15 }, (_, cell) => (
                <td key={cell} className="px-4 py-3">
                  <div className="h-4 rounded bg-slate-800/80" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScreenerV2PageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ScreenerRow[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [macroContext, setMacroContext] = useState<MacroContext | null>(null);
  const [marketState, setMarketState] = useState<MarketState | null>(null);
  const [opportunityMode, setOpportunityMode] = useState<"LIVE" | "NEXT_SESSION">("LIVE");
  const [nextSessionData, setNextSessionData] = useState<NextSessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [warmingUp, setWarmingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [universeSize, setUniverseSize] = useState<number>(0);
  const requestedViewMode = resolveViewModeParam(searchParams.get("view"));
  const [viewMode, setViewMode] = useState<ViewMode>(requestedViewMode);
  const [sortKey, setSortKey] = useState<SortKey>("composite");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const screenMode: ScreenMode = "ai";
  const {
    filters,
    setFilters,
    resetFilters,
    page,
    setPage,
    pageSize,
  } = useTableControls<ScreenerRow, ScreenerFilters>(data, DEFAULT_FILTERS, { pageSize: 25 });

  const opportunitiesQuery = useMemo(() => {
    const params = new URLSearchParams();
    const asOf = searchParams.get("as_of") || searchParams.get("asOf");
    const sessionOverride = searchParams.get("session_override") || searchParams.get("sessionOverride");

    if (asOf) {
      params.set("as_of", asOf);
    }

    if (sessionOverride) {
      params.set("session_override", sessionOverride);
    }

    const query = params.toString();
    return `/api/opportunities/next-session${query ? `?${query}` : ""}`;
  }, [searchParams]);

  useEffect(() => {
    setViewMode(requestedViewMode);
  }, [requestedViewMode]);

  useEffect(() => {
    let cancelled = false;

    async function fetchData(showLoading: boolean) {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const [screenerResponse, opportunitiesResponse] = await Promise.all([
          apiFetch("/api/screener", { cache: "no-store" }),
          apiFetch(opportunitiesQuery, { cache: "no-store" }),
        ]);

        if (!screenerResponse.ok) {
          throw new Error(`Request failed (${screenerResponse.status})`);
        }

        const payload = (await screenerResponse.json()) as ScreenerResponse | WarmingUpResponse;
        const opportunitiesPayload = opportunitiesResponse.ok
          ? ((await opportunitiesResponse.json()) as OpportunitiesModeResponse | WarmingUpResponse)
          : { status: "warming_up" };

        console.log("SCREENER RESPONSE:", payload);

        if (!cancelled) {
          const screenerWarming = isWarmingUpResponse(payload);
          const opportunitiesWarming = isWarmingUpResponse(opportunitiesPayload);
          const nextRows = screenerWarming ? [] : (Array.isArray(payload.data) ? payload.data : []);
          const snapshotTime = screenerWarming ? null : Date.parse(payload.snapshot_at ?? "");
          const modePayload = !opportunitiesWarming && "mode" in opportunitiesPayload ? opportunitiesPayload : null;
          const livePayload = modePayload?.mode === "LIVE" && modePayload.data && "data" in modePayload.data
            ? (modePayload.data as OpportunitiesResponse)
            : null;
          const nextSessionPayload = modePayload?.mode === "NEXT_SESSION"
            ? (modePayload.data as NextSessionPayload)
            : null;

          setData(nextRows);
          setOpportunities(
            !livePayload || !Array.isArray(livePayload.data)
              ? []
              : livePayload.data.slice(0, 3)
          );
          setNextSessionData(normalizeNextSessionPayload(nextSessionPayload ?? null));
          setMarketState(modePayload?.market ?? null);
          setOpportunityMode(modePayload?.mode ?? "LIVE");
          setMacroContext(
            screenerWarming
              ? (livePayload?.macro_context ?? null)
              : payload.macro_context ?? (livePayload?.macro_context ?? null)
          );
          setUpdatedAt(Number.isFinite(snapshotTime) ? snapshotTime : resolveUpdatedTimestamp(nextRows));
          setWarmingUp(screenerWarming);
          setUniverseSize(screenerWarming ? 0 : Number(payload.meta?.raw_universe_size || nextRows.length || 0));
          setError(null);
        }
      } catch (nextError) {
        console.log("SCREENER ERROR:", nextError);
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load screener");

          if (showLoading) {
            setData([]);
            setOpportunities([]);
            setMacroContext(null);
            setMarketState(null);
            setNextSessionData(null);
            setOpportunityMode("LIVE");
            setUpdatedAt(null);
            setWarmingUp(false);
            setUniverseSize(0);
          }
        }
      } finally {
        if (!cancelled && showLoading) {
          setLoading(false);
        }
      }
    }

    fetchData(true);
    const refreshTimer = window.setInterval(() => {
      fetchData(false);
    }, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [opportunitiesQuery]);

  const nextSessionTotal = (nextSessionData?.earnings.length || 0)
    + (nextSessionData?.catalysts.length || 0)
    + (nextSessionData?.momentum.length || 0);

  const reopenLabel = marketState?.next_open_formatted?.et || marketState?.next_open || "Unavailable";

  const sectorOptions = useMemo(() => {
    const sectors = new Set<string>();
    data.forEach((row) => {
      const sector = String(row.sector || "").trim();
      if (sector) {
        sectors.add(sector);
      }
    });
    return Array.from(sectors).sort();
  }, [data]);

  const instrumentTypeOptions = useMemo(() => {
    const instrumentTypes = new Set<ScreenerRow["instrument_type"]>();
    data.forEach((row) => {
      if (row.instrument_type) {
        instrumentTypes.add(row.instrument_type);
      }
    });
    return Array.from(instrumentTypes).sort();
  }, [data]);

  const filteredRows = useMemo(() => {
    const minVolume = Number(filters.minVolume || 0);
    const minRvol = Number(filters.minRvol || 0);

    return data.filter((row) => {
      if (screenMode === "ai" && viewMode === "focus") {
        const isActionableState = row.state === "FORMING" || row.state === "CONFIRMED";
        const hasRequiredVolume = (row.volume ?? 0) >= 5_000_000;
        const hasRequiredRvol = (row.rvol ?? 0) >= 2;
        const hasCatalyst = row.catalyst_type !== "NONE";

        if (!isActionableState || !hasRequiredVolume || !hasRequiredRvol || !hasCatalyst) {
          return false;
        }
      }

      if (Number.isFinite(minVolume) && minVolume > 0 && (row.volume ?? 0) < minVolume) {
        return false;
      }

      if (Number.isFinite(minRvol) && minRvol > 0 && (row.rvol ?? 0) < minRvol) {
        return false;
      }

      if (filters.sector && String(row.sector || "") !== filters.sector) {
        return false;
      }

      if (filters.instrumentType && row.instrument_type !== filters.instrumentType) {
        return false;
      }

      if (filters.catalyst === "NEWS") {
        return row.catalyst_type === "NEWS" || row.catalyst_type === "RECENT_NEWS";
      }

      if (filters.catalyst === "EARNINGS") {
        return row.catalyst_type === "EARNINGS";
      }

      if (filters.catalyst === "TECHNICAL") {
        return row.catalyst_type === "TECHNICAL";
      }

      return true;
    });
  }, [data, filters.catalyst, filters.instrumentType, filters.minRvol, filters.minVolume, filters.sector, screenMode, viewMode]);

  const sortedRows = useMemo(() => {
    return sortRows(filteredRows, sortKey, sortDirection);
  }, [filteredRows, sortDirection, sortKey]);

  const screenerRowsBySymbol = useMemo(() => {
    return new Map(data.map((row) => [String(row.symbol || "").toUpperCase(), row]));
  }, [data]);

  const totalCount = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const paginatedRows = useMemo(() => {
    const startIndex = (page - 1) * pageSize;
    return sortedRows.slice(startIndex, startIndex + pageSize);
  }, [page, pageSize, sortedRows]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, setPage, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [setPage, sortDirection, sortKey]);

  function handleSort(nextSortKey: Exclude<SortKey, "composite">) {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection("desc");
  }

  return (
    <section className="space-y-5 text-slate-100">
      <header className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_32%),linear-gradient(180deg,_rgba(15,23,42,0.96),_rgba(2,6,23,0.96))] p-6 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-400/80">Trader Workspace</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Opportunities</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900/90 p-1">
              <button
                type="button"
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  "bg-emerald-400 text-emerald-950"
                )}
              >
                Opportunities
              </button>
              <button
                type="button"
                onClick={() => router.push("/screener")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  "text-slate-300 hover:bg-slate-800 hover:text-white"
                )}
              >
                Scanner
              </button>
            </div>
            <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              {warmingUp
                ? "Snapshot pending first live batch"
                : `Showing ${paginatedRows.length} of ${totalCount.toLocaleString()} filtered rows from ${(universeSize || data.length).toLocaleString()} symbols${viewMode === "focus" ? " (Focus Mode)" : ""} • Updated ${formatUpdatedTime(updatedAt)}`}
            </div>
          </div>
        </div>
        <p className="max-w-3xl text-sm text-slate-400">
          AI opportunities surfaces the current decision layer with focus setups, ranked names, and next-session context.
        </p>
      </header>

      <div className="sticky top-0 z-20 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/85 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900/90 p-1">
            <button
              type="button"
              onClick={() => setViewMode("all")}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                viewMode === "all" ? "bg-slate-100 text-slate-950" : "text-slate-300 hover:bg-slate-800 hover:text-white"
              )}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setViewMode("focus")}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                viewMode === "focus" ? "bg-emerald-400 text-emerald-950" : "text-slate-300 hover:bg-slate-800 hover:text-white"
              )}
            >
              Focus Mode
            </button>
          </div>
          {viewMode === "focus" ? (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-200">
              Tradeable Now
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min="0"
          step="100000"
          value={filters.minVolume}
          onChange={(event) => setFilters({ minVolume: event.target.value })}
          placeholder="Min Volume"
          className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        <select
          value={filters.minRvol}
          onChange={(event) => setFilters({ minRvol: event.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
        >
          <option value="">All RVOL</option>
          <option value="1">1x+</option>
          <option value="2">2x+</option>
          <option value="5">5x+</option>
          <option value="10">10x+</option>
        </select>
        <select
          value={filters.sector}
          onChange={(event) => setFilters({ sector: event.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
        >
          <option value="">All Sectors</option>
          {sectorOptions.map((sector) => (
            <option key={sector} value={sector}>{sector}</option>
          ))}
        </select>
        <select
          value={filters.instrumentType}
          onChange={(event) => setFilters({ instrumentType: event.target.value as ScreenerFilters["instrumentType"] })}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
        >
          <option value="">All Instruments</option>
          {instrumentTypeOptions.map((instrumentType) => (
            <option key={instrumentType} value={instrumentType}>{INSTRUMENT_TYPE_LABELS[instrumentType]}</option>
          ))}
        </select>
        <select
          value={filters.catalyst}
          onChange={(event) => setFilters({ catalyst: event.target.value as ScreenerFilters["catalyst"] })}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
        >
          <option value="ALL">All Catalysts</option>
          <option value="NEWS">News</option>
          <option value="EARNINGS">Earnings</option>
          <option value="TECHNICAL">Technical</option>
        </select>
        {(filters.minVolume || filters.minRvol || filters.sector || filters.instrumentType || filters.catalyst !== DEFAULT_FILTERS.catalyst) ? (
          <button
            type="button"
            onClick={() => resetFilters()}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition-colors hover:bg-slate-900 hover:text-white"
          >
            Clear filters
          </button>
        ) : null}
        </div>
      </div>

      {macroContext ? (
        <div className="rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_28%),linear-gradient(180deg,_rgba(15,23,42,0.9),_rgba(2,6,23,0.92))] p-5 shadow-[0_12px_30px_rgba(2,6,23,0.35)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-sky-300/80">Market Context Today</p>
              <h2 className="mt-2 text-lg font-semibold text-white">Macro driver layer for the tape</h2>
            </div>
            <span className={cn("inline-flex w-fit rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em]", formatRegime(macroContext.regime).className)}>
              {formatRegime(macroContext.regime).label}
            </span>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,2fr),minmax(0,1fr)]">
            <div className="space-y-2">
              {macroContext.drivers.slice(0, 3).map((driver) => (
                <p key={driver} className="text-sm leading-6 text-slate-200">
                  {driver}
                </p>
              ))}
            </div>
            <div className="space-y-3 text-sm text-slate-300">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Leading</p>
                <p className="mt-1">{macroContext.dominant_sectors.join(", ")}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Weak</p>
                <p className="mt-1">{macroContext.weak_sectors.join(", ")}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!loading && opportunityMode === "LIVE" && opportunities.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-3">
          {opportunities.map((row) => {
            const marketRow = screenerRowsBySymbol.get(String(row.symbol || "").toUpperCase());
            const catalyst = formatCatalyst(marketRow?.catalyst_type || "NONE");
            return (
              <div key={row.symbol} className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-4 text-sm shadow-[0_0_0_1px_rgba(15,23,42,0.3)]">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Top 3 Focus Today</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <Link href={`/research/${encodeURIComponent(row.symbol)}`} className="text-base font-semibold text-white underline-offset-4 hover:text-emerald-300 hover:underline">
                    {row.symbol}
                  </Link>
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200">AI</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/45 p-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Move</div>
                    <div className="mt-2 text-sm font-semibold text-slate-100">{formatPercent(marketRow?.change_percent ?? null)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/45 p-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Volume</div>
                    <div className="mt-2 text-sm font-semibold text-slate-100">{formatVolume(marketRow?.volume ?? null)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/45 p-3 sm:col-span-2">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Catalyst</div>
                    <div className="mt-2 text-sm font-semibold text-slate-100">{catalyst.label}</div>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{cleanReason(row.why)}</p>
              </div>
            );
          })}
        </div>
      ) : null}

      {!loading && opportunityMode === "NEXT_SESSION" ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-sky-500/20 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_30%),linear-gradient(180deg,_rgba(15,23,42,0.94),_rgba(2,6,23,0.94))] p-5 shadow-[0_12px_40px_rgba(2,6,23,0.4)]">
            <p className="text-[11px] uppercase tracking-[0.24em] text-sky-300/80">Market Closed Banner</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Market closed - preparing next session</h2>
            <p className="mt-2 text-sm text-slate-300">Reopens: {reopenLabel}</p>
          </div>

          {nextSessionTotal === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/70 px-6 py-10 text-center">
              <p className="text-base font-medium text-slate-200">No qualifying setups identified for next session</p>
              {nextSessionData?.missing_sources?.length ? (
                <p className="mt-2 text-sm text-slate-500">Missing sources: {nextSessionData.missing_sources.join(", ")}</p>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Upcoming Earnings</p>
                <div className="mt-3 space-y-3">
                  {nextSessionData?.earnings.length ? nextSessionData.earnings.map((row) => (
                    <Link key={row.symbol} href={`/research/${encodeURIComponent(row.symbol)}`} className="block rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3 hover:border-emerald-500/30 hover:bg-slate-900">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-white">{row.symbol}</span>
                        <span className="text-xs text-slate-400">{row.earnings_date}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-300">
                        <span>EPS est {row.eps_estimate != null ? row.eps_estimate.toFixed(2) : "—"}</span>
                        <span>Move {row.expected_move_percent != null ? `${row.expected_move_percent.toFixed(2)}%` : "—"}</span>
                      </div>
                    </Link>
                  )) : <p className="text-sm text-slate-500">No qualifying setups identified for next session</p>}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Catalyst Watchlist</p>
                <div className="mt-3 space-y-3">
                  {nextSessionData?.catalysts.length ? nextSessionData.catalysts.map((row) => (
                    <Link key={row.symbol} href={`/research/${encodeURIComponent(row.symbol)}`} className="block rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3 hover:border-sky-500/30 hover:bg-slate-900">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-white">{row.symbol}</span>
                        <span className="text-xs text-slate-400">{formatRvol(row.relative_volume)}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm text-slate-300">{row.headline || "Recent catalyst with unusual activity"}</p>
                    </Link>
                  )) : <p className="text-sm text-slate-500">No qualifying setups identified for next session</p>}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Momentum Carry</p>
                <div className="mt-3 space-y-3">
                  {nextSessionData?.momentum.length ? nextSessionData.momentum.map((row) => (
                    <Link key={row.symbol} href={`/research/${encodeURIComponent(row.symbol)}`} className="block rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3 hover:border-fuchsia-500/30 hover:bg-slate-900">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-white">{row.symbol}</span>
                        <span className="text-xs text-slate-400">{formatPercent(row.change_percent)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-300">
                        <span>{formatRvol(row.relative_volume)}</span>
                        <span>{row.setup_type || "Continuation"}</span>
                      </div>
                    </Link>
                  )) : <p className="text-sm text-slate-500">No qualifying setups identified for next session</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {loading ? (
        <SkeletonTable />
      ) : error && data.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/70 px-6 py-12 text-center">
          <p className="text-base font-medium text-slate-200">Data unavailable (API error)</p>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
        </div>
      ) : totalCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/70 px-6 py-12 text-center">
          <p className="text-base font-medium text-slate-200">
            {warmingUp ? "Snapshot not available yet" : "No stocks match the current filters"}
          </p>
          {warmingUp ? (
            <p className="mt-2 text-sm text-slate-500">The background snapshot cycle has not written a complete batch yet.</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {error ? (
            <div className="rounded-2xl border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
              Live refresh failed. Showing the most recent opportunities snapshot.
            </div>
          ) : null}
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70 shadow-[0_0_0_1px_rgba(15,23,42,0.35)]">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="sticky top-0 z-10 bg-slate-950/95 text-left text-[11px] uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Symbol</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">% Change</th>
                <th className="px-4 py-3 font-medium">Volume</th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="RVOL" sortKey="rvol" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="Gap %" sortKey="gap" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="Trend" sortKey="trend" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">VWAP</th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="Momentum" sortKey="momentum" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Catalyst</th>
                <th className="px-4 py-3 font-medium">Why</th>
                <th className="px-4 py-3 font-medium">News</th>
                <th className="px-4 py-3 font-medium">Earnings</th>
                <th className="px-4 py-3 font-medium">Sector</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row) => {
                const news = getNewsFreshness(row.latest_news_at);
                const earningsLabel = getEarningsLabel(row.earnings_date);
                const catalyst = formatCatalyst(row.catalyst_type);
                const driver = formatDriverType(row.driver_type);
                const confidence = formatConfidence(row.confidence);
                const state = formatState(row.state);
                const isFocusRow =
                  viewMode === "focus" &&
                  (row.state === "FORMING" || row.state === "CONFIRMED") &&
                  (row.volume ?? 0) >= 5_000_000 &&
                  (row.rvol ?? 0) >= 2 &&
                  row.catalyst_type !== "NONE";

                return (
                  <tr
                    key={row.symbol}
                    onClick={() => router.push(`/research/${encodeURIComponent(row.symbol || "")}`)}
                    className={cn(
                      "cursor-pointer border-t border-slate-900/80 transition hover:bg-slate-900/60",
                      isFocusRow && "bg-emerald-500/5 shadow-[inset_3px_0_0_0_rgba(52,211,153,0.8)]"
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <Link
                          href={`/research/${encodeURIComponent(row.symbol || "")}`}
                          onClick={(event) => event.stopPropagation()}
                          className="font-semibold tracking-wide text-slate-100 underline-offset-4 hover:text-emerald-300 hover:underline"
                        >
                          {row.symbol || "—"}
                        </Link>
                        {isFocusRow ? (
                          <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-200">
                            Tradeable Now
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-200">{formatPrice(row.price)}</td>
                    <td
                      className={cn(
                        "px-4 py-3 font-medium",
                        (row.change_percent ?? 0) > 0 && "text-emerald-400",
                        (row.change_percent ?? 0) < 0 && "text-rose-400",
                        row.change_percent === 0 && "text-slate-300"
                      )}
                    >
                      {formatPercent(row.change_percent)}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{formatVolume(row.volume)}</td>
                    <td className={cn("px-4 py-3 text-slate-300", (row.rvol ?? 0) > 2 && "font-semibold text-amber-300")}>{formatRvol(row.rvol)}</td>
                    <td className="px-4 py-3 text-slate-300">{formatGap(row.gap_percent)}</td>
                    <td className={cn("px-4 py-3 font-semibold", getTrendTone(row.trend))}>{row.trend}</td>
                    <td className={cn("px-4 py-3 font-semibold", getVwapTone(row.vwap_position))}>{row.vwap_position}</td>
                    <td className={cn("px-4 py-3 font-semibold", getMomentumTone(row.momentum))}>{row.momentum}</td>
                    <td className="px-4 py-3 text-slate-300">
                      <div className="space-y-1.5">
                        <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em]", state.className)}>
                          {state.label}
                        </span>
                        <p className="text-[11px] text-slate-400">
                          Seen {formatTimeSinceFirstSeen(row.time_since_first_seen)}
                        </p>
                        {row.early_signal ? (
                          <p className="text-[11px] uppercase tracking-[0.16em] text-fuchsia-300">Early signal</p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      <span className="mr-2">{catalyst.icon}</span>
                      <span>{catalyst.label}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap gap-2">
                          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em]", driver.className)}>
                            {driver.label}
                          </span>
                          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em]", confidence.className)}>
                            {confidence.label}
                          </span>
                        </div>
                        <p className="max-w-[18rem] text-xs leading-5 text-slate-300">{cleanReason(row.why)}</p>
                      </div>
                    </td>
                    <td className={cn("px-4 py-3", news.tone)} title={news.label}>
                      <span>{news.label}</span>
                      {row.latest_news_at && row.news_source === "database" ? (
                        <span className="ml-2 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">DB</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      <span>{earningsLabel}</span>
                      {row.earnings_date && row.earnings_source === "database" ? (
                        <span className="ml-2 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">DB</span>
                      ) : null}
                      {row.earnings_date && row.earnings_source === "yahoo" ? (
                        <span className="ml-2 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">Yahoo</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{row.sector || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/95 px-4 py-3 text-xs text-slate-400">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="rounded-lg border border-slate-700 px-3 py-1.5 transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <span>{`Page ${page} of ${totalPages}`}</span>
            <span>{`Showing ${paginatedRows.length} of ${totalCount.toLocaleString()}${universeSize ? ` from ${universeSize.toLocaleString()}` : ""}`}</span>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-slate-700 px-3 py-1.5 transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
        </div>
      )}
    </section>
  );
}

export default function ScreenerV2Page() {
  return (
    <Suspense fallback={<SkeletonTable />}>
      <ScreenerV2PageContent />
    </Suspense>
  );
}