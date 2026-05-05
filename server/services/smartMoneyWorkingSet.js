const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');

const DEFAULT_SYMBOLS = Object.freeze(['AAPL', 'MSFT', 'NVDA', 'SPY', 'QQQ']);
const MAX_WORKING_SET_SYMBOLS = 1000;
const WORKING_SET_LOOKBACK_DAYS = 5;
const WORKING_SET_RECENT_RUN_LIMIT = 5;

function normalizeSymbols(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean)
  ));
}

function buildSymbolList(dynamicSymbols, fallbackSymbols = DEFAULT_SYMBOLS, cap = MAX_WORKING_SET_SYMBOLS) {
  const limit = Math.max(1, Number(cap) || MAX_WORKING_SET_SYMBOLS);
  const fallback = normalizeSymbols(fallbackSymbols).slice(0, limit);
  if (fallback.length >= limit) {
    return fallback;
  }
  const symbols = [...fallback];
  const seen = new Set(symbols);

  for (const symbol of normalizeSymbols(dynamicSymbols)) {
    if (seen.has(symbol)) continue;
    symbols.push(symbol);
    seen.add(symbol);
    if (symbols.length >= limit) break;
  }

  return symbols;
}

async function resolveSmartMoneyWorkingSet(options = {}) {
  const maxSymbols = Math.max(1, Number(options.maxSymbols) || MAX_WORKING_SET_SYMBOLS);
  const recentRunLimit = Math.max(1, Number(options.recentRunLimit) || WORKING_SET_RECENT_RUN_LIMIT);
  const lookbackDays = Math.max(1, Number(options.lookbackDays) || WORKING_SET_LOOKBACK_DAYS);
  const fallbackSymbols = normalizeSymbols(options.fallbackSymbols || DEFAULT_SYMBOLS);

  try {
    const { rows } = await queryWithTimeout(
      `
        WITH recent_runs AS (
          SELECT run_id
          FROM beacon_v0_runs
          WHERE status = 'completed'
          ORDER BY started_at DESC NULLS LAST
          LIMIT $1
        ),
        candidate_symbols AS (
          SELECT symbol, MAX(created_at) AS last_seen_at
          FROM beacon_v0_picks
          WHERE created_at >= NOW() - ($2::int * INTERVAL '1 day')
          GROUP BY symbol

          UNION ALL

          SELECT bp.symbol, MAX(bp.created_at) AS last_seen_at
          FROM beacon_v0_picks bp
          JOIN recent_runs rr ON rr.run_id = bp.run_id
          GROUP BY bp.symbol
        )
        SELECT symbol
        FROM candidate_symbols
        WHERE symbol IS NOT NULL
          AND BTRIM(symbol) <> ''
        GROUP BY symbol
        ORDER BY MAX(last_seen_at) DESC, symbol ASC
        LIMIT $3
      `,
      [recentRunLimit, lookbackDays, maxSymbols],
      {
        label: 'smart_money.resolve_working_set',
        timeoutMs: 15000,
        maxRetries: 0,
        poolType: 'read',
      }
    );

    const dynamicSymbols = normalizeSymbols(rows.map((row) => row.symbol));
    const symbols = buildSymbolList(dynamicSymbols, fallbackSymbols, maxSymbols);
    logger.info('smart money working set resolved', {
      source: dynamicSymbols.length > 0 ? 'beacon_active_working_set' : 'fallback',
      dynamicCount: dynamicSymbols.length,
      fallbackCount: fallbackSymbols.length,
      totalSymbols: symbols.length,
      lookbackDays,
      recentRunLimit,
      maxSymbols,
    });
    return symbols;
  } catch (error) {
    const symbols = buildSymbolList([], fallbackSymbols, maxSymbols);
    logger.warn('smart money working set fallback engaged', {
      error: error.message,
      totalSymbols: symbols.length,
      lookbackDays,
      recentRunLimit,
      maxSymbols,
    });
    return symbols;
  }
}

module.exports = {
  DEFAULT_SYMBOLS,
  MAX_WORKING_SET_SYMBOLS,
  resolveSmartMoneyWorkingSet,
};