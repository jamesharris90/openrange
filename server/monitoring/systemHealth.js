const { getMetricsHealth } = require('./metricsHealth');
const { getIngestionHealth } = require('./ingestionHealth');
const { getUniverseHealth } = require('./universeHealth');
const { getQueueHealth } = require('./queueHealth');
const { getSetupHealth } = require('./setupHealth');
const { getCatalystHealth } = require('./catalystHealth');

async function getSystemHealth() {
  const [metrics, ingestion, universe, queue, setups, catalysts] = await Promise.all([
    getMetricsHealth(),
    getIngestionHealth(),
    getUniverseHealth(),
    getQueueHealth(),
    getSetupHealth(),
    getCatalystHealth(),
  ]);

  return {
    system: 'openrange',
    status: 'ok',
    metrics,
    ingestion,
    universe,
    queue,
    setups,
    catalysts,
    universe_count: universe.total_symbols,
    queue_size: queue.queue_size,
    setup_count: setups.setup_count,
    catalyst_count: catalysts.catalyst_count,
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  getSystemHealth,
};
