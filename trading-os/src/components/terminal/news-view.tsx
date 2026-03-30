"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";

// ── types ─────────────────────────────────────────────────────────────────────

type NewsItem = {
  id?: string;
  symbol?: string | null;
  headline?: string | null;
  title?: string | null;
  summary?: string | null;
  source?: string | null;
  provider?: string | null;
  url?: string | null;
  published_at?: string | null;
  sentiment?: string | null;
  catalyst_type?: string | null;
  sector?: string | null;
  news_score?: number | null;
};

type ApiResponse = { ok?: boolean; items?: NewsItem[]; data?: NewsItem[] };

type NewsTypeTab = "All" | "Market" | "Stocks";
type FreshnessOpt = "All" | "1h" | "4h" | "24h" | "7d";
type SentimentOpt = "All" | "Positive" | "Negative" | "Neutral";

// ── helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)    return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function cleanSource(src: string | null | undefined) {
  if (!src) return null;
  return src.replace(/^https?:\/\//i, "").split("/")[0].replace(/^www\./i, "").slice(0, 26);
}

const SENTIMENT_STYLE: Record<string, string> = {
  positive: "text-[var(--bull)]",
  negative: "text-[var(--bear)]",
  neutral:  "text-[var(--muted-foreground)]",
};

const REFRESH_MS = 60_000;

const FRESHNESS_MS: Record<FreshnessOpt, number> = {
  All: Infinity,
  "1h":  3_600_000,
  "4h":  14_400_000,
  "24h": 86_400_000,
  "7d":  604_800_000,
};

// ── component ─────────────────────────────────────────────────────────────────

