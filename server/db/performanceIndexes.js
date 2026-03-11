const { queryWithTimeout } = require('./pg');
const logger = require('../logger');

const INDEX_SQL = [
  `CREATE INDEX IF NOT EXISTS idx_intraday_symbol_time
   ON intraday_1m(symbol, timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_market_quotes_symbol
   ON market_quotes(symbol)`,
  `CREATE INDEX IF NOT EXISTS idx_news_articles_symbol
   ON news_articles(symbol)`,
  `CREATE INDEX IF NOT EXISTS idx_opportunity_stream_score
   ON opportunity_stream(score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_system_events_created_at
   ON system_events(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_system_events_type_created
   ON system_events(event_type, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_data_integrity_events_created_at
   ON data_integrity_events(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_data_integrity_events_symbol_created
   ON data_integrity_events(symbol, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_system_alerts_created_at
   ON system_alerts(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_system_alerts_ack_created
   ON system_alerts(acknowledged, created_at DESC)`,
];

async function ensurePerformanceIndexes() {
  const results = [];
  for (const sql of INDEX_SQL) {
    try {
      await queryWithTimeout(sql, [], {
        timeoutMs: 12000,
        label: 'db.performance_indexes.apply',
        maxRetries: 0,
      });
      results.push({ sql, ok: true });
    } catch (error) {
      results.push({ sql, ok: false, error: error.message });
      logger.warn('[DB_INDEX] apply failed', { sql, error: error.message });
    }
  }
  return {
    ok: results.every((r) => r.ok),
    results,
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  ensurePerformanceIndexes,
};
