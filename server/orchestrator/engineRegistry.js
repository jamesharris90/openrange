const engines = {
  radarEngine: {
    key: 'radarEngine',
    name: 'Radar Engine',
    interval: 60,
    tableName: 'strategy_signals',
    timestampColumn: 'updated_at',
    validationWindowMinutes: 5,
    lastRun: null,
    status: 'unknown',
    error: null,
  },

  signalEngine: {
    key: 'signalEngine',
    name: 'Signal Engine',
    interval: 30,
    tableName: 'signal_capture_analysis',
    timestampColumn: 'created_at',
    validationWindowMinutes: 5,
    lastRun: null,
    status: 'unknown',
    error: null,
  },

  opportunityEngine: {
    key: 'opportunityEngine',
    name: 'Opportunity Engine',
    interval: 45,
    tableName: 'opportunities_v2',
    timestampColumn: 'updated_at',
    validationWindowMinutes: 5,
    lastRun: null,
    status: 'unknown',
    error: null,
  },

  catalystEngine: {
    key: 'catalystEngine',
    name: 'Catalyst Engine',
    interval: 300,
    tableName: 'news_catalysts',
    timestampColumn: 'created_at',
    validationWindowMinutes: 10,
    lastRun: null,
    status: 'unknown',
    error: null,
  },

  chartEngine: {
    key: 'chartEngine',
    name: 'Chart Engine',
    interval: 120,
    tableName: 'expected_move_tracking',
    timestampColumn: 'created_at',
    validationWindowMinutes: 10,
    lastRun: null,
    status: 'unknown',
    error: null,
  },

  breadthEngine: {
    key: 'breadthEngine',
    name: 'Market Breadth Engine',
    interval: 60,
    tableName: 'market_context_snapshot',
    timestampColumn: 'created_at',
    validationWindowMinutes: 5,
    lastRun: null,
    status: 'unknown',
    error: null,
  },
};

module.exports = engines;
