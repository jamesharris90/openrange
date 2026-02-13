import { EnrichedTicker, TickerInput, ThresholdConfig } from '../models/types';

const NO_CATALYST_PHRASES = [
  'no clear catalyst',
  'no identifiable catalyst',
  'no catalyst',
  'drifting',
];

export function hardGate(
  input: TickerInput,
  catalyst: EnrichedTicker['catalyst'],
  thresholds: ThresholdConfig,
): { pass: boolean; reason?: string } {
  // 1. Catalyst gate
  if (!catalyst || catalyst.type === 'none') {
    return { pass: false, reason: 'No identifiable catalyst' };
  }
  const detailLower = catalyst.detail.toLowerCase();
  if (NO_CATALYST_PHRASES.some((p) => detailLower.includes(p))) {
    return { pass: false, reason: 'No identifiable catalyst' };
  }

  // 2. Price gate
  const price = input.pmPrice ?? input.last;
  if (price === undefined) {
    return { pass: false, reason: 'Missing price data' };
  }
  if (price < thresholds.minPrice || price > thresholds.maxPrice) {
    return { pass: false, reason: `Price $${price.toFixed(2)} outside bounds ($${thresholds.minPrice}–$${thresholds.maxPrice})` };
  }

  // 3. Average volume gate
  if (!input.avgVolume || input.avgVolume < thresholds.minAvgVolume) {
    return { pass: false, reason: `Average volume ${input.avgVolume ?? 0} below minimum ${thresholds.minAvgVolume}` };
  }

  // 4. Pre-market volume gate
  if (!input.pmVolume || input.pmVolume < thresholds.minPmVolume) {
    return { pass: false, reason: `PM volume ${input.pmVolume ?? 0} below minimum ${thresholds.minPmVolume}` };
  }

  // 5. Gap % gate (absolute value)
  if (input.pmChangePct !== undefined && Math.abs(input.pmChangePct) < thresholds.minGapPct) {
    return { pass: false, reason: `Gap ${input.pmChangePct.toFixed(1)}% below minimum ±${thresholds.minGapPct}%` };
  }

  // 6. Optional float cap
  if (thresholds.maxFloat && input.float && input.float > thresholds.maxFloat) {
    return { pass: false, reason: `Float ${(input.float / 1e6).toFixed(0)}M exceeds max ${(thresholds.maxFloat / 1e6).toFixed(0)}M` };
  }

  return { pass: true };
}
