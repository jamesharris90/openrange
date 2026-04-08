"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import ScreenerFilterPanel from "@/components/screener/ScreenerFilterPanel";
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
  tqi: number;
  tqi_label: "A" | "B" | "C" | "D";
  final_score: number;
  coverage_score: number;
  data_confidence: number;
  data_confidence_label: "HIGH" | "MEDIUM" | "LOW" | "POOR";
  freshness_score: number;
  source_quality: number;
  tradeable: boolean;
  has_news?: boolean;
  has_earnings?: boolean;
  has_technicals?: boolean;
  latest_news_at?: string | null;
  earnings_date?: string | null;
  market_cap?: number | null;
  float?: number | null;
  short_float?: number | null;
  avg_volume?: number | null;
  spread_pct?: number | null;
  shares_out?: number | null;
  exchange?: string | null;
  pm_change?: number | null;
  pm_volume?: number | null;
  change_from_open?: number | null;
  rsi_14?: number | null;
  atr_pct?: number | null;
  adr_pct?: number | null;
  from_52w_high?: number | null;
  from_52w_low?: number | null;
  beta?: number | null;
  analyst_upgrade?: boolean | null;
  insider_buy?: boolean | null;
  inst_ownership?: number | null;
  insider_ownership?: number | null;
  earnings_surprise?: number | null;
  pe?: number | null;
  ps?: number | null;
  eps_growth?: number | null;
  rev_growth?: number | null;
  debt_equity?: number | null;
  roe?: number | null;
  fcf_yield?: number | null;
  div_yield?: number | null;
  iv_rank?: number | null;
  put_call_ratio?: number | null;
  opt_volume?: number | null;
  opt_vol_vs_30d?: number | null;
  net_premium?: number | null;
  unusual_opts?: boolean | null;
  squeeze?: boolean | null;
  new_hod?: boolean | null;
  above_sma20?: boolean | null;
  above_sma50?: boolean | null;
  above_sma200?: boolean | null;
  catalyst_type: "NEWS" | "RECENT_NEWS" | "EARNINGS" | "TECHNICAL" | "NONE";
  sector: string | null;
  instrument_type: "STOCK" | "ETF" | "ADR" | "REIT" | "FUND" | "OTHER";
  updated_at: string | null;
};

type AdvancedManualFilters = Record<string, unknown>;

type BooleanJoin = "AND" | "OR" | "NOT";

type BooleanCondition = {
  id: number;
  filterId: string;
  op: string;
  value?: string;
  value2?: string;
  join?: BooleanJoin;
  isGroup?: false;
};

type BooleanGroup = {
  id: number;
  isGroup: true;
  join: BooleanJoin;
  conditions: Array<BooleanCondition | BooleanGroup>;
};

type ScreenerFilterState = {
  mode: "manual" | "boolean";
  manual: AdvancedManualFilters;
  booleanRoot: BooleanGroup | null;
};

function isBooleanGroup(value: BooleanCondition | BooleanGroup): value is BooleanGroup {
  return Boolean((value as BooleanGroup).isGroup);
}

type MacroContext = {
  regime: "risk_on" | "risk_off" | "mixed";
  drivers: string[];
  dominant_sectors: string[];
  weak_sectors: string[];
};

type ScreenerResponse = {
  success: boolean;
  count: number;
  total?: number;
  snapshot_at?: string;
  macro_context?: MacroContext;
  meta?: {
    raw_universe_size?: number;
    final_scored_size?: number;
    returned_rows?: number;
    total_ms?: number;
  } | null;
  data: ScreenerRow[];
};

type WarmingUpResponse = {
  status: "warming_up";
};

type ScreenerFilters = {
  minVolume: string;
  minRvol: string;
  sector: string;
  instrumentType: "" | ScreenerRow["instrument_type"];
  catalyst: "ALL" | "NEWS" | "EARNINGS" | "TECHNICAL";
};

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

type SortKey = "symbol" | "price" | "change" | "volume" | "rvol" | "gap" | "trend" | "vwap" | "momentum" | "catalyst" | "news" | "earnings" | "sector";
type SortDirection = "asc" | "desc";

