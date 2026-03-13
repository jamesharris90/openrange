const { getEventBusMetrics } = require('./eventBus');

function platformHealth(req, res) {
  const busMetrics = getEventBusMetrics();
  res.json({
    ok: true,
    data: {
      scheduler: global.schedulerStatus || 'unknown',
      pipeline: global.pipelineStatus || 'unknown',
      providers: global.providerStatus || {},
      eventBus: {
        events: busMetrics.events,
        events_per_minute: busMetrics.eventsPerMinute,
      },
      traces: {
        active: global.activeTraces || 0,
      },
      uiErrors: global.uiErrorCount || 0,
      email: global.emailStatus || 'unknown',
      cache: global.cacheStatus || 'unknown',
      engines: global.engineStatus || {},
      last_ingestion_time: global.lastIngestionTime || null,
    },
    error: null,
  });
}

module.exports = {
  platformHealth,
};
