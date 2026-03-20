import type { MarketQuote, PricePoint } from "@/lib/types";

import { apiGet } from "@/lib/api/client";
import { adaptMarketQuotesPayload, adaptOHLCPayload } from "@/lib/adapters";
import { normalizeDataSource } from "@/lib/data-source";
import { debugLog } from "@/lib/debug";

export async function getMarketQuotes(symbols: string[]): Promise<MarketQuote[]> {
  const uniqueSymbols = Array.from(new Set(symbols.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)));
  if (uniqueSymbols.length === 0) return [];
  const payload = await apiGet<Record<string, unknown>>(
    `/api/intelligence/markets?symbols=${encodeURIComponent(uniqueSymbols.join(","))}`
  );
  const rows = adaptMarketQuotesPayload(payload);
  debugLog("getMarketQuotes", rows);

  return rows.map((row) => ({
    symbol: row.symbol,
    price: row.price,
    change_percent: row.change_percent,
    volume_24h: row.volume_24h,
    source: normalizeDataSource(row.source || "none"),
  }));
}

export async function getMarketChart(symbol: string, timeframe: "daily" | "5m" | "1m"): Promise<PricePoint[]> {
  if (timeframe === "daily") {
    const response = await apiGet<{ data?: PricePoint[] }>(`/api/ohlc/daily?symbol=${encodeURIComponent(symbol)}`);
    debugLog("/api/ohlc/daily", response);
    const mapped = adaptOHLCPayload(response);
    debugLog("chart raw", (Array.isArray(response.data) ? response.data : []).slice(0, 5));
    debugLog("chart mapped", mapped.slice(0, 5));
    return mapped;
  }

  const response = await apiGet<{ data?: PricePoint[] }>(
    `/api/ohlc/intraday?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`
  );
  debugLog("/api/intraday", response);
  const mapped = adaptOHLCPayload(response);
  debugLog("chart raw", (Array.isArray(response.data) ? response.data : []).slice(0, 5));
  debugLog("chart mapped", mapped.slice(0, 5));
  return mapped;
}

export async function getMarketRegime() {
  const response = await apiGet<{ data?: { regime?: Record<string, unknown> } }>("/api/intelligence/markets");
  const regime = response.data?.regime || {};

  const vix = Number(regime.vix ?? regime.vix_value);
  const breadth = Number(regime.breadth ?? regime.market_breadth);
  const putCall = Number(regime.put_call ?? regime.putCall);
  const label = String(regime.regime || regime.market_regime || "Neutral");

  return {
    vix: Number.isFinite(vix) ? vix : Number.NaN,
    breadth: Number.isFinite(breadth) ? breadth : Number.NaN,
    put_call: Number.isFinite(putCall) ? putCall : Number.NaN,
    regime: label,
  };
}
