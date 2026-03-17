import type { Opportunity } from "@/lib/types";

import { apiGet } from "@/lib/api/client";

type CatalystRow = {
  news_id?: number;
  symbol?: string;
  catalyst_type?: string;
  headline?: string;
  confidence_score?: number;
  continuation_probability?: number;
  reaction_type?: string;
};

function mapCatalyst(row: CatalystRow): Opportunity {
  const confidenceRaw = Number(row.confidence_score ?? 0) * 100;
  const continuationRaw = Number(row.continuation_probability ?? 0) * 100;
  const probability = Math.max(1, Math.min(99, continuationRaw || confidenceRaw || 50));
  const confidence = Math.max(1, Math.min(99, confidenceRaw || 50));

  return {
    symbol: String(row.symbol || "N/A").toUpperCase(),
    news_id: Number(row.news_id || 0) || undefined,
    strategy: String(row.reaction_type || row.catalyst_type || row.headline || "Catalyst"),
    probability,
    confidence,
    expected_move: 0,
    catalyst: String(row.headline || ""),
  };
}

export async function getCatalystSignals(): Promise<Record<string, Opportunity[]>> {
  const [catalystResponse, reactionResponse] = await Promise.all([
    apiGet<{ items?: CatalystRow[] }>("/api/catalysts/latest?limit=60"),
    apiGet<{ items?: CatalystRow[] }>("/api/catalyst-reactions/latest?limit=60"),
  ]);

  const catalystRows = (catalystResponse.items || []).map(mapCatalyst);
  const reactionRows = (reactionResponse.items || []).map(mapCatalyst);
  const rows = [...reactionRows, ...catalystRows];

  const deduped: Opportunity[] = [];
  const seen = new Set<string>();
  rows.forEach((row) => {
    const key = `${row.news_id || 0}:${row.symbol}:${row.strategy}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(row);
  });

  return {
    catalysts: deduped,
    earnings: deduped.filter((row) => row.strategy.toLowerCase().includes("earn")),
    news: deduped.filter((row) => row.strategy.toLowerCase().includes("news")),
  };
}

export async function getCatalystSignalsBySymbol(symbol: string): Promise<Opportunity[]> {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) return [];

  const [catalysts, reactions] = await Promise.all([
    apiGet<{ items?: CatalystRow[] }>(`/api/catalysts/symbol/${encodeURIComponent(normalized)}?limit=60`),
    apiGet<{ items?: CatalystRow[] }>(`/api/catalyst-reactions/symbol/${encodeURIComponent(normalized)}?limit=60`),
  ]);

  const combined = [
    ...(reactions.items || []).map(mapCatalyst),
    ...(catalysts.items || []).map(mapCatalyst),
  ];

  const seen = new Set<string>();
  return combined.filter((row) => {
    const key = `${row.news_id || 0}:${row.symbol}:${row.strategy}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