const SKELETON_ROWS = Array.from({ length: 10 }, (_, index) => index);

function compareNullableNumbers(left: number | null, right: number | null, direction: SortDirection) {
  const leftValue = left ?? Number.NEGATIVE_INFINITY;
  const rightValue = right ?? Number.NEGATIVE_INFINITY;
  return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
}

function compareNullableText(left: string | null | undefined, right: string | null | undefined, direction: SortDirection) {
  const leftValue = String(left || "");
  const rightValue = String(right || "");
  return direction === "asc" ? leftValue.localeCompare(rightValue) : rightValue.localeCompare(leftValue);
}

function trendRank(value: ScreenerRow["trend"]) {
  if (value === "BULLISH") return 2;
  if (value === "NEUTRAL") return 1;
  return 0;
}

function momentumRank(value: ScreenerRow["momentum"]) {
  return value === "BULLISH" ? 1 : 0;
}

function vwapRank(value: ScreenerRow["vwap_position"]) {
  return value === "ABOVE" ? 1 : 0;
}

function catalystRank(value: ScreenerRow["catalyst_type"]) {
  if (value === "NEWS") return 4;
  if (value === "RECENT_NEWS") return 3;
  if (value === "EARNINGS") return 2;
  if (value === "TECHNICAL") return 1;
  return 0;
}

