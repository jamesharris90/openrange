"use client";

import { useQuery } from "@tanstack/react-query";

import { ChartEngine } from "@/components/charts/chart-engine";
import { apiGet } from "@/lib/api/client";
import { percentSafe, toFixedSafe } from "@/lib/number";
import { QUERY_POLICY } from "@/lib/queries/policy";
import { normalizeSymbolForUI } from "@/lib/symbol-normalizer";

// Core indices always shown regardless of opportunity data
const CORE_SYMBOLS = ["SPY", "QQQ", "IWM", "VIX"];

function toFiniteOrNaN(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : Number.NaN;
}

type FmpQuote = {
  symbol: string;
  price: number;
  change_percent: number;
};

async function fetchFmpQuotes(symbols: string[]): Promise<FmpQuote[]> {
  if (!symbols.length) return [];
  const json = await apiGet<{ data?: Array<Record<string, unknown>> }>(
    `/api/fmp/quotes?symbols=${encodeURIComponent(symbols.join(","))}`
  );
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows.map((r) => ({
    symbol: String(r.symbol || "").toUpperCase(),
    price: Number(r.price) || 0,
    change_percent: Number(r.change_percent) || 0,
  }));
}

export function MarketsView() {
  // Fetch extra symbols from top-opportunities (best effort)
  const opportunitySymbolsQuery = useQuery({
    queryKey: ["market", "dynamic-symbols"],
    queryFn: async () => {
      try {
        const json = await apiGet<{ data?: Array<{ symbol?: string }> }>(
          "/api/intelligence/top-opportunities?limit=8"
        );
        return (json.data || [])
          .map((row) => String(row.symbol || "").toUpperCase())
          .filter((s) => Boolean(s) && !CORE_SYMBOLS.includes(s))
          .slice(0, 4);
      } catch {
        return [] as string[];
      }
    },
    ...QUERY_POLICY.fast,
  });

  const extraSymbols = opportunitySymbolsQuery.data ?? [];
  const allSymbols = [...CORE_SYMBOLS, ...extraSymbols];

  const { data: quotes = [] } = useQuery({
    queryKey: ["market", "fmp-quotes", allSymbols.join(",")],
    queryFn: () => fetchFmpQuotes(allSymbols),
    enabled: allSymbols.length > 0,
    ...QUERY_POLICY.fast,
  });

  const safeQuotes = quotes.map((row) => ({
    ...row,
    price: toFiniteOrNaN(row.price),
    change_percent: toFiniteOrNaN(row.change_percent),
  }));

  // Separate core from opportunity quotes for layout
  const coreQuotes = safeQuotes.filter((q) => CORE_SYMBOLS.includes(q.symbol));
  const extraQuotes = safeQuotes.filter((q) => !CORE_SYMBOLS.includes(q.symbol));

  const advancing = safeQuotes.filter((q) => Number.isFinite(q.change_percent) && q.change_percent >= 0).length;
  const declining = safeQuotes.filter((q) => Number.isFinite(q.change_percent) && q.change_percent < 0).length;
  const avgMove =
    safeQuotes.length > 0
      ? safeQuotes.reduce((sum, q) => sum + (Number.isFinite(q.change_percent) ? q.change_percent : 0), 0) /
        safeQuotes.length
      : Number.NaN;

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <section className="grid gap-3 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Breadth Snapshot</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">
            {advancing} / {declining}
          </div>
          <div className="text-xs text-slate-400">Advancing vs declining</div>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Average Move</div>
          <div className={`mt-1 text-lg font-semibold ${avgMove >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
            {Number.isFinite(avgMove) ? percentSafe(avgMove, 2) : "—"}
          </div>
          <div className="text-xs text-slate-400">Across tracked symbols</div>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Tracking</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">{safeQuotes.length}</div>
          <div className="text-xs text-slate-400">Symbols with live pricing</div>
        </article>
      </section>

      {/* Core indices quote cards — always visible */}
      <section>
        <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">Core Indices</div>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          {(coreQuotes.length > 0 ? coreQuotes : CORE_SYMBOLS.map((s) => ({ symbol: s, price: NaN, change_percent: NaN }))).map(
            (q) => (
              <article key={q.symbol} className="rounded-2xl border border-slate-800 bg-panel p-3 shadow-lg">
                <div className="mb-1 font-mono text-xs font-semibold text-slate-100">{normalizeSymbolForUI(q.symbol)}</div>
                <div className="text-xl font-semibold text-slate-100">
                  {Number.isFinite(q.price) ? `$${toFixedSafe(q.price, 2)}` : <span className="text-slate-600">—</span>}
                </div>
                <div className={`text-xs ${toFiniteOrNaN(q.change_percent) >= 0 ? "text-bull" : "text-bear"}`}>
                  {Number.isFinite(q.change_percent) ? percentSafe(q.change_percent, 2) : <span className="text-slate-600">—</span>}
                </div>
              </article>
            )
          )}
        </div>
      </section>

      {/* Core indices charts */}
      <section className="grid gap-4 lg:grid-cols-2">
        {CORE_SYMBOLS.filter((s) => s !== "VIX").map((symbol) => (
          <ChartEngine key={symbol} ticker={symbol} timeframe="1m" />
        ))}
      </section>

      {/* Extra opportunity quotes, if any */}
      {extraQuotes.length > 0 && (
        <section>
          <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">Top Opportunities</div>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            {extraQuotes.map((q) => (
              <article key={q.symbol} className="rounded-2xl border border-slate-800 bg-panel p-3 shadow-lg">
                <div className="mb-1 font-mono text-xs font-semibold text-slate-100">{normalizeSymbolForUI(q.symbol)}</div>
                <div className="text-xl font-semibold text-slate-100">
                  {Number.isFinite(q.price) ? `$${toFixedSafe(q.price, 2)}` : <span className="text-slate-600">—</span>}
                </div>
                <div className={`text-xs ${toFiniteOrNaN(q.change_percent) >= 0 ? "text-bull" : "text-bear"}`}>
                  {Number.isFinite(q.change_percent) ? percentSafe(q.change_percent, 2) : <span className="text-slate-600">—</span>}
                </div>
              </article>
            ))}
          </div>
          <section className="mt-4 grid gap-4 lg:grid-cols-2">
            {extraQuotes.map((q) => (
              <ChartEngine key={q.symbol} ticker={q.symbol} timeframe="1m" />
            ))}
          </section>
        </section>
      )}
    </div>
  );
}
