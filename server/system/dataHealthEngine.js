const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');

const TABLES = [
  'intraday_1m',
  'daily_ohlc',
  'daily_ohlcv',
  'ticker_universe',
  'market_quotes',
  'news_articles',
  'earnings_events',
  'catalyst_signals',
  'trade_setups',
  'trade_catalysts',
  'opportunity_stream',
  'trade_outcomes',
];

async function loadTableRowEstimates() {
  try {
    const result = await queryWithTimeout(
      `SELECT src.name,
              CASE
                WHEN cls.oid IS NULL THEN 0
                ELSE GREATEST(0, ROUND(COALESCE(stats.n_live_tup, cls.reltuples, 0)))::bigint
              END AS row_estimate
       FROM unnest($1::text[]) AS src(name)
       LEFT JOIN pg_class AS cls
         ON cls.relname = src.name
        AND cls.relkind = 'r'
       LEFT JOIN pg_namespace AS ns
         ON ns.oid = cls.relnamespace
        AND ns.nspname = 'public'
       LEFT JOIN pg_stat_user_tables AS stats
         ON stats.relid = cls.oid`,
      [TABLES],
      { timeoutMs: 3000, label: 'system.data_health.row_estimates', maxRetries: 0 }
    );

    return Object.fromEntries(
      (result.rows || []).map((row) => [
        String(row.name || ''),
        Number(row.row_estimate || 0),
      ])
    );
  } catch (_error) {
    logger.error('[ENGINE ERROR] data_health table estimates failed');
    return Object.fromEntries(TABLES.map((name) => [name, 0]));
  }
}

async function getDataHealth() {
  try {
    const tables = await loadTableRowEstimates();
    const hasZero = Object.values(tables).some((value) => Number(value || 0) === 0);

    return {
      status: hasZero ? 'warning' : 'ok',
      tables,
    };
  } catch (error) {
    logger.error('[ENGINE ERROR] data_health run failed', { error: error.message });
    return {
      status: 'warning',
      tables: Object.fromEntries(TABLES.map((name) => [name, 0])),
    };
  }
}

module.exports = {
  TABLES,
  getDataHealth,
};
