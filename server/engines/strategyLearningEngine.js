'use strict';

const { queryWithTimeout } = require('../db/pg');

async function runStrategyLearningEngine() {
  const startedAt = Date.now();
  console.log('[STRATEGY LEARNING ENGINE] start');

  try {
    await queryWithTimeout('DELETE FROM strategy_learning_metrics', [], {
      timeoutMs: 12000,
      label: 'strategy_learning.clear',
      maxRetries: 0,
    });

    const result = await queryWithTimeout(
      `WITH base AS (
         SELECT
           COALESCE(sr.strategy, so.strategy, 'UNKNOWN') AS strategy,
           so.return_percent,
           emt.expected_move_hit,
           emt.expected_move_error
         FROM signal_registry sr
         LEFT JOIN signal_outcomes so ON so.signal_id = sr.id
         LEFT JOIN expected_move_tracking emt ON emt.signal_id = sr.id
         WHERE COALESCE(sr.strategy, so.strategy) IS NOT NULL
       ),
       agg AS (
         SELECT
           strategy,
           COUNT(return_percent)::int AS signals_count,
           AVG(CASE WHEN return_percent > 0 THEN 1 ELSE 0 END)::numeric AS win_rate,
           AVG(return_percent)::numeric AS avg_return,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY return_percent) AS median_return,
           MAX(return_percent)::numeric AS max_return,
           AVG(CASE WHEN expected_move_hit THEN 1 ELSE 0 END)::numeric AS expected_move_hit_rate,
           AVG(CASE WHEN return_percent <= 0 THEN 1 ELSE 0 END)::numeric AS false_signal_rate
         FROM base
         GROUP BY strategy
       ),
       missed_rate AS (
         SELECT
           COALESCE(
             (SELECT COUNT(*)::numeric FROM missed_opportunities WHERE date >= CURRENT_DATE - INTERVAL '30 day')
             / NULLIF((SELECT COUNT(*)::numeric FROM signal_registry WHERE DATE(COALESCE(entry_time, created_at)) >= CURRENT_DATE - INTERVAL '30 day'), 0),
             0
           ) AS missed_opportunity_rate
       )
       INSERT INTO strategy_learning_metrics (
         strategy,
         signals_count,
         win_rate,
         avg_return,
         median_return,
         max_return,
         expected_move_hit_rate,
         false_signal_rate,
         missed_opportunity_rate,
         edge_score,
         learning_score,
         updated_at
       )
       SELECT
         a.strategy,
         a.signals_count,
         COALESCE(a.win_rate, 0),
         COALESCE(a.avg_return, 0),
         COALESCE(a.median_return, 0),
         COALESCE(a.max_return, 0),
         COALESCE(a.expected_move_hit_rate, 0),
         COALESCE(a.false_signal_rate, 0),
         m.missed_opportunity_rate,
         (
           COALESCE(a.win_rate, 0) * 0.4
           + COALESCE(a.expected_move_hit_rate, 0) * 0.3
           + GREATEST(LEAST(COALESCE(a.avg_return, 0) / 10.0, 1), -1) * 0.3
         )::numeric AS edge_score,
         (
           (
             COALESCE(a.win_rate, 0) * 0.4
             + COALESCE(a.expected_move_hit_rate, 0) * 0.3
             + GREATEST(LEAST(COALESCE(a.avg_return, 0) / 10.0, 1), -1) * 0.3
           ) * (1 - COALESCE(a.false_signal_rate, 0)) * (1 - COALESCE(m.missed_opportunity_rate, 0))
         )::numeric AS learning_score,
         NOW()
       FROM agg a
       CROSS JOIN missed_rate m
       RETURNING strategy`,
      [],
      { timeoutMs: 20000, label: 'strategy_learning.insert', maxRetries: 0 }
    );

    const processed = Array.isArray(result?.rows) ? result.rows.length : 0;
    const runtimeMs = Date.now() - startedAt;
    console.log(`[STRATEGY LEARNING ENGINE] complete strategies=${processed} runtime_ms=${runtimeMs}`);
    return { ok: true, processed, runtimeMs };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    console.error('[STRATEGY LEARNING ENGINE] error', error.message);
    return { ok: false, processed: 0, runtimeMs, error: error.message };
  }
}

module.exports = {
  runStrategyLearningEngine,
};
