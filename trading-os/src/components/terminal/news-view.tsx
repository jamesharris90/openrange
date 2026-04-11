"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";

import { useTableControls } from "@/hooks/useTableControls";
import { apiFetch } from "@/lib/api/client";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";

// ── types ─────────────────────────────────────────────────────────────────────

type NewsItem = {
  id?: string;
  source_id?: string | null;
  symbol?: string | null;
  symbols?: string[] | null;
  type?: string | null;
  headline?: string | null;
  title?: string | null;
  summary?: string | null;
  source?: string | null;
  publisher?: string | null;
  provider?: string | null;
  url?: string | null;
  published_at?: string | null;
  publishedAt?: string | null;
  sentiment?: string | null;
  catalyst_type?: string | null;
  sector?: string | null;
  news_score?: number | null;
};

type ApiResponse = {
  success?: boolean;
  error?: string;
  ok?: boolean;
  total_count?: number;
  counts?: { all?: number; market?: number; stocks?: number };
  items?: NewsItem[];
  data?: NewsItem[];
};

type NewsTypeTab = "All" | "Market" | "Stocks";
type TimeFilter = "Today" | "24h" | "7d";

// ── helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)    return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "Unknown time";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "Unknown time";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function cleanSource(src: string | null | undefined) {
  if (!src) return null;
  return src.replace(/^https?:\/\//i, "").split("/")[0].replace(/^www\./i, "").slice(0, 26);
}

const REFRESH_MS = 60_000;

type NewsFilters = {
  search: string;
  symbol: string;
  time: TimeFilter;
};

const DEFAULT_FILTERS: NewsFilters = {
  search: "",
  symbol: "",
  time: "24h",
};

function isMarketNewsItem(item: NewsItem) {
  return item.type === "macro" || (!item.symbol && (!item.symbols || item.symbols.length === 0));
}

// ── component ─────────────────────────────────────────────────────────────────

