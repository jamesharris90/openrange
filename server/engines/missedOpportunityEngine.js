'use strict';

const { queryWithTimeout } = require('../db/pg');

async function runMissedOpportunityEngine() {
  const startedAt = Date.now();
  console.log('[MISSED OPPORTUNITY ENGINE] start');

  try {
    const result = await queryWithTimeout(
      `WITH candidates AS (
         SELECT
           d.symbol,
           d.date,
           d.high AS high_price,
           d.low AS low_price,
           d.close AS close_price,
           ROUND((((d.high - d.close) / NULLIF(d.close, 0)) * 100)::numeric, 4) AS high_move_percent
         FROM daily_ohlc d
         WHERE d.close IS NOT NULL
           AND d.high IS NOT NULL
           AND (((d.high - d.close) / NULLIF(d.close, 0)) * 100) > 6
       )
       INSERT INTO missed_opportunities (
         symbol,
         date,
         high_price,
         low_price,
         close_price,
         high_move_percent,
         reason
       )
       SELECT
         c.symbol,
         c.date,
         c.high_price,
         c.low_price,
         c.close_price,
         c.high_move_percent,
         'move_detected_not_signalled'
       FROM candidates c
       WHERE NOT EXISTS (
         SELECT 1
         FROM signal_registry sr
         WHERE sr.symbol = c.symbol
           AND DATE(COALESCE(sr.entry_time, sr.created_at)) = c.date
       )
       AND NOT EXISTS (
         SELECT 1
         FROM missed_opportunities mo
         WHERE mo.symbol = c.symbol
           AND mo.date = c.date
       )
       RETURNING symbol`,
      [],
      { timeoutMs: 20000, label: 'missed_opportunity_engine.insert', maxRetries: 0 }
    );

    const inserted = Array.isArray(result?.rows) ? result.rows.length : 0;
    const runtimeMs = Date.now() - startedAt;
    console.log(`[MISSED OPPORTUNITY ENGINE] complete inserted=${inserted} runtime_ms=${runtimeMs}`);

    return { ok: true, inserted, runtimeMs };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    console.error(`[MISSED OPPORTUNITY ENGINE] error=${error.message}`);
    return { ok: false, inserted: 0, runtimeMs, error: error.message };
  }
}

module.exports = {
  runMissedOpportunityEngine,
};
