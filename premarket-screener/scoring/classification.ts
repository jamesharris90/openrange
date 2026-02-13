import { EnrichedTicker } from '../models/types';

const MAJOR_CATALYST_TYPES = [
  'earnings', 'fda', 'product', 'merger', 'contract', 'upgrade',
];

const VALID_CATALYST_TYPES = [
  ...MAJOR_CATALYST_TYPES, 'guidance', 'sector',
];

export function classify(ticker: EnrichedTicker): EnrichedTicker {
  const relVol = ticker.relVolume ?? 0;
  const gap = ticker.pmChangePct ?? 0;
  const absGap = Math.abs(gap);
  const catalystType = ticker.catalyst?.type ?? 'none';
  const isMajorCatalyst = MAJOR_CATALYST_TYPES.includes(catalystType);
  const isValidCatalyst = VALID_CATALYST_TYPES.includes(catalystType);

  // PM structure: is price holding near PM highs?
  const holdingHighs =
    ticker.levels.pmHigh !== undefined && ticker.pmPrice !== undefined
      ? ticker.pmPrice >= 0.97 * ticker.levels.pmHigh
      : false;

  // Negative gap with offering/dilution catalyst → lean toward C (reversal watch)
  const isSelloff = gap < -3 && ['offering', 'guidance'].includes(catalystType);

  let classification: 'A' | 'B' | 'C';
  let reason: string;

  if (
    isMajorCatalyst &&
    relVol >= 1.5 &&
    gap >= 5 &&
    holdingHighs
  ) {
    // Class A: Momentum Continuation
    classification = 'A';
    reason = 'Major catalyst, strong gap, high relative volume, holding PM highs';
  } else if (
    isValidCatalyst &&
    relVol >= 1.0 &&
    absGap >= 3 &&
    !isSelloff
  ) {
    // Class B: Fresh News / Day-1 Volatility
    classification = 'B';
    reason = 'Fresh catalyst with adequate volume and gap';
  } else if (isSelloff || (catalystType === 'offering')) {
    // Class C: Reversal watchlist — heavy selling / dilution
    classification = 'C';
    reason = 'Selloff / dilution catalyst — reversal watch only';
  } else if (isValidCatalyst && absGap >= 3) {
    // Borderline — has catalyst + gap but relVol weak → downgrade to C
    classification = 'C';
    reason = 'Catalyst present but relative volume insufficient; observe only';
  } else {
    classification = 'C';
    reason = 'Insufficient clarity — lacking strong structure or catalyst strength';
  }

  const permittedStrategies = mapStrategies(classification);
  const primaryStrategy = permittedStrategies[0];
  const secondaryStrategy = permittedStrategies.length > 1 ? permittedStrategies[1] : permittedStrategies[0];

  const conviction: EnrichedTicker['conviction'] =
    classification === 'A' ? 'HIGH'
    : classification === 'B' ? 'MEDIUM'
    : 'LOW';

  const primaryRisk =
    classification === 'C'
      ? 'Knife risk / failed reclaim'
      : gap < 0
        ? 'Continuation lower / failed bounce'
        : 'Gap fill / loss of PM structure';

  const invalidation = ticker.levels.pmLow
    ? `Loss of ${ticker.levels.pmLow.toFixed(2)} (PM low)`
    : ticker.levels.prevClose
      ? `Loss of ${ticker.levels.prevClose.toFixed(2)} (prev close)`
      : 'Loss of PM low / key support';

  return {
    ...ticker,
    classification,
    classificationReason: reason,
    permittedStrategies,
    primaryStrategy,
    secondaryStrategy,
    conditionalNote:
      classification === 'C'
        ? 'OBSERVE ONLY — trade only after confirmed reclaim with volume'
        : 'Standard risk controls apply',
    primaryRisk,
    invalidation,
    conviction,
  };
}

function mapStrategies(classification: 'A' | 'B' | 'C'): string[] {
  switch (classification) {
    case 'A':
      return ['Strategy 1 (ORB)', 'Strategy 4 (Momentum Extension)'];
    case 'B':
      return [
        'Strategy 1 (ORB)',
        'Strategy 2 (Support Bounce)',
        'Strategy 3 (VWAP Reclaim)',
      ];
    case 'C':
      return [
        'Strategy 3 (VWAP Reclaim)',
        'Strategy 5 (Post-Flush Reclaim)',
      ];
  }
}
