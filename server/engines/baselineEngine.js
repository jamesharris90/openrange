'use strict';

/**
 * Baseline Engine
 *
 * Runs every 30 minutes. Computes 5-day avg daily move and avg relative volume
 * for all symbols that have daily_ohlc data, then upserts into symbol_baselines.
 *
 * This pre-aggregation removes the heavy GROUP BY from the MCP narrative engine's
 * per-run batch query, reducing its runtime by ~30-50%.
 */

const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');

async function runBaselineEngine() {
  const t0 = Date.now();

  // Compute 5-day baseline for every symbol that has recent daily_ohlc rows.
  // Uses a lateral join to market_metrics for avg_volume_30d normalisation.
  // Filters to last 7 calendar days (covers 5 trading days across weekends).
  const computeSql = `
    SELECT d.symbol,
      AVG(ABS((d.close - d.open) / NULLIF(d.open, 0) * 100)) AS avg_move,
      AVG(d.volume::numeric / NULLIF(m.avg_volume_30d, 0))    AS avg_rvol
    FROM daily_ohlc d
    JOIN market_metrics m ON m.symbol = d.symbol
    WHERE d.date >= CURRENT_DATE - INTERVAL '7 days'
      AND d.date <  CURRENT_DATE
    GROUP BY d.symbol
    HAVING COUNT(*) >= 1
  `;

  const result = await queryWithTimeout(computeSql, [], {
    timeoutMs: 60000,
    label:     'baseline_engine.compute',
    maxRetries: 0,
  });

  const rows = result.rows;
  if (rows.length === 0) {
    logger.warn('[BASELINE CACHE] no rows computed — daily_ohlc may be empty');
    return { updated: 0 };
  }

  // Batch upsert via json_to_recordset — single round-trip regardless of row count
  const upsertSql = `
    INSERT INTO symbol_baselines (symbol, avg_move, avg_rvol, updated_at)
    SELECT r.symbol, r.avg_move, r.avg_rvol, NOW()
    FROM json_to_recordset($1::json) AS r(
      symbol   text,
      avg_move numeric,
      avg_rvol numeric
    )
    ON CONFLICT (symbol) DO UPDATE
      SET avg_move   = EXCLUDED.avg_move,
          avg_rvol   = EXCLUDED.avg_rvol,
          updated_at = NOW()
  `;

  await queryWithTimeout(upsertSql, [JSON.stringify(rows)], {
    timeoutMs: 30000,
    label:     'baseline_engine.upsert',
    maxRetries: 0,
  });

  const durationMs = Date.now() - t0;
  console.log(`[BASELINE CACHE] symbols=${rows.length} updated=${rows.length} duration_ms=${durationMs}`);
  logger.info('[BASELINE CACHE] complete', { symbols: rows.length, durationMs });

  return { updated: rows.length };
}

module.exports = { runBaselineEngine };
