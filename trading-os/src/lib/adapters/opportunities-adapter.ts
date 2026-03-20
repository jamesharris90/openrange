import type { Opportunity } from "@/lib/types";

import { normalizeDataSource } from "@/lib/data-source";

import { asNumber, asString, pickDataArray } from "./parse";

export type OpportunityContract = {
  symbol: string;
  strategy: string;
  probability: number;
  confidence: number;
  expected_move: number;
  timestamp?: string;
  source?: string;
};

export function adaptOpportunitiesPayload(payload: unknown): Opportunity[] {
  const rows = pickDataArray(payload);

  return rows.flatMap((row) => {
    const symbol = asString(row.symbol).toUpperCase();
    const strategy = asString(row.strategy || row.setup || row.setup_type);
    const probability = asNumber(row.probability);
    const confidence = asNumber(row.confidence);
    const expectedMove = asNumber(row.expected_move ?? row.expectedMove);

    if (!symbol || !strategy || !Number.isFinite(probability) || !Number.isFinite(confidence) || !Number.isFinite(expectedMove)) {
      return [];
    }

    return [
      {
        symbol,
        strategy,
        probability,
        confidence,
        expected_move: expectedMove,
        source: normalizeDataSource(row.source),
      },
    ];
  });
}
