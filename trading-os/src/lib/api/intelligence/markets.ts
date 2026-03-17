import type { MarketQuote, PricePoint } from "@/lib/types";

import { apiGet } from "@/lib/api/client";

export async function getMarketQuotes(symbols: string[]): Promise<MarketQuote[]> {
  const query = encodeURIComponent(symbols.join(","));
  const response = await apiGet<{ data?: MarketQuote[] }>(`/api/intelligence/markets?symbols=${query}`);
  const rows = response.data;
  if (!Array.isArray(rows)) {
    throw new Error("No data returned from API");
  }
  return rows;
}

export async function getMarketChart(symbol: string, timeframe: "daily" | "5m" | "1m"): Promise<PricePoint[]> {
  if (timeframe === "daily") {
    const response = await apiGet<{ data?: PricePoint[] }>(`/api/ohlc/daily?symbol=${encodeURIComponent(symbol)}`);
    if (!response.data) {
      throw new Error("No data returned from API");
    }
    return response.data;
  }

  const response = await apiGet<{ data?: PricePoint[] }>(
    `/api/ohlc/intraday?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`
  );
  if (!response.data) {
    throw new Error("No data returned from API");
  }
  return response.data;
}

export async function getMarketRegime() {
  const response = await apiGet<{ data?: { regime?: Record<string, unknown> } }>("/api/intelligence/markets");
  const regime = response.data?.regime || {};

  const vix = Number(regime.vix ?? regime.vix_value ?? 0);
  const breadth = Number(regime.breadth ?? regime.market_breadth ?? 0);
  const putCall = Number(regime.put_call ?? regime.putCall ?? 0);
  const label = String(regime.regime || regime.market_regime || "Neutral");

  return {
    vix: Number.isFinite(vix) ? vix : 0,
    breadth: Number.isFinite(breadth) ? breadth : 0,
    put_call: Number.isFinite(putCall) ? putCall : 0,
    regime: label,
  };
}
