const MIN_ALIGNMENT_COUNT = 2;
const TOP_ALIGNED_PICKS = 20;

function confidenceFromAlignmentCount(count) {
  if (count >= 4) return 'high_alignment';
  if (count >= 3) return 'medium_alignment';
  return 'emerging_alignment';
}

function alignLeaderboardSignals(signalResults, options = {}) {
  const minAlignmentCount = Number(options.minAlignmentCount || MIN_ALIGNMENT_COUNT);
  const limit = Number(options.limit || TOP_ALIGNED_PICKS);
  const bySymbol = new Map();

  for (const signalResult of signalResults || []) {
    const category = signalResult.category || 'unknown';
    const results = signalResult.results instanceof Map ? signalResult.results : new Map();

    for (const [symbol, result] of results.entries()) {
      const existing = bySymbol.get(symbol) || {
        symbol,
        direction: 'neutral',
        signals: [],
        signalCategories: new Set(),
        totalSignalScore: 0,
        bestSignalRank: Number.POSITIVE_INFINITY,
      };

      existing.signals.push({
        ...result,
        category,
        signalCategory: category,
        evidence: result.metadata || {},
      });
      existing.signalCategories.add(category);
      existing.totalSignalScore += Number(result.score || 0);
      existing.bestSignalRank = Math.min(existing.bestSignalRank, Number(result.rank || Number.POSITIVE_INFINITY));
      bySymbol.set(symbol, existing);
    }
  }

  return [...bySymbol.values()]
    .map((candidate) => {
      const alignmentCount = candidate.signals.length;
      const categories = [...candidate.signalCategories];
      return {
        symbol: candidate.symbol,
        direction: 'neutral',
        qualified: alignmentCount >= minAlignmentCount,
        confidenceQualification: confidenceFromAlignmentCount(alignmentCount),
        disqualifiedReasons: alignmentCount >= minAlignmentCount ? [] : ['alignment_count_below_threshold'],
        alignment: {
          mode: 'simple_count',
          alignmentCount,
          minAlignmentCount,
          categories,
          signalCount: alignmentCount,
          totalSignalScore: Number(candidate.totalSignalScore.toFixed(4)),
          bestSignalRank: Number.isFinite(candidate.bestSignalRank) ? candidate.bestSignalRank : null,
        },
        signals: candidate.signals.sort((a, b) => Number(a.rank || 9999) - Number(b.rank || 9999)),
      };
    })
    .filter((candidate) => candidate.qualified)
    .sort((a, b) => {
      const countDelta = b.alignment.alignmentCount - a.alignment.alignmentCount;
      if (countDelta !== 0) return countDelta;
      const scoreDelta = b.alignment.totalSignalScore - a.alignment.totalSignalScore;
      if (scoreDelta !== 0) return scoreDelta;
      return String(a.symbol).localeCompare(String(b.symbol));
    })
    .slice(0, limit);
}

module.exports = {
  MIN_ALIGNMENT_COUNT,
  TOP_ALIGNED_PICKS,
  alignLeaderboardSignals,
  confidenceFromAlignmentCount,
};
