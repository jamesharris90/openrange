const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function runExpectedMoveEngine() {
  const startedAt = Date.now();

  try {
    const result = await queryWithTimeout(
      `WITH candidates AS (
         SELECT
           sr.id AS signal_id,
           sr.symbol,
           sr.entry_price,
           DATE(COALESCE(sr.entry_time, sr.created_at)) AS entry_date,
           d.high,
           d.low,
           d.close,
           COALESCE(sf.rvol, 1) AS rvol,
           COALESCE(sf.gap_percent, 0) AS gap_percent,
           COALESCE(sf.relative_strength, 0) AS relative_strength,
           COALESCE(sf.volume_spike_ratio, sf.rvol, 1) AS volume_spike_ratio
         FROM signal_registry sr
         LEFT JOIN daily_ohlc d
           ON d.symbol = sr.symbol
          AND d.date = DATE(COALESCE(sr.entry_time, sr.created_at))
         LEFT JOIN signal_features sf ON sf.signal_id = sr.id
         ORDER BY COALESCE(sr.entry_time, sr.created_at) DESC
         LIMIT 2000
       ), computed AS (
       SELECT
         c.signal_id,
         c.symbol,
         (
           GREATEST(ABS(c.gap_percent), 0)
           + GREATEST(c.rvol - 1, 0) * 2
           + ABS(c.relative_strength) * 0.25
         )::numeric AS expected_move_percent,
         CASE
           WHEN NULLIF(c.entry_price, 0) IS NULL OR c.high IS NULL THEN 0
           ELSE ((c.high - c.entry_price) / NULLIF(c.entry_price, 0) * 100)::numeric
         END AS actual_move_percent,
         CASE
           WHEN NULLIF(c.entry_price, 0) IS NULL OR c.high IS NULL THEN false
           ELSE (((c.high - c.entry_price) / NULLIF(c.entry_price, 0) * 100) >= (
             GREATEST(ABS(c.gap_percent), 0)
             + GREATEST(c.rvol - 1, 0) * 2
             + ABS(c.relative_strength) * 0.25
           ))
         END AS expected_move_hit,
         CASE
           WHEN NULLIF(c.entry_price, 0) IS NULL OR c.high IS NULL THEN 0
           ELSE ABS(
             ((c.high - c.entry_price) / NULLIF(c.entry_price, 0) * 100)
             - (
               GREATEST(ABS(c.gap_percent), 0)
               + GREATEST(c.rvol - 1, 0) * 2
               + ABS(c.relative_strength) * 0.25
             )
           )::numeric
         END AS expected_move_error,
         (
           GREATEST(ABS(c.gap_percent), 0)
           + GREATEST(c.volume_spike_ratio - 1, 0) * 3
         )::numeric AS implied_volatility,
         CASE
           WHEN NULLIF(c.close, 0) IS NULL OR c.high IS NULL OR c.low IS NULL THEN 0
           ELSE ((c.high - c.low) / NULLIF(c.close, 0) * 100)::numeric
         END AS historical_volatility,
         CASE
           WHEN (CASE WHEN NULLIF(c.close, 0) IS NULL OR c.high IS NULL OR c.low IS NULL THEN 0 ELSE ((c.high - c.low) / NULLIF(c.close, 0) * 100) END) = 0
             THEN 0
           ELSE (
             (GREATEST(ABS(c.gap_percent), 0) + GREATEST(c.volume_spike_ratio - 1, 0) * 3)
             / NULLIF((CASE WHEN NULLIF(c.close, 0) IS NULL OR c.high IS NULL OR c.low IS NULL THEN 0 ELSE ((c.high - c.low) / NULLIF(c.close, 0) * 100) END), 0)
           )::numeric
         END AS iv_hv_ratio,
         CASE
           WHEN NULLIF(c.close, 0) IS NULL OR c.high IS NULL OR c.low IS NULL THEN 0
           ELSE ((c.high - c.low) / NULLIF(c.close, 0) * 100)::numeric
         END AS atr_percent,
         NOW() AS created_at
       FROM candidates c
       ), updated AS (
         UPDATE expected_move_tracking emt
         SET symbol = comp.symbol,
             expected_move_percent = comp.expected_move_percent,
             actual_move_percent = comp.actual_move_percent,
             expected_move_hit = comp.expected_move_hit,
             expected_move_error = comp.expected_move_error,
             implied_volatility = comp.implied_volatility,
             historical_volatility = comp.historical_volatility,
             iv_hv_ratio = comp.iv_hv_ratio,
             atr_percent = comp.atr_percent,
             created_at = comp.created_at
         FROM computed comp
         WHERE emt.signal_id = comp.signal_id
         RETURNING emt.signal_id
       ), inserted AS (
         INSERT INTO expected_move_tracking (
           signal_id,
           symbol,
           expected_move_percent,
           actual_move_percent,
           expected_move_hit,
           expected_move_error,
           implied_volatility,
           historical_volatility,
           iv_hv_ratio,
           atr_percent,
           created_at
         )
         SELECT
           comp.signal_id,
           comp.symbol,
           comp.expected_move_percent,
           comp.actual_move_percent,
           comp.expected_move_hit,
           comp.expected_move_error,
           comp.implied_volatility,
           comp.historical_volatility,
           comp.iv_hv_ratio,
           comp.atr_percent,
           comp.created_at
         FROM computed comp
         WHERE NOT EXISTS (
           SELECT 1
           FROM expected_move_tracking emt
           WHERE emt.signal_id = comp.signal_id
         )
         RETURNING signal_id
       )
       SELECT
         (SELECT COUNT(*)::int FROM inserted) AS inserted,
         (SELECT COUNT(*)::int FROM updated) AS updated,
         (SELECT COUNT(*)::int FROM computed) AS processed`,
      [],
      { timeoutMs: 25000, label: 'engines.expectedMove.insert_tracking', maxRetries: 0 }
    );

    const inserted = Number(result?.rows?.[0]?.inserted || 0);
    const updated = Number(result?.rows?.[0]?.updated || 0);
    const processed = Number(result?.rows?.[0]?.processed || 0);
    const runtimeMs = Date.now() - startedAt;
    logger.info('Expected move engine complete', { inserted, updated, processed, runtimeMs });
    return { inserted, updated, processed, runtimeMs };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.error('Expected move engine failed', { error: error.message, runtimeMs });
    return { inserted: 0, updated: 0, processed: 0, runtimeMs, error: error.message };
  }
}

module.exports = {
  runExpectedMoveEngine,
};
