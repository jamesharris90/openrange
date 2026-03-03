function buildAnalystMap(universe, logger = console) {
  const out = new Map();
  universe.forEach((row) => {
    out.set(row.symbol, {
      recentUpgradeDowngrade: null,
      ratingDirection: null,
      netRatingChange: null,
      priceTargetChangePercent: null,
      consensusRating: null,
      ratingTrend: null,
    });
  });
  logger.info('Analyst engine complete', { symbols: out.size });
  return out;
}

module.exports = {
  buildAnalystMap,
};
