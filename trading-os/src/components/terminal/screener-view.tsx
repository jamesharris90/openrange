"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getPlaybookTier, playbookLabel, TIER_STYLE, TIER_ORDER, type PlaybookTier } from "@/lib/playbook";

// ── Screener tab type ─────────────────────────────────────────────────────────

type ScreenerTab = "ALL" | "GAINERS" | "GAPPERS" | "HIGH_RVOL" | "NEWS_DRIVEN" | "IN_PLAY";

const TAB_CONFIG: { id: ScreenerTab; label: string; desc: string }[] = [
  { id: "ALL",        label: "All",         desc: "Full universe" },
  { id: "GAINERS",    label: "Top Gainers", desc: "% Change ↑" },
  { id: "GAPPERS",    label: "Top Gappers", desc: "Gap % ↑" },
  { id: "HIGH_RVOL",  label: "High RVOL",   desc: "RVOL > 2x" },
  { id: "NEWS_DRIVEN",label: "News Driven", desc: "Catalyst present" },
  { id: "IN_PLAY",    label: "In Play",     desc: "Premarket intel" },
];

// ── Premarket Intelligence types ─────────────────────────────────────────────

type InPlayRow = {
  symbol: string;
  catalyst_summary: string;
  news_count_72h: number;
  latest_news_ts: string | null;
  lifecycle_stage: string;
  confidence: number;
  tradeable: boolean;
  reason_not_tradeable: string | null;
  volume_state: string;
  price_structure: string;
  rvol: number | null;
  gap_percent: number | null;
  change_percent: number | null;
  has_earnings: boolean;
  updated_at: string;
};

// ── Sparkline component (Step 7) ─────────────────────────────────────────────

function Sparkline({ symbol }: { symbol: string }) {
  const [points, setPoints] = useState<number[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "no_data">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/stocks/intraday-sparkline?symbol=${symbol}&minutes=60`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (!d.data || d.data.length === 0) { setStatus("no_data"); return; }
        setPoints(d.data.map((b: { close: number }) => b.close));
        setStatus("ok");
      })
      .catch(() => { if (!cancelled) setStatus("no_data"); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (status === "loading") return <span className="text-[10px] text-slate-600">…</span>;
  if (status === "no_data" || !points || points.length < 2) {
    return <span className="text-[10px] text-slate-600">NO_INTRADAY_DATA</span>;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 80, h = 24;
  const step = w / (points.length - 1);
  const coords = points.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`);
  const pathD = "M" + coords.join("L");
  const last = points[points.length - 1];
  const first = points[0];
  const up = last >= first;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="inline-block">
      <path d={pathD} fill="none" stroke={up ? "#34d399" : "#f87171"} strokeWidth="1.5" />
    </svg>
  );
}

// ── In Play tab component ─────────────────────────────────────────────────────

const LIFECYCLE_STYLE: Record<string, string> = {
  PRE_MOVE:   "bg-blue-500/15 text-blue-400 border-blue-500/30",
  EXPANSION:  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  EXHAUSTION: "bg-red-500/15 text-red-400 border-red-500/30",
  DEAD:       "bg-slate-700/50 text-slate-500 border-slate-700",
  UNKNOWN:    "bg-slate-700/50 text-slate-500 border-slate-700",
};

