'use strict';

const { queryWithTimeout } = require('../../../db/pg');

const REACTION_THRESHOLD_PCT = 2.0;
const LOOKBACK_HOURS = 18;
const MAX_EXPANSION_SYMBOLS = 50;

/**
 * Find symbols that reported earnings in the last 18 hours AND
 * have at least 2% price reaction (absolute) from prior close to
 * the most recent available price.
 *
 * Used as pre-market window universe expansion source.
 */
async function getPremarketEarningsExpansion(options = {}) {
  const limit = Math.min(Number(options.limit || MAX_EXPANSION_SYMBOLS) || MAX_EXPANSION_SYMBOLS, MAX_EXPANSION_SYMBOLS);

  const { rows } = await queryWithTimeout(
    `WITH recent_earnings AS (
       SELECT DISTINCT ON (UPPER(eh.symbol))
         UPPER(eh.symbol) AS symbol,
         eh.report_date,
         eh.eps_actual,
         eh.eps_estimate,
         COALESCE(eh.updated_at, eh.created_at) AS earnings_recorded_at
       FROM earnings_history eh
       WHERE eh.report_date >= (NOW() - ($1 || ' hours')::interval)::date
         AND eh.report_date <= CURRENT_DATE
         AND eh.eps_actual IS NOT NULL
         AND eh.symbol IS NOT NULL
       ORDER BY UPPER(eh.symbol), COALESCE(eh.updated_at, eh.created_at) DESC
     )
     SELECT
       re.symbol,
       re.report_date,
       re.eps_actual,
       re.eps_estimate,
       pc.prior_close,
       lq.current_price,
       lq.quote_at,
       CASE
         WHEN pc.prior_close > 0 AND lq.current_price IS NOT NULL THEN
           ((lq.current_price - pc.prior_close) / pc.prior_close) * 100.0
         ELSE NULL
       END AS pct_reaction,
       CASE
         WHEN re.eps_estimate IS NOT NULL AND re.eps_estimate != 0 THEN
           ((re.eps_actual - re.eps_estimate) / ABS(re.eps_estimate)) * 100.0
         ELSE NULL
       END AS eps_surprise_pct
     FROM recent_earnings re
     LEFT JOIN LATERAL (
       SELECT close AS prior_close, date AS prior_date
       FROM daily_ohlc
       WHERE symbol = re.symbol
         AND date < CURRENT_DATE
       ORDER BY date DESC
       LIMIT 1
     ) pc ON true
     LEFT JOIN LATERAL (
       SELECT price AS current_price, COALESCE(updated_at, last_updated) AS quote_at
       FROM market_quotes
       WHERE symbol = re.symbol
       ORDER BY COALESCE(updated_at, last_updated) DESC
       LIMIT 1
     ) lq ON true
     WHERE pc.prior_close IS NOT NULL
       AND lq.current_price IS NOT NULL
       AND ABS(((lq.current_price - pc.prior_close) / pc.prior_close) * 100.0) >= $2
     ORDER BY ABS(((lq.current_price - pc.prior_close) / pc.prior_close) * 100.0) DESC
     LIMIT $3`,
    [String(LOOKBACK_HOURS), REACTION_THRESHOLD_PCT, limit],
    {
      timeoutMs: 8000,
      label: 'premarket_expansion.earnings_reactions',
      maxRetries: 0,
      poolType: 'read',
    },
  );

  return {
    symbols: rows.map((row) => row.symbol),
    metadata: rows.map((row) => ({
      symbol: row.symbol,
      pct_reaction: row.pct_reaction ? Number(row.pct_reaction).toFixed(2) : null,
      eps_surprise_pct: row.eps_surprise_pct ? Number(row.eps_surprise_pct).toFixed(2) : null,
      report_date: row.report_date,
    })),
  };
}

module.exports = {
  getPremarketEarningsExpansion,
  REACTION_THRESHOLD_PCT,
  LOOKBACK_HOURS,
  MAX_EXPANSION_SYMBOLS,
};
