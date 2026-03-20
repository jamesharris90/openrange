import type { HeatmapRow } from "@/lib/types";

import { normalizeDataSource } from "@/lib/data-source";

import { asNumber, asString, pickDataArray } from "./parse";

export type HeatmapContract = {
  symbol: string;
  price?: number;
  change_percent: number;
  relative_volume?: number;
  gap_percent?: number;
  market_cap?: number;
  volume?: number;
  volume_24h?: number;
  sector?: string;
  source?: string;
  avg_volume_30d?: number;
  last_updated?: string;
};

export function adaptHeatmapPayload(payload: unknown): HeatmapRow[] {
  const rows = pickDataArray(payload);

  return rows.flatMap((row) => {
    const symbol = asString(row.symbol).toUpperCase();
    const changePercent = asNumber(row.change_percent);

    if (!symbol || !Number.isFinite(changePercent)) {
      return [];
    }

    const marketCap = asNumber(row.market_cap ?? row.float_shares, 0);
    const volume24h = asNumber(row.volume_24h ?? row.volume, 0);
    const rvol = asNumber(row.relative_volume, 0);
    const gap = asNumber(row.gap_percent, 0);
    const flow = asNumber(row.liquidity_surge, 0);

    return [
      {
        symbol,
        sector: asString(row.sector, "Unclassified"),
        source: normalizeDataSource(row.source),
        market_cap: marketCap,
        volume_24h: volume24h,
        gap_percent: gap,
        relative_volume: rvol,
        institutional_flow_score: flow,
        change_percent: changePercent,
      },
    ];
  });
}
