import { EnrichedTicker, PriorityEntry } from '../models/types';

/**
 * Score a ticker for ranking purposes.
 *
 * Components:
 * - Catalyst strength (0–3): major types score higher
 * - Relative volume (0–2): capped at 2
 * - Gap magnitude (0–2): capped at 2
 * - Classification bonus: A=3, B=2, C=1
 * - Conviction bonus: HIGH=2, MEDIUM=1, LOW=0
 */
function scoreTicker(t: EnrichedTicker): number {
  const catalystType = t.catalyst?.type ?? 'none';
  const majorCatalysts = ['earnings', 'fda', 'product', 'merger', 'contract'];
  const catalystScore = majorCatalysts.includes(catalystType) ? 3 : t.catalyst ? 1.5 : 0;

  const relVolScore = Math.min(2, (t.relVolume ?? 0) / 2);
  const gapScore = Math.min(2, Math.abs(t.pmChangePct ?? 0) / 5);

  const classScore = t.classification === 'A' ? 3 : t.classification === 'B' ? 2 : 1;
  const convictionScore = t.conviction === 'HIGH' ? 2 : t.conviction === 'MEDIUM' ? 1 : 0;

  return catalystScore + relVolScore + gapScore + classScore + convictionScore;
}

export function rankTiers(
  tickers: EnrichedTicker[],
): {
  tier1: PriorityEntry[];
  tier2: PriorityEntry[];
  tier3: PriorityEntry[];
} {
  const sorted = [...tickers].sort((a, b) => scoreTicker(b) - scoreTicker(a));

  const tier1: PriorityEntry[] = [];
  const tier2: PriorityEntry[] = [];
  const tier3: PriorityEntry[] = [];

  let rank = 0;
  for (const t of sorted) {
    rank++;

    // Class C tickers never go to Tier 1
    if (t.classification === 'C') {
      tier3.push({
        ticker: t.ticker,
        classification: t.classification,
        primaryStrategy: t.primaryStrategy,
        conviction: t.conviction,
        reason: 'Class C — observe only; no clean strategy mapping for active trading',
      });
      continue;
    }

    const entry: PriorityEntry = {
      rank,
      ticker: t.ticker,
      classification: t.classification,
      primaryStrategy: t.primaryStrategy,
      conviction: t.conviction,
      keyLevel: t.levels.pmHigh ?? t.levels.prevHigh,
    };

    if (tier1.length < 4) {
      tier1.push(entry);
    } else {
      const whySecondary =
        tier1.length >= 4
          ? 'Tier 1 full — displaced by higher-scoring names'
          : t.conviction === 'LOW'
            ? 'Low conviction'
            : 'Lower catalyst strength or liquidity';
      tier2.push({ ...entry, whySecondary });
    }
  }

  return { tier1, tier2, tier3 };
}
