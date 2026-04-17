const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');

let lastHealthySnapshot = null;

const TABLES = [
  'intraday_1m',
  'daily_ohlc',
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

const EXACT_COUNT_FALLBACKS = [];

async function loadExactCounts(tableNames, timeoutMs = 5000) {
  const counts = {};

  for (const name of tableNames) {
    try {
      const result = await queryWithTimeout(
        `SELECT COUNT(*)::bigint AS row_count FROM ${name}`,
        [],
        { timeoutMs, label: `system.data_health.exact_count.${name}`, maxRetries: 0 }
      );
      counts[name] = Number(result.rows?.[0]?.row_count || 0);
    } catch (_error) {
      counts[name] = 0;
    }
  }

  return counts;
}

async function loadExactCountFallbacks(currentEstimates) {
  const fallbackTargets = EXACT_COUNT_FALLBACKS.filter((name) => Number(currentEstimates[name] || 0) === 0);
  if (fallbackTargets.length === 0) {
    return {};
  }

  return loadExactCounts(fallbackTargets, 15000);
}

async function loadTableRowEstimates() {
  const result = await queryWithTimeout(
    `SELECT src.name,
            CASE
              WHEN ns.oid IS NULL THEN 0
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
    TABLES.map((name) => [name, 0])
  );

  for (const row of result.rows || []) {
    estimates[String(row.name || '')] = Number(row.row_estimate || 0);
  }

  const fallbackCounts = await loadExactCountFallbacks(estimates);
  return { ...estimates, ...fallbackCounts };
}

async function getDataHealth() {
  try {
    const tables = await loadTableRowEstimates();
    tables.daily_ohlcv = Number(tables.daily_ohlc || 0);
    const hasZero = Object.values(tables).some((value) => Number(value || 0) === 0);

    const payload = {
      status: hasZero ? 'warning' : 'ok',
      tables,
    };

    if (!hasZero) {
      lastHealthySnapshot = payload;
    }

    return payload;
  } catch (error) {
    logger.error('[ENGINE ERROR] data_health run failed', { error: error.message });

    if (lastHealthySnapshot) {
      return {
        ...lastHealthySnapshot,
        status: 'warning',
        error: error.message,
        stale: true,
      };
    }

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
