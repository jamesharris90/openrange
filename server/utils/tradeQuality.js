function tradeQualityScore(row) {
  const safeRow = row && typeof row === 'object' ? row : {};
  let score = 0;

  // completeness is stored as 0-100 in this codebase; normalize to 0-1 for weighted scoring.
  const completenessRaw = Number(safeRow.completeness ?? 0);
  const completeness = Number.isFinite(completenessRaw)
    ? Math.max(0, Math.min(1, completenessRaw / 100))
    : 0;
  score += completeness * 40;

  const whyMoving = String(safeRow.why_moving || '').trim();
  if (whyMoving.length > 0) {
    score += 20;
  }

  const strategy = String(safeRow.strategy || '').trim();
  if (strategy.length > 0) {
    score += 20;
  }

  if (safeRow.confidence != null) {
    const confidenceRaw = Number(safeRow.confidence);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0;
    score += confidence * 20;
  }

  return Math.round(Math.max(0, Math.min(100, score)));
}

module.exports = {
  tradeQualityScore,
};
