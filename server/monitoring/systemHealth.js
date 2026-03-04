const { getMetricsHealth } = require('./metricsHealth');
const { getIngestionHealth } = require('./ingestionHealth');
const { getUniverseHealth } = require('./universeHealth');

async function getSystemHealth() {
  const [metrics, ingestion, universe] = await Promise.all([
    getMetricsHealth(),
    getIngestionHealth(),
    getUniverseHealth(),
  ]);

  return {
    system: 'openrange',
    status: 'ok',
    metrics,
    ingestion,
    universe,
    universe_count: universe.total_symbols,
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  getSystemHealth,
};