export function NewsView() {
  const router = useRouter();
  const [items,          setItems]          = useState<NewsItem[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [lastUpdated,    setLastUpdated]    = useState<Date | null>(null);
  const [totalAvailable, setTotalAvailable] = useState<number>(0);
  const [serverCounts,   setServerCounts]   = useState({ all: 0, market: 0, stocks: 0 });

  const [newsType,       setNewsType]       = useState<NewsTypeTab>("All");

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const {
    filters,
    setFilters,
    resetFilters,
    page,
    setPage,
    pageSize,
  } = useTableControls<NewsItem, NewsFilters>(items, DEFAULT_FILTERS, { pageSize: 50 });
  const debouncedSearch = useDebouncedValue(filters.search, 150);

  const fetchNews = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        page: String(page),
        window: filters.time,
        type: newsType === "All" ? "all" : newsType.toLowerCase(),
      });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (filters.symbol.trim()) params.set("filterSymbol", filters.symbol.trim().toUpperCase());
      const res = await apiFetch(`/api/news?${params.toString()}`, {
        cache: "no-store",
        signal: abortRef.current.signal,
      });

      let payload: ApiResponse | NewsItem[] | null = null;
      try {
        payload = (await res.json()) as ApiResponse | NewsItem[];
      } catch (jsonError) {
        console.error("[NEWS_VIEW] failed to parse /api/news payload", jsonError);
      }

      if (!res.ok) {
        const detail = !Array.isArray(payload) && payload?.error ? payload.error : `Request failed (${res.status})`;
        console.error("[NEWS_VIEW] /api/news failed", { status: res.status, detail, payload });
        throw new Error("⚠️ News unavailable (API error or timeout)");
      }

      const list = Array.isArray(payload) ? payload : payload?.items ?? payload?.data ?? [];
      const normalized = list
        .map((item, index) => {
          const normalizedSymbols = Array.from(new Set((item.symbols ?? [])
            .map((entry) => String(entry || "").trim().toUpperCase())
            .filter(Boolean)));
          const primarySymbol = String(item.symbol || normalizedSymbols[0] || "").trim().toUpperCase();
          return {
            ...item,
            id: item.id ?? item.source_id ?? `${primarySymbol || "macro"}-${item.published_at || "unknown"}-${index}`,
            symbol: item.type === "macro" ? null : (primarySymbol || null),
            symbols: normalizedSymbols,
            headline: item.headline ?? item.title ?? null,
            title: item.title ?? item.headline ?? null,
            published_at: item.published_at ?? item.publishedAt ?? null,
          };
        })
        .sort((left, right) => {
          const leftTime = left.published_at ? Date.parse(left.published_at) : 0;
          const rightTime = right.published_at ? Date.parse(right.published_at) : 0;
          return rightTime - leftTime;
        });

      setItems(normalized);
      setTotalAvailable(Array.isArray(payload) ? normalized.length : Number(payload?.total_count) || normalized.length);
      setServerCounts({
        all: Number(payload && !Array.isArray(payload) ? payload.counts?.all : normalized.length) || 0,
        market: Number(payload && !Array.isArray(payload) ? payload.counts?.market : 0) || 0,
        stocks: Number(payload && !Array.isArray(payload) ? payload.counts?.stocks : 0) || 0,
      });
      setLastUpdated(new Date());
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        console.error("[NEWS_VIEW] load failed", e);
        setError("⚠️ News unavailable (API error or timeout)");
      }
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filters.symbol, filters.time, newsType, page, pageSize]);

  useEffect(() => {
    fetchNews();
    timerRef.current = setInterval(() => fetchNews(), REFRESH_MS);
    return () => {
      clearInterval(timerRef.current!);
      abortRef.current?.abort();
    };
  }, [fetchNews]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters.symbol, filters.time, newsType, setPage]);

  const symbolOptions = useMemo(() => {
    const symbols = new Set<string>();
    items.forEach((item) => {
      (item.symbols ?? []).forEach((entry) => {
        const symbol = String(entry || "").trim().toUpperCase();
        if (symbol) symbols.add(symbol);
      });
    });
    return Array.from(symbols).sort();
  }, [items]);

  const totalCount = totalAvailable;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const paginatedData = useMemo(() => items, [items]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, setPage, totalPages]);

  const marketCount = serverCounts.market;
  const stockCount  = serverCounts.stocks;

  return (
    <div className="flex flex-col h-full bg-[var(--background)]">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--panel)] shrink-0">
        <h1 className="text-sm font-semibold text-[var(--foreground)]">News Feed</h1>
        <span className="text-xs text-[var(--muted-foreground)]">
          {loading ? "Loading…" : `${Math.min(items.length, totalAvailable).toLocaleString()} loaded${totalAvailable > items.length ? ` of ${totalAvailable.toLocaleString()}` : ` of ${totalAvailable.toLocaleString()}`}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-[var(--muted-foreground)]">
            {!loading && lastUpdated ? `Updated ${timeAgo(lastUpdated.toISOString())}` : ""}
          </span>
          <button
            onClick={() => fetchNews()}
            disabled={loading}
            className="px-3 py-1 rounded text-xs bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ── Type tabs ── */}
      <div className="flex gap-1 px-4 pt-3 pb-0 bg-[var(--panel)] shrink-0">
        {(["All", "Market", "Stocks"] as NewsTypeTab[]).map((tab) => {
          const count = tab === "All" ? serverCounts.all : tab === "Market" ? marketCount : stockCount;
          const active = newsType === tab;
          return (
            <button
              key={tab}
              onClick={() => setNewsType(tab)}
              className={[
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t border-b-2 transition-colors",
                active
                  ? "border-blue-500 text-blue-500 bg-blue-500/10"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              ].join(" ")}
            >
              {tab}
              <span className={`text-[10px] px-1 py-0.5 rounded-full ${active ? "bg-blue-500/20 text-blue-500" : "bg-[var(--muted)] text-[var(--muted-foreground)]"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Filter bar ── */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-4 py-2.5 shrink-0">
        <input
          placeholder="Search symbol or keyword…"
          value={filters.search}
          onChange={(event) => setFilters({ search: event.target.value })}
          className="w-52 rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-blue-500"
        />

        <select
          value={filters.symbol}
          onChange={(event) => setFilters({ symbol: event.target.value })}
          className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs text-[var(--foreground)] focus:outline-none focus:border-blue-500"
        >
          <option value="">All Symbols</option>
          {symbolOptions.map((symbol) => (
            <option key={symbol} value={symbol}>{symbol}</option>
          ))}
        </select>

        <select
          value={filters.time}
          onChange={(event) => setFilters({ time: event.target.value as TimeFilter })}
          className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs text-[var(--foreground)] focus:outline-none focus:border-blue-500"
        >
          <option value="Today">Today</option>
          <option value="24h">24h</option>
          <option value="7d">7d</option>
        </select>

        {(filters.search || filters.symbol || filters.time !== DEFAULT_FILTERS.time || newsType !== "All") && (
          <button
            onClick={() => {
              resetFilters();
              setNewsType("All");
            }}
            className="px-2 py-1 rounded text-xs border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-4 rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-4 py-3 text-sm text-[var(--destructive)]">
            {error}
          </div>
        )}
        {loading && items.length === 0 && (
          <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">Loading…</div>
        )}
        {!loading && paginatedData.length === 0 && (
          <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">
            No news articles match your filters.
          </div>
        )}

        {paginatedData.map((item, i) => {
          const headline = item.headline ?? item.title ?? "—";
          const isMarket = isMarketNewsItem(item);
          const displaySymbols = Array.from(new Set((item.symbols ?? [])
            .map((entry) => String(entry || "").trim().toUpperCase())
            .filter(Boolean))).slice(0, 3);
          const remainingSymbols = Math.max(0, ((item.symbols ?? []).filter(Boolean).length) - displaySymbols.length);
          const isResearchRow = !isMarket && displaySymbols.length === 1;
          return (
            <div
              key={item.id ?? `${item.symbol}-${i}`}
              onClick={() => {
                if (isResearchRow) {
                  router.push(`/research/${encodeURIComponent(displaySymbols[0])}`);
                }
              }}
              className={`flex gap-3 px-4 py-3 border-b border-[var(--border)] transition-colors hover:bg-[var(--muted)] ${i % 2 !== 0 ? "bg-[var(--muted)]/20" : ""} ${isResearchRow ? "cursor-pointer" : ""}`}
            >
              {/* Time */}
              <div className="w-12 shrink-0 pt-0.5">
                <div className="text-[11px] text-[var(--muted-foreground)] tabular-nums">{fmtTime(item.published_at)}</div>
                {item.published_at ? (
                  <div className="text-[10px] text-[var(--muted-foreground)]/60">{timeAgo(item.published_at)}</div>
                ) : null}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  {/* Market vs Stock badge */}
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold border tracking-wide ${
                    isMarket
                      ? "bg-slate-500/15 text-slate-400 border-slate-500/30"
                      : "bg-green-500/15 text-green-500 border-green-500/30"
                  }`}>
                    {isMarket ? "MARKET" : "STOCK"}
                  </span>

                  {displaySymbols.map((symbol) => (
                    <span
                      key={symbol}
                      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border bg-blue-500/15 text-blue-500 border-blue-500/30 tracking-wide cursor-pointer hover:bg-blue-500/30 transition-colors"
                      onClick={(e) => { e.stopPropagation(); router.push(`/research/${symbol}`); }}
                    >
                      {symbol}
                    </span>
                  ))}
                  {remainingSymbols > 0 ? (
                    <span className="text-[10px] text-[var(--muted-foreground)]">+{remainingSymbols}</span>
                  ) : null}
                  {item.sector && (
                    <span className="text-[10px] text-[var(--muted-foreground)]">{item.sector}</span>
                  )}
                  {item.sentiment && item.sentiment !== "neutral" && (
                    <span className="text-[10px] font-semibold uppercase text-[var(--muted-foreground)]">
                      {item.sentiment}
                    </span>
                  )}
                </div>
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="text-[13px] text-[var(--foreground)] hover:text-blue-500 transition-colors leading-snug block">
                    {headline}
                  </a>
                ) : (
                  <p className="text-[13px] text-[var(--foreground)] leading-snug">{headline}</p>
                )}
                {item.summary && (
                  <p className="mt-1 text-[11px] text-[var(--muted-foreground)] leading-snug line-clamp-2">
                    {item.summary}
                  </p>
                )}
                <div className="mt-2 text-[10px] text-[var(--muted-foreground)]/70">
                  {fmtDateTime(item.published_at)}
                  {item.published_at ? ` · Last updated ${timeAgo(item.published_at)}` : ""}
                </div>
              </div>

              {/* Source */}
              <div className="w-28 shrink-0 text-right pt-0.5">
                <div className="text-[10px] text-[var(--muted-foreground)] truncate max-w-[112px]">
                  {item.publisher || cleanSource(item.source) || item.provider || "—"}
                </div>
                {item.source && (
                  <div className="text-[9px] text-[var(--muted-foreground)]/50 truncate max-w-[112px]">{cleanSource(item.source)}</div>
                )}
              </div>
            </div>
          );
        })}

        {totalAvailable > 0 ? (
          <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-xs text-[var(--muted-foreground)]">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="rounded border border-[var(--border)] px-3 py-1 transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <span>{`Page ${page} of ${totalPages}`}</span>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="rounded border border-[var(--border)] px-3 py-1 transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