function InPlayView() {
  const router = useRouter();
  const [rows, setRows] = useState<InPlayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const PAGE_SIZE_IP = 25;

  useEffect(() => {
    setLoading(true);
    fetch("/api/premarket/watchlist?limit=100", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (d.status === "NO_DATA") { setRows([]); }
        else if (!Array.isArray(d.data)) { setError("Unexpected response from server"); }
        else { setRows(d.data); }
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-sm text-slate-500">Loading premarket intelligence…</div>;
  }
  if (error) {
    return <div className="mx-4 mt-4 rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-2 text-sm text-slate-500">
        <div>No In Play symbols — engine may still be processing</div>
        <div className="text-[11px] text-slate-600">Data source: premarket_intelligence table</div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE_IP));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE_IP, page * PAGE_SIZE_IP);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-[var(--border)] text-[11px] text-slate-500 flex items-center gap-3">
        <span>{rows.length} symbols in play</span>
        <span>·</span>
        <span className="text-emerald-400">{rows.filter(r => r.tradeable).length} tradeable</span>
        <span>·</span>
        <span>Data: premarket_intelligence</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-[var(--panel)] border-b border-[var(--border)]">
            <tr>
              {["Symbol","Lifecycle","Confidence","Gap%","RVOL","Chg%","News","Sparkline","Catalyst"].map(col => (
                <th key={col} className="px-3 py-2.5 text-[11px] uppercase tracking-wide font-medium text-[var(--muted-foreground)] text-left whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => {
              const lifecycleCls = LIFECYCLE_STYLE[row.lifecycle_stage] || LIFECYCLE_STYLE.UNKNOWN;
              const confCls = row.confidence >= 70 ? "text-emerald-400" : row.confidence >= 40 ? "text-amber-400" : "text-slate-500";
              return (
                <tr
                  key={row.symbol}
                  onClick={() => router.push(`/research/${row.symbol}`)}
                  className={[
                    "border-b border-[var(--border)] cursor-pointer transition-colors hover:bg-[var(--muted)]",
                    i % 2 !== 0 ? "bg-[var(--muted)]/20" : "",
                  ].join(" ")}
                >
                  <td className="px-3 py-2 font-semibold text-blue-400 text-xs">{row.symbol}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border ${lifecycleCls}`}>
                      {row.lifecycle_stage}
                    </span>
                  </td>
                  <td className={`px-3 py-2 font-mono text-xs font-bold ${confCls}`}>{row.confidence}</td>
                  <td className="px-3 py-2 font-mono text-xs text-right">
                    {row.gap_percent != null ? `${row.gap_percent > 0 ? "+" : ""}${row.gap_percent.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-right">
                    {row.rvol != null ? `${row.rvol.toFixed(2)}x` : "—"}
                  </td>
                  <td className={`px-3 py-2 font-mono text-xs text-right ${(row.change_percent ?? 0) >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                    {row.change_percent != null ? `${row.change_percent > 0 ? "+" : ""}${row.change_percent.toFixed(2)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">{row.news_count_72h ?? 0}</td>
                  <td className="px-3 py-2"><Sparkline symbol={row.symbol} /></td>
                  <td className="px-3 py-2 text-xs text-slate-400 max-w-[200px] truncate" title={row.catalyst_summary}>
                    {row.catalyst_summary}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)] text-xs text-slate-500">
          <span>{(page - 1) * PAGE_SIZE_IP + 1}–{Math.min(page * PAGE_SIZE_IP, rows.length)} of {rows.length}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 rounded border border-[var(--border)] disabled:opacity-30">‹</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-2 py-1 rounded border border-[var(--border)] disabled:opacity-30">›</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── types (original) ──────────────────────────────────────────────────────────

type ScreenerRow = {
  symbol: string;
  price: number;
  change_percent: number;
  volume: number;
  avg_volume_30d: number;
  relative_volume: number;
  market_cap: number;
  sector: string;
  catalyst_type: string;
  score?: number | null;
  stage?: string | null;
};

type ScreenerPayload = {
  success: boolean;
  count?: number;
  total?: number;
  data?: ScreenerRow[];
  rows?: ScreenerRow[];
  status?: string;
  message?: string;
  coverage?: number;
  market_mode?: string;
  market_reason?: string;
};

type SortDir = "asc" | "desc";
type ColKey = keyof ScreenerRow;
type TradeStatus = "READY" | "WATCH" | "IGNORE";

// ── stage → trade status (backend-driven) ─────────────────────────────────────

function stageToStatus(stage?: string | null): TradeStatus {
  if (stage === "ACTIVE")  return "READY";
  if (stage === "EARLY")   return "WATCH";
  return "IGNORE";
}

// ── formatters ────────────────────────────────────────────────────────────────

function fmtPrice(v: number) {
  if (!Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}
function fmtVol(v: number) {
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}
function fmtMcap(v: number) {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9)  return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `${(v / 1e6).toFixed(0)}M`;
  return "—";
}
function fmtRvol(v: number) {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(2) + "x";
}

// ── UI components ─────────────────────────────────────────────────────────────

function RvolCell({ rvol }: { rvol: number }) {
  const valid  = Number.isFinite(rvol) && rvol > 0;
  const pct    = valid ? Math.min(100, (rvol / 5) * 100) : 0;
  const high   = rvol >= 2;
  const barCls = rvol >= 3 ? "bg-amber-500" : rvol >= 2 ? "bg-amber-400/70" : "bg-slate-600";
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={`font-mono text-xs tabular-nums ${high ? "text-amber-400 font-semibold" : "text-[var(--muted-foreground)]"}`}>
        {valid ? fmtRvol(rvol) : "—"}
      </span>
      {valid && (
        <div className="h-1 w-16 rounded-full bg-slate-800">
          <div className={`h-1 rounded-full transition-all ${barCls}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

const CATALYST_STYLES: Record<string, string> = {
  NEWS:           "bg-blue-500/15 text-blue-500 border-blue-500/30",
  EARNINGS:       "bg-amber-500/15 text-amber-500 border-amber-500/30",
  UNUSUAL_VOLUME: "bg-purple-500/15 text-purple-500 border-purple-500/30",
  UNKNOWN:        "bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)]",
};

function CatalystBadge({ type }: { type: string }) {
  const label = type === "UNUSUAL_VOLUME" ? "RVOL" : type;
  const cls   = CATALYST_STYLES[type] ?? CATALYST_STYLES.UNKNOWN;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="ml-1 text-[10px] opacity-30">↕</span>;
  return <span className="ml-1 text-[10px] text-blue-500">{dir === "asc" ? "↑" : "↓"}</span>;
}

function FilterInput({ label, placeholder, value, onChange }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</span>
      <input
        type="number"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-blue-500"
      />
    </div>
  );
}

// ── constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

const COLUMNS: { key: ColKey | "__status"; label: string; align: "left" | "right" }[] = [
  { key: "__status",         label: "Status",   align: "left"  },
  { key: "symbol",           label: "Symbol",   align: "left"  },
  { key: "price",            label: "Price",    align: "right" },
  { key: "change_percent",   label: "% Chg",    align: "right" },
  { key: "volume",           label: "Volume",   align: "right" },
  { key: "relative_volume",  label: "RVOL",     align: "right" },
  { key: "avg_volume_30d",   label: "Avg Vol",  align: "right" },
  { key: "market_cap",       label: "Mkt Cap",  align: "right" },
  { key: "sector",           label: "Sector",   align: "left"  },
  { key: "catalyst_type",    label: "Catalyst", align: "left"  },
];

const SECTORS = [
  "All",
  "Technology", "Healthcare", "Financial Services", "Consumer Cyclical",
  "Industrials", "Communication Services", "Consumer Defensive",
  "Energy", "Basic Materials", "Real Estate", "Utilities",
];

const CATALYSTS = ["All", "NEWS", "EARNINGS", "UNUSUAL_VOLUME", "UNKNOWN"];

// ── main component ────────────────────────────────────────────────────────────

export function ScreenerView() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<ScreenerTab>("ALL");
  const [mounted,      setMounted]      = useState(false);
  const [rows,         setRows]         = useState<ScreenerRow[]>([]);
  const [totalCount,   setTotalCount]   = useState(0);
  const [page,         setPage]         = useState(1);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [notReady,     setNotReady]     = useState<ScreenerPayload | null>(null);
  const [sortBy,       setSortBy]       = useState<ColKey>("change_percent");
  const [sortDir,      setSortDir]      = useState<SortDir>("desc");
  const [priceMin,     setPriceMin]     = useState("");
  const [priceMax,     setPriceMax]     = useState("");
  const [changeMin,    setChangeMin]    = useState("");
  const [rvolMin,      setRvolMin]      = useState("");
  const [mcapMinBil,   setMcapMinBil]   = useState("");
  const [sector,       setSector]       = useState("All");
  const [catalyst,     setCatalyst]     = useState("All");
  const [tradeableOnly, setTradeableOnly] = useState(false);
  const [playbookSort, setPlaybookSort] = useState(true); // default ON

  useEffect(() => { setMounted(true); }, []);

  const filterSig = [priceMin, priceMax, changeMin, rvolMin, mcapMinBil, sector, catalyst, sortBy, sortDir].join("|");
  useEffect(() => { if (mounted) setPage(1); }, [filterSig, mounted]);

  const fetchData = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE), sortBy, sortDir });
      if (priceMin)   params.set("priceMin",    priceMin);
      if (priceMax)   params.set("priceMax",    priceMax);
      if (changeMin)  params.set("changeMin",   changeMin);
      if (rvolMin)    params.set("rvolMin",     rvolMin);
      if (mcapMinBil) params.set("marketCapMin", String(Number(mcapMinBil) * 1e9));
      if (sector !== "All")   params.set("sector",   sector);
      if (catalyst !== "All") params.set("catalyst", catalyst);

      // Tab-specific overrides
      if (activeTab === "GAINERS")     { params.set("sortBy", "change_percent"); params.set("sortDir", "desc"); params.set("changeMin", "1"); }
      if (activeTab === "GAPPERS")     { params.set("sortBy", "gap_percent"); params.set("sortDir", "desc"); }
      if (activeTab === "HIGH_RVOL")   { params.set("sortBy", "relative_volume"); params.set("sortDir", "desc"); params.set("rvolMin", "2"); }
      if (activeTab === "NEWS_DRIVEN") { params.set("catalyst", "NEWS"); params.set("sortBy", "change_percent"); params.set("sortDir", "desc"); }

      const res  = await fetch(`/api/screener?${params}`, { cache: "no-store" });
      const data = (await res.json()) as ScreenerPayload;

      if (!data.success) {
        setRows([]); setTotalCount(0); setNotReady(data);
        return;
      }
      const next = data.rows ?? data.data ?? [];
      setRows(next);
      setTotalCount(data.count ?? data.total ?? next.length);
      setNotReady(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [activeTab, sortBy, sortDir, priceMin, priceMax, changeMin, rvolMin, mcapMinBil, sector, catalyst]);

  useEffect(() => { if (mounted) fetchData(page); }, [page, fetchData, mounted]);

  const handleSort = (col: ColKey) => {
    if (col === sortBy) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortBy(col); setSortDir("desc"); }
  };

  // Apply tradeable-only filter client-side (post-fetch)
  const filteredRows = tradeableOnly
    ? rows.filter(r => stageToStatus(r.stage) === "READY")
    : rows;

  // Apply playbook sort client-side when active
  const visibleRows = playbookSort
    ? [...filteredRows].sort((a, b) => {
        const sa = a.score ?? 0;
        const sb = b.score ?? 0;
        const ta = TIER_ORDER[getPlaybookTier(sa, sa, false) as PlaybookTier];
        const tb = TIER_ORDER[getPlaybookTier(sb, sb, false) as PlaybookTier];
        if (ta !== tb) return ta - tb;
        if (sa !== sb) return sb - sa;
        return (b.relative_volume ?? 0) - (a.relative_volume ?? 0);
      })
    : filteredRows;

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const start = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end   = Math.min(page * PAGE_SIZE, totalCount);
  const hasFilters = priceMin || priceMax || changeMin || rvolMin || mcapMinBil || sector !== "All" || catalyst !== "All";

  const resetFilters = () => {
    setPriceMin(""); setPriceMax(""); setChangeMin("");
    setRvolMin(""); setMcapMinBil(""); setSector("All"); setCatalyst("All");
  };

  if (!mounted) return null;

  const colCount = COLUMNS.length;

  return (
    <div className="flex flex-col h-full bg-[var(--background)]">

      {/* ── Tab bar ── */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-[var(--border)] shrink-0 overflow-x-auto">
        {TAB_CONFIG.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setPage(1); }}
            className={[
              "px-3 py-1.5 text-xs font-medium rounded-t transition-colors whitespace-nowrap border-b-2 -mb-px",
              activeTab === tab.id
                ? "border-blue-500 text-blue-400 bg-blue-500/5"
                : "border-transparent text-slate-500 hover:text-slate-300",
            ].join(" ")}
            title={tab.desc}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── In Play tab (separate data source) ── */}
      {activeTab === "IN_PLAY" && <InPlayView />}

      {activeTab !== "IN_PLAY" && <>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--panel)] shrink-0">
        <FilterInput label="Price Min"     placeholder="1"   value={priceMin}   onChange={setPriceMin} />
        <FilterInput label="Price Max"     placeholder="500" value={priceMax}   onChange={setPriceMax} />
        <FilterInput label="% Chg Min"     placeholder="0"   value={changeMin}  onChange={setChangeMin} />
        <FilterInput label="RVOL Min"      placeholder="1.5" value={rvolMin}    onChange={setRvolMin} />
        <FilterInput label="Mkt Cap ($B)"  placeholder="1"   value={mcapMinBil} onChange={setMcapMinBil} />

        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Sector</span>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs text-[var(--foreground)] focus:outline-none focus:border-blue-500 max-w-[160px]"
          >
            {SECTORS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Catalyst</span>
          <select
            value={catalyst}
            onChange={(e) => setCatalyst(e.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs text-[var(--foreground)] focus:outline-none focus:border-blue-500"
          >
            {CATALYSTS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>

        {/* Playbook sort toggle */}
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Sort</span>
          <button
            onClick={() => setPlaybookSort(p => !p)}
            className={`px-2.5 py-1 rounded border text-xs transition-colors ${
              playbookSort
                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            {playbookSort ? "PLAYBOOK ▲" : "PLAYBOOK"}
          </button>
        </div>

        {/* Tradeable toggle — Part 6 */}
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Mode</span>
          <div className="flex rounded border border-[var(--border)] bg-[var(--panel)] overflow-hidden text-xs">
            <button
              onClick={() => setTradeableOnly(false)}
              className={`px-2.5 py-1 transition-colors ${!tradeableOnly ? "bg-blue-500/20 text-blue-400" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
            >
              ALL
            </button>
            <button
              onClick={() => setTradeableOnly(true)}
              className={`px-2.5 py-1 transition-colors border-l border-[var(--border)] ${tradeableOnly ? "bg-emerald-500/20 text-emerald-400" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
            >
              TRADEABLE ONLY
            </button>
          </div>
        </div>

        {hasFilters && (
          <button
            onClick={resetFilters}
            className="self-end px-3 py-1 rounded text-xs bg-[var(--muted)] text-[var(--muted-foreground)] border border-[var(--border)] hover:text-[var(--foreground)] transition-colors"
          >
            Reset
          </button>
        )}

        <div className="ml-auto self-end text-xs text-[var(--muted-foreground)]">
          {loading ? "Loading…" : `${tradeableOnly ? visibleRows.length : totalCount.toLocaleString()} stocks`}
        </div>
      </div>

      {/* ── Status banners ── */}
      {error && (
        <div className="mx-4 mt-3 rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-4 py-3 text-sm text-[var(--destructive)]">
          {error}
        </div>
      )}
      {notReady && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">
          {notReady.market_mode && notReady.market_mode !== "LIVE" ? (
            <>
              <span className="font-bold">{notReady.market_mode}</span>
              {" — "}
              {notReady.market_reason ?? "market inactive"}
              {notReady.coverage != null && notReady.coverage > 0 && ` · coverage ${(notReady.coverage * 100).toFixed(0)}%`}
            </>
          ) : (
            <>Market data not ready yet — coverage {((notReady.coverage ?? 0) * 100).toFixed(0)}%</>
          )}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-[var(--panel)] border-b border-[var(--border)]">
            <tr>
              {COLUMNS.map(({ key, label, align }) => (
                <th
                  key={key}
                  onClick={() => key !== "__status" ? handleSort(key as ColKey) : undefined}
                  className={[
                    "px-3 py-2.5 text-[11px] uppercase tracking-wide font-medium select-none whitespace-nowrap transition-colors",
                    key !== "__status" ? "cursor-pointer hover:bg-[var(--muted)] hover:text-[var(--foreground)]" : "",
                    key !== "__status" && sortBy === key ? "text-blue-500" : "text-[var(--muted-foreground)]",
                    align === "right" ? "text-right" : "text-left",
                  ].join(" ")}
                >
                  {label}
                  {key !== "__status" && <SortIcon active={sortBy === key} dir={sortDir} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && visibleRows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-3 py-16 text-center text-sm text-[var(--muted-foreground)]">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && visibleRows.length === 0 && !error && !notReady && (
              <tr>
                <td colSpan={colCount} className="px-3 py-16 text-center text-sm text-[var(--muted-foreground)]">
                  {tradeableOnly
                    ? "No READY signals right now — try ALL mode"
                    : "No stocks match current filters — market may be inactive or data still loading"}
                </td>
              </tr>
            )}
            {visibleRows.map((row, i) => {
              const pos    = row.change_percent >= 0;
              const status = stageToStatus(row.stage);
              const score  = row.score ?? 0;
              return (
                <tr
                  key={row.symbol}
                  onClick={() => router.push(`/research/${row.symbol}`)}
                  className={[
                    "border-b border-[var(--border)] transition-colors cursor-pointer",
                    i % 2 !== 0 ? "bg-[var(--muted)]/30" : "",
                    "hover:bg-[var(--muted)]",
                    status === "READY" ? "hover:bg-emerald-950/20" : "",
                  ].join(" ")}
                >
                  {/* Playbook tier + score */}
                  <td className="px-3 py-2 min-w-[140px]">
                    {(() => {
                      const t  = getPlaybookTier(score, score, false) as PlaybookTier;
                      const ts = TIER_STYLE[t];
                      return (
                        <div className="flex flex-col gap-0.5">
                          <span className={`inline-block w-fit px-1.5 py-0.5 rounded text-[10px] font-bold border ${ts.badge}`}>
                            {playbookLabel(t)}
                          </span>
                          <span className="text-[10px] text-[var(--muted-foreground)]">{score > 0 ? `${score}/100` : "—"}</span>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 font-semibold tracking-wide text-xs whitespace-nowrap">
                    <span className="text-blue-400">{row.symbol}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--foreground)] text-xs tabular-nums">
                    {fmtPrice(row.price)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold text-xs tabular-nums ${pos ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                    {pos ? "+" : ""}{row.change_percent.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--foreground)] text-xs tabular-nums">
                    {fmtVol(row.volume)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <RvolCell rvol={row.relative_volume} />
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--muted-foreground)] text-xs tabular-nums">
                    {fmtVol(row.avg_volume_30d)}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--foreground)] text-xs tabular-nums">
                    {fmtMcap(row.market_cap)}
                  </td>
                  <td className="px-3 py-2 text-[var(--muted-foreground)] text-xs max-w-[130px] truncate">
                    {row.sector}
                  </td>
                  <td className="px-3 py-2">
                    <CatalystBadge type={row.catalyst_type} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {!tradeableOnly && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] bg-[var(--panel)] shrink-0 text-xs text-[var(--muted-foreground)]">
          <span>
            {totalCount > 0 ? `${start}–${end} of ${totalCount.toLocaleString()}` : "0 results"}
          </span>

          <div className="flex items-center gap-1">
            {(["«", "‹"] as const).map((label, idx) => (
              <button
                key={label}
                onClick={() => setPage(idx === 0 ? 1 : (p) => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="px-2 py-1 rounded border border-[var(--border)] disabled:opacity-30 hover:bg-[var(--muted)] transition-colors"
              >
                {label}
              </button>
            ))}
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let pg: number;
              if (totalPages <= 7)             pg = i + 1;
              else if (page <= 4)              pg = i + 1;
              else if (page >= totalPages - 3) pg = totalPages - 6 + i;
              else                             pg = page - 3 + i;
              return (
                <button
                  key={pg}
                  onClick={() => setPage(pg)}
                  disabled={loading}
                  className={[
                    "min-w-[28px] px-1.5 py-1 rounded border text-xs transition-colors",
                    pg === page
                      ? "border-blue-500 bg-blue-500/15 text-blue-500"
                      : "border-[var(--border)] hover:bg-[var(--muted)] text-[var(--muted-foreground)]",
                  ].join(" ")}
                >
                  {pg}
                </button>
              );
            })}
            {(["›", "»"] as const).map((label, idx) => (
              <button
                key={label}
                onClick={() => setPage(idx === 0 ? (p) => Math.min(totalPages, p + 1) : totalPages)}
                disabled={page >= totalPages || loading}
                className="px-2 py-1 rounded border border-[var(--border)] disabled:opacity-30 hover:bg-[var(--muted)] transition-colors"
              >
                {label}
              </button>
            ))}
          </div>

          <span>Page {page} of {totalPages}</span>
        </div>
      )}

      </> /* end activeTab !== IN_PLAY */}
    </div>
  );
}
