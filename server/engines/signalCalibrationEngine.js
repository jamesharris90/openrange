const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function normalizeStrategy(tradePlan) {
  const plan = String(tradePlan || '').trim();
  const upper = plan.toUpperCase();

  if (upper.includes('VWAP RECLAIM')) return 'VWAP Reclaim';
  if (upper.includes('ORB')) return 'ORB';
  if (upper.includes('MOMENTUM')) return 'Momentum Continuation';
  return plan || 'Unclassified';
}

async function runSignalCalibrationEngine() {
  try {
    logger.info('[ENGINE_START] signal_calibration_engine');

    const { rows } = await queryWithTimeout(
      `SELECT
         symbol,
         trade_plan,
         setup_grade,
         score,
         price,
         created_at
       FROM radar_top_trades r
       WHERE NOT EXISTS (
         SELECT 1
         FROM signal_calibration_log c
         WHERE c.symbol = r.symbol
           AND c.entry_time = r.created_at
       )`,
      [],
      { timeoutMs: 8000, label: 'signal_calibration_engine.select_new', maxRetries: 0 }
    );

    const signals = Array.isArray(rows) ? rows : [];
    let inserted = 0;

    for (const row of signals) {
      await queryWithTimeout(
        `INSERT INTO signal_calibration_log (
           symbol,
           strategy,
           setup_grade,
           signal_score,
           entry_price,
           entry_time
         )
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          row.symbol,
          normalizeStrategy(row.trade_plan),
          row.setup_grade,
          row.score,
          row.price,
          row.created_at,
        ],
        { timeoutMs: 8000, label: 'signal_calibration_engine.insert', maxRetries: 0 }
      );
      inserted += 1;
    }

    logger.info('[ENGINE_COMPLETE] signal_calibration_engine', { inserted, scanned: signals.length });
    return { inserted, scanned: signals.length };
  } catch (error) {
    logger.error('[ENGINE_ERROR] signal_calibration_engine', { error: error.message });
    throw error;
  }
}

module.exports = {
  runSignalCalibrationEngine,
};