function buildCatalysts(universe, newsMap, earningsMap, logger = console) {
  const out = new Map();
  const now = Date.now();

  universe.forEach((row) => {
    const n = newsMap.get(row.symbol) || {};
    const e = earningsMap.get(row.symbol) || {};

    const hasRecentCatalyst = Boolean(n.hasRecentNews || e.earningsWindow === 'today' || e.earningsWindow === 'thisWeek');
    let catalystType = null;
    if (n.hasRecentNews) catalystType = 'news';
    else if (e.earningsWindow) catalystType = 'earnings';

    const catalystAge = n.newsRecencyMinutes != null ? n.newsRecencyMinutes : null;

    out.set(row.symbol, {
      hasRecentCatalyst,
      catalystAge,
      catalystType,
      freshCatalystGap: Boolean(hasRecentCatalyst && row.gapPercent != null && Math.abs(row.gapPercent) >= 2),
      catalystUpdatedAt: now,
    });
  });

  logger.info('Catalyst engine complete', { symbols: out.size });
  return out;
}

module.exports = {
  buildCatalysts,
};
