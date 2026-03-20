import type { MarketQuote } from "@/lib/types";

import { cachedFetch } from "@/lib/cache";
import { debugLog } from "@/lib/debug";
import { normalizeSymbolForAPI, normalizeSymbolForUI } from "@/lib/symbol-normalizer";
import { getMarketChart, getMarketRegime } from "@/lib/api/intelligence/markets";

type QuotesResponse = {
  data?: Array<Record<string, unknown>>;
};

export async function fetchMarketQuotes(symbols: string[]): Promise<MarketQuote[]> {
  const normalized = symbols.map(normalizeSymbolForAPI).filter(Boolean).join(",");
  if (!normalized) return [];

  return cachedFetch(`market:quotes:${normalized}`, async () => {
    const res = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(normalized)}`, {
      cache: "no-store",
    });
    const json = (await res.json()) as QuotesResponse;
    const rows = Array.isArray(json.data) ? json.data : [];

    const mapped = rows.map((row) => {
      const symbolRaw = String(row.symbol || "");
      const symbol = normalizeSymbolForUI(symbolRaw).toUpperCase();
      const price = Number(row.price);
      const changePercent = Number(row.change_percent ?? row.changePercent);

      return {
        symbol,
        price: Number.isFinite(price) ? price : Number.NaN,
        change_percent: Number.isFinite(changePercent) ? changePercent : Number.NaN,
      } satisfies MarketQuote;
    });

    debugLog("fetchMarketQuotes", { symbols: normalized, count: mapped.length });
    return mapped;
  });
}

export const getMarketQuotes = fetchMarketQuotes;

export { getMarketChart, getMarketRegime };
