// @ts-nocheck
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getStocksByBuckets } = require(path.join(__dirname, '..', 'services', 'directoryServiceV1.ts'));
const { enrichDailyMetrics } = require(path.join(__dirname, '..', 'services', 'dailyEnrichmentService.ts'));

const {
  isDailyMetricsFresh,
  persistDailyMetrics,
  getDailyMetricsMeta,
} = require(path.join(__dirname, '..', 'services', 'dailyMetricsCache.ts'));

async function main() {
  const force = process.argv.includes('--force');

  if (!force && isDailyMetricsFresh()) {
    const meta = getDailyMetricsMeta();
    console.log(JSON.stringify({
      refreshed: false,
      reason: 'cache_fresh',
      refreshedAt: meta.refreshedAt,
      count: meta.count,
    }, null, 2));
    return;
  }

  const bucketRows = await getStocksByBuckets(['common', 'etf', 'adr', 'preferred', 'other']);
  const symbols = Array.from(new Set(
    bucketRows
      .map((row) => String(row?.symbol || '').trim().toUpperCase())
      .filter(Boolean)
  ));

  const metricsRows = await enrichDailyMetrics(symbols);
  const persisted = persistDailyMetrics(metricsRows);

  console.log(JSON.stringify({
    refreshed: true,
    symbolCount: symbols.length,
    metricsCount: metricsRows.length,
    refreshedAt: persisted.refreshedAt,
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