function newsFreshnessRank(publishedAt: string | null | undefined) {
  const parsed = Date.parse(publishedAt ?? "");
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function earningsRank(earningsDate: string | null | undefined) {
  const days = daysToEarnings(earningsDate);
  return days === null ? Number.POSITIVE_INFINITY : days;
}

function sortRows(rows: ScreenerRow[], sortKey: SortKey = "volume", sortDirection: SortDirection = "desc") {
  return [...rows].sort((left, right) => {
    if (sortKey === "symbol") {
      const result = compareNullableText(left.symbol, right.symbol, sortDirection);
      if (result !== 0) return result;
    }

    if (sortKey === "rvol") {
      const result = compareNullableNumbers(left.rvol, right.rvol, sortDirection);
      if (result !== 0) return result;
    }

    if (sortKey === "price") {
      const result = compareNullableNumbers(left.price, right.price, sortDirection);
      if (result !== 0) return result;
    }

    if (sortKey === "change") {
      const result = compareNullableNumbers(left.change_percent, right.change_percent, sortDirection);
      if (result !== 0) return result;
    }

    if (sortKey === "volume") {
      const result = compareNullableNumbers(left.volume, right.volume, sortDirection);
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

    if (sortKey === "vwap") {
      const leftRank = vwapRank(left.vwap_position);
      const rightRank = vwapRank(right.vwap_position);
      if (leftRank !== rightRank) {
        return sortDirection === "asc" ? leftRank - rightRank : rightRank - leftRank;
      }
    }

    if (sortKey === "catalyst") {
      const leftRank = catalystRank(left.catalyst_type);
      const rightRank = catalystRank(right.catalyst_type);
      if (leftRank !== rightRank) {
        return sortDirection === "asc" ? leftRank - rightRank : rightRank - leftRank;
      }
    }

    if (sortKey === "news") {
      const leftRank = newsFreshnessRank(left.latest_news_at);
      const rightRank = newsFreshnessRank(right.latest_news_at);
      if (leftRank !== rightRank) {
        return sortDirection === "asc" ? leftRank - rightRank : rightRank - leftRank;
      }
    }

    if (sortKey === "earnings") {
      const leftRank = earningsRank(left.earnings_date);
      const rightRank = earningsRank(right.earnings_date);
      if (leftRank !== rightRank) {
        return sortDirection === "asc" ? leftRank - rightRank : rightRank - leftRank;
      }
    }

    if (sortKey === "sector") {
      const result = compareNullableText(left.sector, right.sector, sortDirection);
      if (result !== 0) return result;
    }

    const leftRvol = left.rvol ?? -1;
    const rightRvol = right.rvol ?? -1;
    if (rightRvol !== leftRvol) return rightRvol - leftRvol;

    const leftChange = Math.abs(left.change_percent ?? 0);
    const rightChange = Math.abs(right.change_percent ?? 0);
    if (rightChange !== leftChange) return rightChange - leftChange;

    const leftVolume = left.volume ?? -1;
    const rightVolume = right.volume ?? -1;
    if (rightVolume !== leftVolume) return rightVolume - leftVolume;

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

function toNullableNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toArrayRange(value: unknown) {
  if (!Array.isArray(value) || value.length !== 2) {
    return null;
  }

  const min = toNullableNumber(value[0]);
  const max = toNullableNumber(value[1]);
  if (min === null || max === null) {
    return null;
  }

  return [min, max] as const;
}

function toBoolean(value: unknown) {
  return Boolean(value);
}

function daysToEarnings(earningsDate: string | null | undefined) {
  if (!earningsDate) return null;

  const target = new Date(`${earningsDate}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;

  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((targetUtc - today) / 86400000);
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function getAdvancedMetric(row: ScreenerRow, filterId: string): string | number | boolean | null {
  switch (filterId) {
    case "price":
      return row.price ?? null;
    case "change_pct":
      return row.change_percent ?? null;
    case "gap_pct":
      return row.gap_percent ?? null;
    case "rvol":
      return row.rvol ?? null;
    case "volume":
      return row.volume ?? null;
    case "pm_change":
      return row.pm_change ?? null;
    case "pm_volume":
      return row.pm_volume ?? null;
    case "change_from_open":
      return row.change_from_open ?? null;
    case "market_cap":
      return row.market_cap ?? null;
    case "float":
      return row.float ?? null;
    case "short_float":
      return row.short_float ?? null;
    case "avg_volume":
      return row.avg_volume ?? null;
    case "spread_pct":
      return row.spread_pct ?? null;
    case "shares_out":
      return row.shares_out ?? null;
    case "sector":
      return row.sector ?? "";
    case "exchange":
      return row.exchange ?? "";
    case "instrument_type":
      return row.instrument_type ?? "";
    case "rsi_14":
      return row.rsi_14 ?? null;
    case "atr_pct":
      return row.atr_pct ?? null;
    case "adr_pct":
      return row.adr_pct ?? null;
    case "from_52w_high":
      return row.from_52w_high ?? null;
    case "from_52w_low":
      return row.from_52w_low ?? null;
    case "above_vwap":
      return row.vwap_position === "ABOVE";
    case "above_sma20":
      return toBoolean(row.above_sma20);
    case "above_sma50":
      return toBoolean(row.above_sma50);
    case "above_sma200":
      return toBoolean(row.above_sma200);
    case "squeeze":
      return toBoolean(row.squeeze);
    case "new_hod":
      return toBoolean(row.new_hod);
    case "beta":
      return row.beta ?? null;
    case "days_to_earnings":
      return daysToEarnings(row.earnings_date);
    case "earnings_surprise":
      return row.earnings_surprise ?? null;
    case "has_news":
      return Boolean(row.has_news || row.latest_news_at);
    case "insider_buy":
      return toBoolean(row.insider_buy);
    case "analyst_upgrade":
      return toBoolean(row.analyst_upgrade);
    case "inst_ownership":
      return row.inst_ownership ?? null;
    case "insider_ownership":
      return row.insider_ownership ?? null;
    case "pe":
      return row.pe ?? null;
    case "ps":
      return row.ps ?? null;
    case "eps_growth":
      return row.eps_growth ?? null;
    case "rev_growth":
      return row.rev_growth ?? null;
    case "debt_equity":
      return row.debt_equity ?? null;
    case "roe":
      return row.roe ?? null;
    case "fcf_yield":
      return row.fcf_yield ?? null;
    case "div_yield":
      return row.div_yield ?? null;
    case "iv_rank":
      return row.iv_rank ?? null;
    case "put_call_ratio":
      return row.put_call_ratio ?? null;
    case "opt_volume":
      return row.opt_volume ?? null;
    case "opt_vol_vs_30d":
      return row.opt_vol_vs_30d ?? null;
    case "net_premium":
      return row.net_premium ?? null;
    case "unusual_opts":
      return toBoolean(row.unusual_opts);
    default:
      return null;
  }
}

function matchesManualFilters(row: ScreenerRow, filters: AdvancedManualFilters) {
  return Object.entries(filters).every(([filterId, filterValue]) => {
    if (Array.isArray(filterValue)) {
      const range = toArrayRange(filterValue);
      if (range) {
        const metric = toNullableNumber(getAdvancedMetric(row, filterId));
        return metric !== null && metric >= range[0] && metric <= range[1];
      }

      const selectedValues = filterValue.map((item) => normalizeText(item)).filter(Boolean);
      if (selectedValues.length === 0) {
        return true;
      }

      const metric = normalizeText(getAdvancedMetric(row, filterId));
      return selectedValues.includes(metric);
    }

    if (typeof filterValue === "boolean") {
      return filterValue ? toBoolean(getAdvancedMetric(row, filterId)) : true;
    }

    return true;
  });
}

function evaluateBooleanCondition(row: ScreenerRow, condition: BooleanCondition) {
  const metric = getAdvancedMetric(row, condition.filterId);

  if (condition.op === "is true") {
    return toBoolean(metric);
  }

  if (condition.op === "is false") {
    return !toBoolean(metric);
  }

  if (condition.op === "in" || condition.op === "not in") {
    const selectedValues = String(condition.value || "")
      .split(",")
      .map((item) => normalizeText(item))
      .filter(Boolean);
    const matches = selectedValues.includes(normalizeText(metric));
    return condition.op === "in" ? matches : !matches;
  }

  const numericMetric = toNullableNumber(metric);
  const value = toNullableNumber(condition.value);
  const value2 = toNullableNumber(condition.value2);

  if (numericMetric === null || value === null) {
    return false;
  }

  switch (condition.op) {
    case ">":
      return numericMetric > value;
    case ">=":
      return numericMetric >= value;
    case "<":
      return numericMetric < value;
    case "<=":
      return numericMetric <= value;
    case "=":
      return numericMetric === value;
    case "between":
      return value2 !== null && numericMetric >= value && numericMetric <= value2;
    default:
      return false;
  }
}

function evaluateBooleanGroup(row: ScreenerRow, group: BooleanGroup): boolean {
  let result: boolean | null = null;

  for (const condition of group.conditions) {
    const nextValue: boolean = isBooleanGroup(condition)
      ? evaluateBooleanGroup(row, condition)
      : evaluateBooleanCondition(row, condition);

    if (result === null) {
      result = nextValue;
      continue;
    }

    const join = condition.join || "AND";
    if (join === "OR") {
      result = result || nextValue;
    } else if (join === "NOT") {
      result = result && !nextValue;
    } else {
      result = result && nextValue;
    }
  }

  return result ?? true;
}

function filterRows(rows: ScreenerRow[], filterState: ScreenerFilterState) {
  if (filterState.mode === "boolean" && filterState.booleanRoot) {
    return rows.filter((row) => evaluateBooleanGroup(row, filterState.booleanRoot as BooleanGroup));
  }

  if (!Object.keys(filterState.manual).length) {
    return rows;
  }

  return rows.filter((row) => matchesManualFilters(row, filterState.manual));
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
  sortKey: SortKey;
  activeSortKey: SortKey;
  activeSortDirection: SortDirection;
  onSort: (sortKey: SortKey) => void;
}) {
  const active = activeSortKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "inline-flex items-center gap-2 font-medium transition-colors hover:text-slate-200",
        active && "text-sky-300"
      )}
    >
      <span>{label}</span>
      <span className="text-[10px] tracking-[0.12em] text-slate-500">{active ? (activeSortDirection === "desc" ? "DESC" : "ASC") : "SORT"}</span>
    </button>
  );
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
      return { icon: "⚪", label: "None" };
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
              "Catalyst",
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
              {Array.from({ length: 13 }, (_, cell) => (
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

export default function ScreenerPage() {
  const router = useRouter();
  const [data, setData] = useState<ScreenerRow[]>([]);
  const [macroContext, setMacroContext] = useState<MacroContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [warmingUp, setWarmingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [universeSize, setUniverseSize] = useState<number>(0);
  const [sortKey, setSortKey] = useState<SortKey>("volume");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [filterState, setFilterState] = useState<ScreenerFilterState>({
    mode: "manual",
    manual: {},
    booleanRoot: null,
  });
  const {
    filters,
    setFilters,
    resetFilters,
    page,
    setPage,
    pageSize,
  } = useTableControls<ScreenerRow, ScreenerFilters>(data, DEFAULT_FILTERS, { pageSize: 25 });

  useEffect(() => {
    let cancelled = false;

    async function fetchData(showLoading: boolean) {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const response = await apiFetch("/api/screener", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }

        const payload = (await response.json()) as ScreenerResponse | WarmingUpResponse;

        if (!cancelled) {
          const screenerWarming = isWarmingUpResponse(payload);
          const nextRows = screenerWarming ? [] : (Array.isArray(payload.data) ? payload.data : []);
          const snapshotTime = screenerWarming ? null : Date.parse(payload.snapshot_at ?? "");

          setData(nextRows);
          setMacroContext(screenerWarming ? null : payload.macro_context ?? null);
          setUpdatedAt(Number.isFinite(snapshotTime) ? snapshotTime : resolveUpdatedTimestamp(nextRows));
          setWarmingUp(screenerWarming);
          setUniverseSize(screenerWarming ? 0 : Number(payload.meta?.raw_universe_size || nextRows.length || 0));
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load screener");

          if (showLoading) {
            setData([]);
            setMacroContext(null);
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
  }, []);

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

    const baseRows = data.filter((row) => {
      if (Number.isFinite(minVolume) && minVolume > 0 && (row.volume ?? 0) < minVolume) {
        return false;
      }

      if (Number.isFinite(minRvol) && minRvol > 0 && (row.rvol ?? 0) < minRvol) {
        return false;
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

    return filterRows(baseRows, filterState);
  }, [data, filterState, filters.catalyst, filters.instrumentType, filters.minRvol, filters.minVolume, filters.sector]);

  const sortedRows = useMemo(() => {
    return sortRows(filteredRows, sortKey, sortDirection);
  }, [filteredRows, sortDirection, sortKey]);

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
  }, [filterState, setPage, sortDirection, sortKey]);

  function handleApplyFilters(nextFilters: AdvancedManualFilters) {
    setFilterState({
      mode: "manual",
      manual: nextFilters,
      booleanRoot: null,
    });
    setPage(1);
  }

  function handleApplyBoolean(nextRoot: BooleanGroup) {
    setFilterState({
      mode: "boolean",
      manual: {},
      booleanRoot: nextRoot,
    });
    setPage(1);
  }

  function handleSort(nextSortKey: SortKey) {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection("desc");
  }

  return (
    <section className="space-y-5 text-slate-100">
      <header className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_32%),linear-gradient(180deg,_rgba(15,23,42,0.96),_rgba(2,6,23,0.96))] p-6 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-sky-300/80">Trader Workspace</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Screener</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900/90 p-1">
              <button
                type="button"
                className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-950"
              >
                Scanner
              </button>
              <Link
                href="/screener-v2?view=focus"
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
              >
                Opportunities
              </Link>
            </div>
            <div className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-200">
              {warmingUp ? "Snapshot pending first live batch" : `Showing ${paginatedRows.length} of ${totalCount.toLocaleString()} filtered rows from ${(universeSize || data.length).toLocaleString()} symbols • Updated ${formatUpdatedTime(updatedAt)}`}
            </div>
          </div>
        </div>
        <p className="max-w-3xl text-sm text-slate-400">
          Live market scanner focused on price, volume, and catalyst context. Score metrics now live on the research page for each ticker.
        </p>
      </header>

      <div className="sticky top-0 z-20 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/85 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-slate-400">
          <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1">Live Discovery</span>
          <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1">25 Rows Per Page</span>
          <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1">Research Row Click</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min="0"
            step="100000"
            value={filters.minVolume}
            onChange={(event) => setFilters({ minVolume: event.target.value })}
            placeholder="Min Volume"
            className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
          />
          <select
            value={filters.minRvol}
            onChange={(event) => setFilters({ minRvol: event.target.value })}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
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
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
          >
            <option value="">All Sectors</option>
            {sectorOptions.map((sector) => (
              <option key={sector} value={sector}>{sector}</option>
            ))}
          </select>
          <select
            value={filters.instrumentType}
            onChange={(event) => setFilters({ instrumentType: event.target.value as ScreenerFilters["instrumentType"] })}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
          >
            <option value="">All Instruments</option>
            {instrumentTypeOptions.map((instrumentType) => (
              <option key={instrumentType} value={instrumentType}>{INSTRUMENT_TYPE_LABELS[instrumentType]}</option>
            ))}
          </select>
          <select
            value={filters.catalyst}
            onChange={(event) => setFilters({ catalyst: event.target.value as ScreenerFilters["catalyst"] })}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
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

      <ScreenerFilterPanel
        initialFilters={filterState.manual}
        onApply={handleApplyFilters}
        onApplyBoolean={handleApplyBoolean}
      />

      {macroContext ? (
        <div className="rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_transparent_28%),linear-gradient(180deg,_rgba(15,23,42,0.9),_rgba(2,6,23,0.92))] p-5 shadow-[0_12px_30px_rgba(2,6,23,0.35)]">
          <p className="text-[11px] uppercase tracking-[0.24em] text-sky-300/80">Market Context</p>
          <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,2fr),minmax(0,1fr)]">
            <div className="space-y-2">
              {macroContext.drivers.slice(0, 3).map((driver) => (
                <p key={driver} className="text-sm leading-6 text-slate-200">{driver}</p>
              ))}
            </div>
            <div className="space-y-3 text-sm text-slate-300">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Leading</p>
                <p className="mt-1">{macroContext.dominant_sectors.join(", ") || "—"}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Weak</p>
                <p className="mt-1">{macroContext.weak_sectors.join(", ") || "—"}</p>
              </div>
            </div>
          </div>
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
              Live refresh failed. Showing the most recent screener snapshot.
            </div>
          ) : null}
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70 shadow-[0_0_0_1px_rgba(15,23,42,0.35)]">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="sticky top-0 z-10 bg-slate-950/95 text-left text-[11px] uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="Symbol" sortKey="symbol" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="Price" sortKey="price" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="% Change" sortKey="change" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="Volume" sortKey="volume" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="RVOL" sortKey="rvol" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="Gap %" sortKey="gap" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="Trend" sortKey="trend" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="VWAP" sortKey="vwap" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="Momentum" sortKey="momentum" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="Catalyst" sortKey="catalyst" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="News" sortKey="news" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="Earnings" sortKey="earnings" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortHeader label="Sector" sortKey="sector" activeSortKey={sortKey} activeSortDirection={sortDirection} onSort={handleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row) => {
                const news = getNewsFreshness(row.latest_news_at);
                const earningsLabel = getEarningsLabel(row.earnings_date);
                const catalyst = formatCatalyst(row.catalyst_type);

                return (
                  <tr
                    key={row.symbol}
                    onClick={() => router.push(`/research/${encodeURIComponent(row.symbol || "")}`)}
                    className="cursor-pointer border-t border-slate-900/80 transition hover:bg-slate-900/60"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/research/${encodeURIComponent(row.symbol || "")}`}
                        onClick={(event) => event.stopPropagation()}
                        className="font-semibold tracking-wide text-slate-100 underline-offset-4 hover:text-sky-300 hover:underline"
                      >
                        {row.symbol || "—"}
                      </Link>
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
                      <span className="mr-2">{catalyst.icon}</span>
                      <span>{catalyst.label}</span>
                    </td>
                    <td className={cn("px-4 py-3", news.tone)}>{news.label}</td>
                    <td className="px-4 py-3 text-slate-300">{earningsLabel}</td>
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