export function NewsView() {
  const router = useRouter();
  const [items,          setItems]          = useState<NewsItem[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [lastUpdated,    setLastUpdated]    = useState<Date | null>(null);

  // filters
  const [newsType,       setNewsType]       = useState<NewsTypeTab>("All");
  const [freshness,      setFreshness]      = useState<FreshnessOpt>("All");
  const [sentiment,      setSentiment]      = useState<SentimentOpt>("All");
  const [symbolFilter,   setSymbolFilter]   = useState("");
  const [sectorFilter,   setSectorFilter]   = useState("All");
  const [sourceFilter,   setSourceFilter]   = useState("All");
  const [keywordFilter,  setKeywordFilter]  = useState("");
  const [keywordInput,   setKeywordInput]   = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNews = useCallback(async (sym: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "300" });
      if (sym) params.set("symbol", sym.trim().toUpperCase());
      const res = await fetch(`/api/news/latest?${params}`, {
        cache: "no-store",
        signal: abortRef.current.signal,
      });
      const d = (await res.json()) as ApiResponse;
      const list = d.items ?? d.data ?? (Array.isArray(d) ? (d as NewsItem[]) : []);
      setItems(list);
      setLastUpdated(new Date());
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews(symbolFilter);
    timerRef.current = setInterval(() => fetchNews(symbolFilter), REFRESH_MS);
    return () => {
      clearInterval(timerRef.current!);
      abortRef.current?.abort();
    };
  }, [fetchNews, symbolFilter]);

  // Derive unique sectors and sources from data
  const availableSectors = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => { if (i.sector) s.add(i.sector); });
    return ["All", ...Array.from(s).sort()];
  }, [items]);

  const availableSources = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => {
      // Use publisher name for stock news, or provider for general news
      const pub = i.publisher || i.provider || "";
      if (pub) s.add(pub);
    });
    // Limit to top 15 most useful sources
    return ["All", ...Array.from(s).sort().slice(0, 15)];
  }, [items]);

  const now = Date.now();
  const displayed = useMemo(() => {
    return items.filter((item) => {
      // News type: Market (no symbol) vs Stocks (has symbol)
      if (newsType === "Market" && item.symbol) return false;
      if (newsType === "Stocks" && !item.symbol) return false;

      // Freshness
      if (freshness !== "All" && item.published_at) {
        const diff = now - new Date(item.published_at).getTime();
        if (diff > FRESHNESS_MS[freshness]) return false;
      }

      // Sentiment
      if (sentiment !== "All") {
        const s = (item.sentiment ?? "neutral").toLowerCase();
        if (s !== sentiment.toLowerCase()) return false;
      }

      // Sector
      if (sectorFilter !== "All") {
        if ((item.sector ?? "") !== sectorFilter) return false;
      }

      // Source/Publisher
      if (sourceFilter !== "All") {
        const pub = item.publisher || item.provider || "";
        if (pub !== sourceFilter) return false;
      }

      // Keyword in headline
      if (keywordFilter) {
        const kw = keywordFilter.toLowerCase();
        const headline = (item.headline ?? item.title ?? "").toLowerCase();
        const summary = (item.summary ?? "").toLowerCase();
        if (!headline.includes(kw) && !summary.includes(kw)) return false;
      }

      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, newsType, freshness, sentiment, sectorFilter, sourceFilter, keywordFilter, now]);

  // Counts for type tabs
  const marketCount = useMemo(() => items.filter((i) => !i.symbol).length, [items]);
  const stockCount  = useMemo(() => items.filter((i) => !!i.symbol).length, [items]);

  return (
    <div className="flex flex-col h-full bg-[var(--background)]">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--panel)] shrink-0">
        <h1 className="text-sm font-semibold text-[var(--foreground)]">News Feed</h1>
        <span className="text-xs text-[var(--muted-foreground)]">
          {loading ? "Loading…" : `${displayed.length} of ${items.length} articles`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-[var(--muted-foreground)]">
            {!loading && lastUpdated ? `Updated ${timeAgo(lastUpdated.toISOString())}` : ""}
          </span>
          <button
            onClick={() => fetchNews(symbolFilter)}
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
          const count = tab === "All" ? items.length : tab === "Market" ? marketCount : stockCount;
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
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--panel)] shrink-0">

        {/* Freshness chips */}
        <div className="flex items-center gap-1">
          {(["All", "1h", "4h", "24h", "7d"] as FreshnessOpt[]).map((f) => (
            <button
              key={f}
              onClick={() => setFreshness(f)}
              className={[
                "px-2 py-0.5 rounded text-[11px] font-medium border transition-colors",
                freshness === f
                  ? "bg-blue-500 border-blue-500 text-white"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
              ].join(" ")}
            >
              {f === "All" ? "All Time" : f}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-[var(--border)]" />

        {/* Sentiment */}
        <select
          value={sentiment}
          onChange={(e) => setSentiment(e.target.value as SentimentOpt)}
          className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs text-[var(--foreground)] focus:outline-none focus:border-blue-500"
        >
          {(["All", "Positive", "Negative", "Neutral"] as SentimentOpt[]).map((s) => (
            <option key={s} value={s}>{s === "All" ? "All Sentiment" : s}</option>
          ))}
        </select>

        {/* Sector */}
        {availableSectors.length > 1 && (
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs text-[var(--foreground)] focus:outline-none focus:border-blue-500"
          >
            {availableSectors.map((s) => (
              <option key={s} value={s}>{s === "All" ? "All Sectors" : s}</option>
            ))}
          </select>
        )}

        {/* Source */}
        {availableSources.length > 1 && (
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs text-[var(--foreground)] focus:outline-none focus:border-blue-500"
          >
            {availableSources.map((s) => (
              <option key={s} value={s}>{s === "All" ? "All Sources" : s}</option>
            ))}
          </select>
        )}

        <div className="w-px h-4 bg-[var(--border)]" />

        {/* Ticker search */}
        <input
          placeholder="Ticker…"
          defaultValue={symbolFilter}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const val = (e.target as HTMLInputElement).value.trim().toUpperCase();
              setSymbolFilter(val);
            }
          }}
          className="w-24 rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-blue-500"
        />

        {/* Keyword search */}
        <input
          placeholder="Search headline…"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setKeywordFilter(keywordInput.trim());
            if (e.key === "Escape") { setKeywordFilter(""); setKeywordInput(""); }
          }}
          className="w-44 rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-blue-500"
        />

        {/* Clear button */}
        {(symbolFilter || keywordFilter || sectorFilter !== "All" || sourceFilter !== "All" || sentiment !== "All" || freshness !== "All" || newsType !== "All") && (
          <button
            onClick={() => {
              setSymbolFilter("");
              setKeywordFilter("");
              setKeywordInput("");
              setSectorFilter("All");
              setSourceFilter("All");
              setSentiment("All");
              setFreshness("All");
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
        {!loading && displayed.length === 0 && (
          <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">
            No news articles match your filters.
          </div>
        )}

        {displayed.map((item, i) => {
          const sentKey = (item.sentiment ?? "neutral").toLowerCase();
          const headline = item.headline ?? item.title ?? "—";
          const isStock = !!item.symbol;
          return (
            <div
              key={item.id ?? `${item.symbol}-${i}`}
              className={`flex gap-3 px-4 py-3 border-b border-[var(--border)] transition-colors hover:bg-[var(--muted)] ${i % 2 !== 0 ? "bg-[var(--muted)]/20" : ""}`}
            >
              {/* Time */}
              <div className="w-12 shrink-0 pt-0.5">
                <div className="text-[11px] text-[var(--muted-foreground)] tabular-nums">{fmtTime(item.published_at)}</div>
                <div className="text-[10px] text-[var(--muted-foreground)]/60">{timeAgo(item.published_at)}</div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  {/* Market vs Stock badge */}
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold border tracking-wide ${
                    isStock
                      ? "bg-green-500/15 text-green-500 border-green-500/30"
                      : "bg-slate-500/15 text-slate-400 border-slate-500/30"
                  }`}>
                    {isStock ? "STOCK" : "MACRO"}
                  </span>

                  {item.symbol && (
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border bg-blue-500/15 text-blue-500 border-blue-500/30 tracking-wide cursor-pointer hover:bg-blue-500/30 transition-colors"
                      onClick={(e) => { e.stopPropagation(); router.push(`/research/${item.symbol}`); }}
                    >
                      {item.symbol}
                    </span>
                  )}
                  {item.sector && (
                    <span className="text-[10px] text-[var(--muted-foreground)]">{item.sector}</span>
                  )}
                  {item.sentiment && item.sentiment !== "neutral" && (
                    <span className={`text-[10px] font-semibold uppercase ${SENTIMENT_STYLE[sentKey] ?? ""}`}>
                      {item.sentiment}
                    </span>
                  )}
                </div>
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer"
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
      </div>
    </div>
  );
}
