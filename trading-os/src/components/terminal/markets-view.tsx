"use client";

import { useQuery } from "@tanstack/react-query";

import { ChartEngine } from "@/components/charts/chart-engine";
import { fetchMarketQuotes } from "@/lib/api/markets";
import { percentSafe, toFixedSafe } from "@/lib/number";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";
import { normalizeSymbolForUI } from "@/lib/symbol-normalizer";

function toFiniteOrNaN(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : Number.NaN;
}

const symbols = ["SPY", "QQQ", "IWM"];

export function MarketsView() {
  const { data: quotes = [] } = useQuery({
    queryKey: queryKeys.marketQuotes(symbols),
    queryFn: () => fetchMarketQuotes(symbols),
    ...QUERY_POLICY.fast,
  });

  const safeQuotes = quotes.map((row) => ({
    ...row,
    price: toFiniteOrNaN(row.price),
    change_percent: toFiniteOrNaN(row.change_percent),
  }));
  const visibleSymbols = safeQuotes.map((row) => row.symbol);

  const advancing = safeQuotes.filter((row) => Number.isFinite(row.change_percent) && row.change_percent >= 0).length;
  const declining = safeQuotes.filter((row) => Number.isFinite(row.change_percent) && row.change_percent < 0).length;
  const avgMove =
    safeQuotes.length > 0
      ? safeQuotes.reduce((sum, row) => sum + (Number.isFinite(row.change_percent) ? row.change_percent : 0), 0) / safeQuotes.length
      : Number.NaN;

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Breadth Snapshot</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">
            {advancing} / {declining}
          </div>
          <div className="text-xs text-slate-400">Advancing vs declining leaders</div>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Average Move</div>
          <div className={`mt-1 text-lg font-semibold ${avgMove >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
            {Number.isFinite(avgMove) ? percentSafe(avgMove, 2) : "N/A"}
          </div>
          <div className="text-xs text-slate-400">Across live market quotes</div>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Quote Coverage</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">{safeQuotes.length}</div>
          <div className="text-xs text-slate-400">Symbols streaming with current pricing</div>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {visibleSymbols.map((symbol) => (
          <ChartEngine key={symbol} ticker={symbol} timeframe="1m" />
        ))}
      </section>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {safeQuotes.map((q) => (
          <article key={`${q.symbol}-quote`} className="rounded-2xl border border-slate-800 bg-panel p-3 shadow-lg">
            <div className="mb-1 font-mono text-xs text-slate-100">{normalizeSymbolForUI(q.symbol)}</div>
            <div className="text-xl font-semibold text-slate-100">
              {Number.isFinite(toFiniteOrNaN(q.price)) ? `$${toFixedSafe(q.price, 2)}` : "-"}
            </div>
            <div className={`text-xs ${toFiniteOrNaN(q.change_percent) >= 0 ? "text-bull" : "text-bear"}`}>
              {Number.isFinite(toFiniteOrNaN(q.change_percent)) ? percentSafe(q.change_percent, 2) : "0%"}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
