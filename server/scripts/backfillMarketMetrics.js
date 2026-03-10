const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { queryWithTimeout } = require('../db/pg');

async function run() {
  const startedAt = Date.now();

  await queryWithTimeout(
    `ALTER TABLE market_metrics
      ADD COLUMN IF NOT EXISTS float_shares NUMERIC,
      ADD COLUMN IF NOT EXISTS atr_percent NUMERIC`,
    [],
    { timeoutMs: 8000, label: 'scripts.backfill_market_metrics.ensure_columns', maxRetries: 0 }
  );

  const updateResult = await queryWithTimeout(
    `WITH ohlc_latest AS (
       SELECT DISTINCT ON (d.symbol)
         d.symbol,
         d.high,
         d.low
       FROM daily_ohlc d
       ORDER BY d.symbol, d.date DESC
     )
     UPDATE market_metrics m
     SET
       float_shares = COALESCE(
         m.float_shares,
         CASE
           WHEN COALESCE(q.market_cap, 0) > 0 AND COALESCE(q.price, 0) > 0
             THEN q.market_cap / q.price
           ELSE NULL
         END
       ),
       atr_percent = COALESCE(
         m.atr_percent,
         CASE
           WHEN COALESCE(m.price, 0) > 0 AND COALESCE(o.high, 0) > 0 AND COALESCE(o.low, 0) > 0
             THEN ((o.high - o.low) / m.price) * 100
           ELSE NULL
         END
       ),
       updated_at = NOW()
     FROM market_quotes q
     LEFT JOIN ohlc_latest o ON o.symbol = q.symbol
     WHERE m.symbol = q.symbol
       AND (
         COALESCE(m.float_shares, 0) = 0
         OR COALESCE(m.atr_percent, 0) = 0
       )`,
    [],
    { timeoutMs: 60000, label: 'scripts.backfill_market_metrics.update', maxRetries: 0 }
  );

  const { rows } = await queryWithTimeout(
    `SELECT
       COUNT(*) AS total_rows,
       COUNT(*) FILTER (WHERE float_shares IS NULL OR float_shares = 0) AS missing_float_shares,
       COUNT(*) FILTER (WHERE atr_percent IS NULL OR atr_percent = 0) AS missing_atr_percent
     FROM market_metrics`,
    [],
    { timeoutMs: 10000, label: 'scripts.backfill_market_metrics.summary', maxRetries: 0 }
  );

  const runtimeMs = Date.now() - startedAt;
  console.log('[BACKFILL_MARKET_METRICS] complete', {
    updatedRows: updateResult.rowCount || 0,
    summary: rows[0] || {},
    runtimeMs,
  });
}

run().catch((error) => {
  console.error('[BACKFILL_MARKET_METRICS] failed', error.message);
  process.exit(1);
});
