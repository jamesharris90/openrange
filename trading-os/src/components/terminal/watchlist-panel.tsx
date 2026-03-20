"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { getMarketQuotes } from "@/lib/api/markets";
import { percentSafe, toFixedSafe, toNumber } from "@/lib/number";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";
import { useTickerStore } from "@/lib/store/ticker-store";

function toFiniteOrNaN(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : Number.NaN;
}

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

  const safeData = data.map((row) => ({
    ...row,
    value: toNumber((row as unknown as { value?: unknown }).value, 0),
    probability: toNumber((row as unknown as { probability?: unknown }).probability, 0),
    confidence: toNumber((row as unknown as { confidence?: unknown }).confidence, 0),
    price: toFiniteOrNaN(row.price),
    change_percent: toFiniteOrNaN(row.change_percent),
    volume_24h: toFiniteOrNaN(row.volume_24h),
  }));

  useEffect(() => {
    const preview = watchlist.slice(0, 5).map((symbol) => {
      const quote = liveQuotes[symbol] || safeData.find((row) => row.symbol === symbol);
      return {
        symbol,
        hasQuote: Boolean(quote),
        price: quote?.price,
        change_percent: quote?.change_percent,
      };
    });
    console.log("WATCHLIST RENDER", { count: watchlist.length, preview });
  }, [watchlist, liveQuotes, safeData]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-3 shadow-lg">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Watchlist</div>
      <div className="space-y-2">
        {watchlist.map((symbol) => {
          const quote = liveQuotes[symbol] || safeData.find((row) => row.symbol === symbol);
          const hasPrice = Number.isFinite(Number(quote?.price));
          const changeValue = toFiniteOrNaN(quote?.change_percent);
          const hasChange = Number.isFinite(changeValue);
          const volumeValue = toFiniteOrNaN(quote?.volume_24h);
          const hasVolume = Number.isFinite(volumeValue);
          return (
            <button
              key={symbol}
              type="button"
              className={`w-full rounded-xl border px-2 py-2 text-left ${ticker === symbol ? "border-blue-400 bg-slate-900" : "border-slate-800"}`}
              onClick={() => setTicker(symbol)}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-xs text-slate-100">{symbol}</span>
                {hasChange ? (
                  <span className={`text-xs ${changeValue >= 0 ? "text-bull" : "text-bear"}`}>{percentSafe(changeValue, 2)}</span>
                ) : (
                  <span className="text-xs text-slate-500">No change data</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-slate-300">{hasPrice ? `$${toFixedSafe(quote?.price, 2)}` : "No price data"}</span>
                <span className="text-xs text-slate-500">{hasVolume ? `Vol ${volumeValue.toLocaleString()}` : "No volume data"}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
