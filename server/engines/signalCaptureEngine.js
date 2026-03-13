'use strict';

const { queryWithTimeout } = require('../db/pg');

async function runSignalCaptureEngine() {
  const startedAt = Date.now();
  console.log('[SIGNAL CAPTURE ENGINE] start');

  try {
    const totals = await queryWithTimeout(
      `SELECT
         (SELECT COUNT(*)::int FROM missed_opportunities mo WHERE mo.date = CURRENT_DATE) AS total_opportunities,
         (SELECT COUNT(*)::int FROM signal_registry sr WHERE DATE(COALESCE(sr.entry_time, sr.created_at)) = CURRENT_DATE) AS signals_detected,
         (SELECT AVG(mo.high_move_percent)::numeric FROM missed_opportunities mo WHERE mo.date = CURRENT_DATE) AS avg_missed_move,
         (SELECT AVG(so.return_percent)::numeric FROM signal_outcomes so WHERE DATE(COALESCE(so.evaluated_at, so.created_at)) = CURRENT_DATE) AS avg_signal_move`,
      [],
      { timeoutMs: 10000, label: 'signal_capture.metrics', maxRetries: 0 }
    );

    const row = totals?.rows?.[0] || {};
    const opportunities = Number(row.total_opportunities || 0);
    const detected = Number(row.signals_detected || 0);
    const captureRate = opportunities > 0 ? detected / opportunities : 0;

    await queryWithTimeout(
      `DELETE FROM signal_capture_analysis WHERE date = CURRENT_DATE`,
      [],
      { timeoutMs: 8000, label: 'signal_capture.delete_today', maxRetries: 0 }
    );

    await queryWithTimeout(
      `INSERT INTO signal_capture_analysis (
         date,
         total_opportunities,
         signals_detected,
         capture_rate,
         avg_missed_move,
         avg_signal_move,
         created_at
       ) VALUES (
         CURRENT_DATE,
         $1,
         $2,
         $3,
         $4,
         $5,
         NOW()
       )`,
      [opportunities, detected, captureRate, row.avg_missed_move || 0, row.avg_signal_move || 0],
      { timeoutMs: 8000, label: 'signal_capture.insert', maxRetries: 0 }
    );

    const runtimeMs = Date.now() - startedAt;
    console.log(`[SIGNAL CAPTURE ENGINE] complete capture_rate=${captureRate.toFixed(4)} runtime_ms=${runtimeMs}`);
    return { ok: true, captureRate, runtimeMs };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    console.error('[SIGNAL CAPTURE ENGINE] error', error.message);
    return { ok: false, captureRate: 0, runtimeMs, error: error.message };
  }
}

module.exports = {
  runSignalCaptureEngine,
};
