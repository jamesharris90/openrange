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
  const symbol = String(item.symbol || "").toUpperCase();
  const strategy = String(item.setup_type || item.strategy || "").trim();
  const score = Number(item.strategy_score ?? item.score);

  if (!symbol || !strategy || !Number.isFinite(score)) {
    throw new Error("Invalid signals response contract");
  }

  const probability = Math.max(1, Math.min(99, score));
  const confidence = Math.max(1, Math.min(99, probability * 0.9 + 5));

  return {
    symbol,
    strategy,
    probability,
    confidence,
    expected_move: Math.round((score / 12) * 100) / 100,
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
