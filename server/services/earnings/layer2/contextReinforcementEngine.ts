function isSpyBiasAligned(spyBias: unknown): boolean {
  const normalized = String(spyBias || '').trim().toLowerCase();
  return normalized === 'bullish' || normalized === 'aligned' || normalized === 'supportive';
}

function isAnalystUpgradeDetected(spyBias: unknown): boolean {
  const normalized = String(spyBias || '').trim().toLowerCase();
  return normalized.includes('analyst_upgrade') || normalized.includes('analyst-upgrade') || normalized.includes('upgrade');
}

export function calculateContextReinforcement(
  _symbol: string,
  newsScore: number | null,
  sectorStrength: number | null,
  spyBias: unknown,
) {
  const hasStrongNews = Number.isFinite(Number(newsScore)) && Number(newsScore) >= 25;
  const strongSector = Number.isFinite(Number(sectorStrength)) && Number(sectorStrength) > 1;
  const spyAligned = isSpyBiasAligned(spyBias);
  const analystUpgradeDetected = isAnalystUpgradeDetected(spyBias);

  const contextScore =
    (hasStrongNews ? 5 : 0) +
    (strongSector ? 5 : 0) +
    (spyAligned ? 5 : 0) +
    (analystUpgradeDetected ? 5 : 0);

  return {
    contextScore,
    breakdown: {
      newsScoreAtLeast25: hasStrongNews ? 5 : 0,
      sectorStrengthAbove1Pct: strongSector ? 5 : 0,
      spyBiasAligned: spyAligned ? 5 : 0,
      analystUpgradeDetected: analystUpgradeDetected ? 5 : 0,
    },
  };
}
