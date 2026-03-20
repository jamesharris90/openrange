import type { MarketQuote, PricePoint } from "@/lib/types";

import { normalizeDataSource } from "@/lib/data-source";

import { asNumber, asString, asTimestamp, pickDataArray } from "./parse";

export type MarketQuoteContract = {
  symbol: string;
  price: number;
  change_percent: number;
  volume: number;
  market_cap?: number;
  sector?: string;
  source?: string;
};

export type MarketOHLCContract = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function adaptMarketQuotesPayload(payload: unknown): MarketQuote[] {
  const rows = pickDataArray(payload);

  return rows.flatMap((row) => {
    const symbol = asString(row.symbol).toUpperCase();
    const price = asNumber(row.price);
    const changePercent = asNumber(row.change_percent ?? row.changePercent ?? row.change);
    const volume = asNumber(row.volume ?? row.volume_24h);

    if (!symbol || !Number.isFinite(price) || !Number.isFinite(changePercent) || !Number.isFinite(volume)) {
      return [];
    }

    return [
      {
        symbol,
        price,
        change_percent: changePercent,
        volume_24h: volume,
        market_cap: asNumber(row.market_cap, Number.NaN),
        sector: asString(row.sector || undefined),
        source: normalizeDataSource(row.source),
      },
    ];
  });
}

export function adaptOHLCPayload(payload: unknown): PricePoint[] {
  const rows = pickDataArray(payload);

  return rows
    .map((row) => {
      const close = asNumber(row.close);
      const open = asNumber(row.open ?? row.close);
      const high = asNumber(row.high ?? row.close);
      const low = asNumber(row.low ?? row.close);
      const volume = asNumber(row.volume, 0);
      const time = asTimestamp(row.time ?? row.timestamp ?? row.date);

      return {
        time,
        open,
        high,
        low,
        close,
        volume,
      };
    })
    .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.close));
}
