type VolatilityWeightingInput = {
  atrUsagePercent?: number | null;
  emUsagePercent?: number | null;
  impliedMove1dPct?: number | null;
  hv20?: number | null;
};

export type VolatilityWeightingResult = {
  exhaustionRisk: number;
  expansionPotential: number;
  volatilityState: string;
};

function toFinite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateVolatilityWeighting(input: VolatilityWeightingInput): VolatilityWeightingResult {
  const atrUsage = toFinite(input.atrUsagePercent) ?? 0;
  const emUsage = toFinite(input.emUsagePercent) ?? 0;
  const impliedMovePct = toFinite(input.impliedMove1dPct) ?? 0;
  const hv20 = toFinite(input.hv20) ?? 0;

  const ivPremium = hv20 > 0 ? ((impliedMovePct - hv20) / hv20) * 100 : 0;

  const exhaustionRisk = clamp((atrUsage * 0.55) + (emUsage * 0.35) + Math.max(ivPremium, 0) * 0.2);
  const expansionPotential = clamp((100 - atrUsage) * 0.5 + (100 - emUsage) * 0.4 + Math.max(-ivPremium, 0) * 0.2);

  let volatilityState = 'Neutral';
  if (exhaustionRisk >= 70) volatilityState = 'Volatility Exhaustion Risk';
  else if (expansionPotential >= 65) volatilityState = 'Volatility Expansion';

  return {
    exhaustionRisk: Number(exhaustionRisk.toFixed(2)),
    expansionPotential: Number(expansionPotential.toFixed(2)),
    volatilityState,
  };
}
