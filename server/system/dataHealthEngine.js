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

const EXACT_COUNT_FALLBACKS = ['daily_ohlcv'];

async function loadExactCountFallbacks(currentEstimates) {
  const fallbackTargets = EXACT_COUNT_FALLBACKS.filter((name) => Number(currentEstimates[name] || 0) === 0);
  if (fallbackTargets.length === 0) {
    return {};
  }

  const counts = {};

  for (const name of fallbackTargets) {
    try {
      const result = await queryWithTimeout(
        `SELECT COUNT(*)::bigint AS row_count FROM ${name}`,
        [],
        { timeoutMs: 5000, label: `system.data_health.exact_count.${name}`, maxRetries: 0 }
      );
      counts[name] = Number(result.rows?.[0]?.row_count || 0);
    } catch (_error) {
      counts[name] = 0;
    }
  }

  return counts;
}

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

    const estimates = Object.fromEntries(
      (result.rows || []).map((row) => [
        String(row.name || ''),
        Number(row.row_estimate || 0),
      ])
    );

    const fallbackCounts = await loadExactCountFallbacks(estimates);
    return { ...estimates, ...fallbackCounts };
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
