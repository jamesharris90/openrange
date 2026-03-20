"use client";

import { useQuery } from "@tanstack/react-query";

import { getMarketQuotes } from "@/lib/api/markets";
import { percentSafe, toFixedSafe } from "@/lib/number";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";
import { useTickerStore } from "@/lib/store/ticker-store";
import { normalizeSymbolForUI } from "@/lib/symbol-normalizer";

export function TickerStrip() {
  const watchlist = useTickerStore((state) => state.watchlist);
  const activeTicker = useTickerStore((state) => state.activeTicker);
  const setTicker = useTickerStore((state) => state.setTicker);

  const symbols = Array.from(new Set(watchlist)).slice(0, 12);

  const { data = [] } = useQuery({
    queryKey: queryKeys.marketQuotes(symbols),
    queryFn: () => getMarketQuotes(symbols),
    ...QUERY_POLICY.fast,
  });

  const quoteMap = new Map(data.map((row) => [row.symbol.toUpperCase(), row]));
  const visibleSymbols = symbols.filter((symbol) => quoteMap.has(symbol.toUpperCase()));

  if (visibleSymbols.length === 0) {
    return (
      <div className="border-t border-slate-800/90 bg-slate-950/60 px-3 py-2 text-xs text-slate-500">
        No data available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border-t border-slate-800/90 bg-slate-950/60 py-2">
      <div className="flex min-w-max gap-2 px-1">
        {visibleSymbols.map((symbol) => {
          const quote = quoteMap.get(symbol.toUpperCase());
          const change = Number(quote?.change_percent ?? Number.NaN);
          const price = Number(quote?.price ?? Number.NaN);
          const isUp = Number.isFinite(change) && change >= 0;
          const isActive = activeTicker === symbol;

          return (
            <button
              key={symbol}
              type="button"
              onClick={() => setTicker(symbol)}
              className={`rounded-lg border px-2 py-1 text-left transition ${
                isActive
                  ? "border-cyan-400/60 bg-cyan-500/10"
                  : "border-slate-700 bg-slate-900/80 hover:border-slate-500"
              }`}
            >
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-mono text-slate-100">{normalizeSymbolForUI(symbol)}</span>
                <span className={isUp ? "text-emerald-300" : "text-rose-300"}>
                  {Number.isFinite(change) ? percentSafe(change, 2) : "N/A"}
                </span>
              </div>
              <div className="text-[11px] text-slate-300">
                {Number.isFinite(price) ? `$${toFixedSafe(price, 2)}` : "No price"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
