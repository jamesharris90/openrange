const { getMetricsHealth } = require('./metricsHealth');
const { getIngestionHealth } = require('./ingestionHealth');
const { getUniverseHealth } = require('./universeHealth');
const { getQueueHealth } = require('./queueHealth');

async function getSystemHealth() {
  const [metrics, ingestion, universe, queue] = await Promise.all([
    getMetricsHealth(),
    getIngestionHealth(),
    getUniverseHealth(),
    getQueueHealth(),
  ]);

  return {
    system: 'openrange',
    status: 'ok',
    metrics,
    ingestion,
    universe,
    queue,
    universe_count: universe.total_symbols,
    queue_size: queue.queue_size,
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  getSystemHealth,
};
