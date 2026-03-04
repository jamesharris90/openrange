const { getMetricsHealth } = require('./metricsHealth');
const { getIngestionHealth } = require('./ingestionHealth');

async function getSystemHealth() {
  const [metrics, ingestion] = await Promise.all([
    getMetricsHealth(),
    getIngestionHealth(),
  ]);

  return {
    system: 'openrange',
    status: 'ok',
    metrics,
    ingestion,
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  getSystemHealth,
};
