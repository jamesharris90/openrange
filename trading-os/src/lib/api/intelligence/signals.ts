import type { AlertRow, Opportunity } from "@/lib/types";

import { apiGet } from "@/lib/api/client";

type SignalItem = {
  symbol?: string;
  setup_type?: string;
  strategy?: string;
  strategy_score?: number;
  score?: number;
  timestamp?: string;
};

function toOpportunity(item: SignalItem): Opportunity {
  const score = Number(item.strategy_score ?? item.score ?? 0);
  const probability = Math.max(1, Math.min(99, score || 50));
  const confidence = Math.max(1, Math.min(99, probability * 0.9 + 5));

  return {
    symbol: String(item.symbol || "N/A").toUpperCase(),
    strategy: String(item.setup_type || item.strategy || "Signal"),
    probability,
    confidence,
    expected_move: Number((score / 12).toFixed(2)),
  };
}

export async function getSignalRows(limit = 100): Promise<Opportunity[]> {
  const response = await apiGet<{ success?: boolean; data?: SignalItem[] }>(`/api/intelligence/signals?limit=${limit}`);
  if (response.success !== true) {
    throw new Error("Intelligence signals request failed");
  }

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid signals response contract");
  }

  return response.data.map(toOpportunity);
}

export async function getAlerts(): Promise<AlertRow[]> {
  const response = await apiGet<{ success?: boolean; data?: SignalItem[] }>("/api/intelligence/signals?limit=100");
  if (response.success !== true) {
    throw new Error("Intelligence signals request failed");
  }

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid signals response contract");
  }

  return response.data.map((item, index) => {
    const opportunity = toOpportunity(item);
    return {
      id: `${opportunity.symbol}-${index}`,
      timestamp: String(item.timestamp || new Date().toISOString()),
      symbol: opportunity.symbol,
      signal: opportunity.strategy,
      probability: opportunity.probability,
      confidence: opportunity.confidence,
      sparkline: [],
    };
  });
}
