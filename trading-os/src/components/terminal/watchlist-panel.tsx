"use client";

import { useQuery } from "@tanstack/react-query";

import { getMarketQuotes } from "@/lib/api/markets";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";
import { useTickerStore } from "@/lib/store/ticker-store";

export function WatchlistPanel() {
  const watchlist = useTickerStore((state) => state.watchlist);
  const ticker = useTickerStore((state) => state.activeTicker);
  const setTicker = useTickerStore((state) => state.setTicker);
  const liveQuotes = useTickerStore((state) => state.quotes);

  const { data = [] } = useQuery({
    queryKey: queryKeys.marketQuotes(watchlist),
    queryFn: () => getMarketQuotes(watchlist),
    ...QUERY_POLICY.fast,
  });

  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-3 shadow-lg">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Watchlist</div>
      <div className="space-y-2">
        {watchlist.map((symbol) => {
          const quote = liveQuotes[symbol] || data.find((row) => row.symbol === symbol);
          const change = quote?.change_percent || 0;
          return (
            <button
              key={symbol}
              type="button"
              className={`w-full rounded-xl border px-2 py-2 text-left ${ticker === symbol ? "border-blue-400 bg-slate-900" : "border-slate-800"}`}
              onClick={() => setTicker(symbol)}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-xs text-slate-100">{symbol}</span>
                <span className={`text-xs ${change >= 0 ? "text-bull" : "text-bear"}`}>{change.toFixed(2)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-slate-300">${(quote?.price || 0).toFixed(2)}</span>
                <span className="text-xs text-slate-500">Vol {(quote?.volume_24h || 0).toLocaleString()}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
