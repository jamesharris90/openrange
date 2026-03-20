import { normalizeDataSource } from "@/lib/data-source";

import { asArray, asNumber, asObject, asString } from "./parse";

export type CatalystContract = {
  symbol: string;
  catalyst_type: string;
  headline: string;
  source: string;
  sentiment?: string;
  impact_score?: number;
  published_at?: string;
};

export type CatalystItem = {
  symbol: string;
  catalystType: string;
  headline: string;
  source: string;
  sentiment: string;
  impactScore: number;
  publishedAt: string;
};

export function adaptCatalystsPayload(payload: unknown): CatalystItem[] {
  const root = asObject(payload);
  const data = asObject(root.data);
  const items = asArray(data.items);

  return items.flatMap((row) => {
    const symbol = asString(row.symbol).toUpperCase();
    const catalystType = asString(row.catalyst_type, "general");
    const headline = asString(row.headline);

    if (!symbol || !headline) return [];

    return [
      {
        symbol,
        catalystType,
        headline,
        source: normalizeDataSource(row.source),
        sentiment: asString(row.sentiment, "neutral"),
        impactScore: asNumber(row.impact_score, 0),
        publishedAt: asString(row.published_at),
      },
    ];
  });
}
