"use client";

import { useQuery } from "@tanstack/react-query";

import { ChartEngine } from "@/components/charts/chart-engine";
import { getMarketQuotes } from "@/lib/api/markets";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";

const symbols = ["SPY", "QQQ", "IWM", "VIX"];

export function MarketsView() {
  const { data: quotes = [] } = useQuery({
    queryKey: queryKeys.marketQuotes(symbols),
    queryFn: () => getMarketQuotes(symbols),
    ...QUERY_POLICY.fast,
  });

  return (
    <div className="space-y-4">
      <section className="grid gap-4 lg:grid-cols-2">
        {symbols.map((symbol) => (
          <ChartEngine key={symbol} ticker={symbol} timeframe="daily" />
        ))}
      </section>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {symbols.map((symbol) => {
          const quote = quotes.find((item) => item.symbol === symbol);
          const change = quote?.change_percent || 0;

          return (
          <article key={`${symbol}-quote`} className="rounded-2xl border border-slate-800 bg-panel p-3 shadow-lg">
            <div className="mb-1 font-mono text-xs text-slate-100">{symbol}</div>
            <div className="text-xl font-semibold text-slate-100">${Number(quote?.price || 0).toFixed(2)}</div>
            <div className={`text-xs ${change >= 0 ? "text-bull" : "text-bear"}`}>{change.toFixed(2)}%</div>
          </article>
          );
        })}
      </section>
    </div>
  );
}
