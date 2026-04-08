import type { AlertRow, Opportunity } from "@/lib/types";

import { apiGet } from "@/lib/api/client";

type SignalItem = {
  symbol?: string;
  setup_type?: string;
  strategy?: string;
  strategy_score?: number;
  score?: number;
  confidence?: number;
  final_score?: number;
  timestamp?: string;
  expected_move_percent?: number;
  why_moving?: string;
};

type OpportunityEnvelope = {
  success?: boolean;
  data?: SignalItem[];
};

function toOpportunity(item: SignalItem): Opportunity {
  const symbol = String(item.symbol || "").toUpperCase();
  const strategy = String(item.setup_type || item.strategy || "").trim();
  const score = Number(item.strategy_score ?? item.score ?? item.confidence ?? item.final_score);

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
  const signalRows = response.success === true && Array.isArray(response.data) ? response.data : [];

  const rows = signalRows.length > 0
    ? signalRows
    : (await apiGet<OpportunityEnvelope>("/api/intelligence/top-opportunities?limit=40")).data || [];

  return rows.map((item, index) => {
    const opportunity = toOpportunity(item);
    const seed = Number(opportunity.confidence || 50);
    const move = Number((item as { expected_move_percent?: unknown }).expected_move_percent || 1.5);
    const sparkline = [
      seed - move * 1.2,
      seed - move * 0.4,
      seed + move * 0.8,
      seed + move * 0.2,
      seed + move * 1.4,
      seed + move,
    ].map((value) => Math.max(1, Math.min(99, value)));

    return {
      id: `${opportunity.symbol}-${index}`,
      timestamp: String(item.timestamp || new Date().toISOString()),
      symbol: opportunity.symbol,
      signal: opportunity.strategy,
      probability: opportunity.probability,
      confidence: opportunity.confidence,
      sparkline,
    };
  });
}
