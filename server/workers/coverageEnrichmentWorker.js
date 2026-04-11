const { refreshCoverageUniverse } = require('../services/dataCoverageService');

async function runCoverageEnrichmentWorker(options = {}) {
  const startedAt = Date.now();
  const result = await refreshCoverageUniverse(options);

  const beforeBySymbol = new Map(result.before.map((entry) => [entry.symbol, entry]));
  const improvedNews = result.after.filter((entry) => {
    const before = beforeBySymbol.get(entry.symbol);
    return Number(before?.metrics?.news_count_30d || 0) === 0 && Number(entry.metrics.news_count_30d || 0) > 0;
  }).length;
  const improvedEarnings = result.after.filter((entry) => {
    const before = beforeBySymbol.get(entry.symbol);
    const beforeTotal = Number(before?.metrics?.earnings_upcoming_count || 0) + Number(before?.metrics?.earnings_history_count || 0);
    const afterTotal = Number(entry.metrics.earnings_upcoming_count || 0) + Number(entry.metrics.earnings_history_count || 0);
    return beforeTotal === 0 && afterTotal > 0;
  }).length;

  return {
    success: true,
    symbols_requested: result.symbols_requested,
    news_coverage_improved: improvedNews,
    earnings_coverage_improved: improvedEarnings,
    duration_ms: Date.now() - startedAt,
    statuses: result.after.reduce((accumulator, entry) => {
      accumulator[entry.status] = (accumulator[entry.status] || 0) + 1;
      return accumulator;
    }, {}),
  };
}

if (require.main === module) {
  runCoverageEnrichmentWorker()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  runCoverageEnrichmentWorker,
};