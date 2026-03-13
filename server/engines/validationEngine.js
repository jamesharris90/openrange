'use strict';

const { queryWithTimeout } = require('../db/pg');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function runValidationTests() {
  const startedAt = Date.now();
  console.log('[VALIDATION ENGINE] daily validation start');

  try {
    const daily = await queryWithTimeout(
      `WITH daily AS (
         SELECT
           CURRENT_DATE AS date,
           (SELECT COUNT(*)::int
            FROM signal_registry sr
            WHERE DATE(COALESCE(sr.entry_time, sr.created_at)) = CURRENT_DATE) AS signals_generated,
           (SELECT COUNT(*)::int
            FROM signal_outcomes so
            WHERE DATE(COALESCE(so.evaluated_at, so.created_at)) = CURRENT_DATE) AS signals_evaluated,
           (SELECT COUNT(*)::int
            FROM missed_opportunities mo
            WHERE mo.date = CURRENT_DATE) AS missed_opportunities,
           (SELECT AVG(so.return_percent)::numeric
            FROM signal_outcomes so
            WHERE DATE(COALESCE(so.evaluated_at, so.created_at)) = CURRENT_DATE) AS avg_signal_return,
           (SELECT AVG(r.return_percent)::numeric
            FROM (
              SELECT so.return_percent
              FROM signal_registry sr
              JOIN signal_outcomes so ON so.signal_id = sr.id
              WHERE DATE(COALESCE(sr.entry_time, sr.created_at)) = CURRENT_DATE
              ORDER BY sr.signal_score DESC NULLS LAST
              LIMIT 20
            ) r) AS avg_top_rank_return
       )
       INSERT INTO signal_validation_daily (
         date,
         signals_generated,
         signals_evaluated,
         missed_opportunities,
         avg_signal_return,
         avg_top_rank_return,
         ranking_accuracy,
         learning_score,
         created_at
       )
       SELECT
         d.date,
         d.signals_generated,
         d.signals_evaluated,
         d.missed_opportunities,
         d.avg_signal_return,
         d.avg_top_rank_return,
         CASE
           WHEN COALESCE(d.avg_signal_return, 0) = 0 THEN 0
           ELSE d.avg_top_rank_return / NULLIF(d.avg_signal_return, 0)
         END AS ranking_accuracy,
         (
           CASE
             WHEN COALESCE(d.avg_signal_return, 0) = 0 THEN 0
             ELSE d.avg_top_rank_return / NULLIF(d.avg_signal_return, 0)
           END
         ) *
         (
           1 - (
             COALESCE(d.missed_opportunities, 0)::numeric / NULLIF(GREATEST(COALESCE(d.signals_generated, 0), 1), 0)
           )
         ) AS learning_score,
         NOW()
       FROM daily d
       ON CONFLICT (date) DO UPDATE
       SET
         signals_generated = EXCLUDED.signals_generated,
         signals_evaluated = EXCLUDED.signals_evaluated,
         missed_opportunities = EXCLUDED.missed_opportunities,
         avg_signal_return = EXCLUDED.avg_signal_return,
         avg_top_rank_return = EXCLUDED.avg_top_rank_return,
         ranking_accuracy = EXCLUDED.ranking_accuracy,
         learning_score = EXCLUDED.learning_score,
         created_at = NOW()
       RETURNING *`,
      [],
      { timeoutMs: 15000, label: 'validation.daily', maxRetries: 0 }
    );

    const row = daily?.rows?.[0] || null;
    const runtimeMs = Date.now() - startedAt;
    console.log('[VALIDATION ENGINE] daily validation complete');

    return { ok: true, row, runtimeMs };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    console.error('[VALIDATION ENGINE] daily validation error', error.message);
    return { ok: false, row: null, runtimeMs, error: error.message };
  }
}

async function runWeeklyValidationAggregation() {
  const startedAt = Date.now();
  console.log('[VALIDATION ENGINE] weekly aggregation start');

  try {
    const aggregate = await queryWithTimeout(
      `WITH base AS (
         SELECT
           (CURRENT_DATE - INTERVAL '6 day')::date AS week_start,
           CURRENT_DATE::date AS week_end,
           COALESCE(SUM(signals_generated), 0)::int AS signals_generated,
           COALESCE(SUM(signals_evaluated), 0)::int AS signals_evaluated,
           COALESCE(SUM(missed_opportunities), 0)::int AS missed_opportunities,
           AVG(avg_signal_return)::numeric AS avg_signal_return,
           AVG(avg_top_rank_return)::numeric AS avg_top_rank_return,
           AVG(ranking_accuracy)::numeric AS ranking_accuracy,
           AVG(learning_score)::numeric AS learning_score
         FROM signal_validation_daily
         WHERE date >= (CURRENT_DATE - INTERVAL '6 day')::date
           AND date <= CURRENT_DATE
       )
       INSERT INTO signal_validation_weekly (
         week_start,
         week_end,
         signals_generated,
         signals_evaluated,
         missed_opportunities,
         avg_signal_return,
         avg_top_rank_return,
         ranking_accuracy,
         learning_score,
         created_at
       )
       SELECT
         b.week_start,
         b.week_end,
         b.signals_generated,
         b.signals_evaluated,
         b.missed_opportunities,
         b.avg_signal_return,
         b.avg_top_rank_return,
         b.ranking_accuracy,
         b.learning_score,
         NOW()
       FROM base b
       ON CONFLICT (week_start) DO UPDATE
       SET
         week_end = EXCLUDED.week_end,
         signals_generated = EXCLUDED.signals_generated,
         signals_evaluated = EXCLUDED.signals_evaluated,
         missed_opportunities = EXCLUDED.missed_opportunities,
         avg_signal_return = EXCLUDED.avg_signal_return,
         avg_top_rank_return = EXCLUDED.avg_top_rank_return,
         ranking_accuracy = EXCLUDED.ranking_accuracy,
         learning_score = EXCLUDED.learning_score,
         created_at = NOW()
       RETURNING *`,
      [],
      { timeoutMs: 15000, label: 'validation.weekly', maxRetries: 0 }
    );

    const current = aggregate?.rows?.[0] || null;

    const previousResult = await queryWithTimeout(
      `SELECT learning_score
       FROM signal_validation_weekly
       WHERE week_start < $1
       ORDER BY week_start DESC
       LIMIT 1`,
      [current?.week_start || '1900-01-01'],
      { timeoutMs: 5000, label: 'validation.weekly.previous', maxRetries: 0 }
    );

    const previous = toNumber(previousResult?.rows?.[0]?.learning_score, 0);
    const currentScore = toNumber(current?.learning_score, 0);
    const improvement = currentScore - previous;

    const runtimeMs = Date.now() - startedAt;
    console.log(`[VALIDATION ENGINE] weekly aggregation complete improvement=${improvement.toFixed(4)}`);

    return {
      ok: true,
      row: current,
      previousLearningScore: previous,
      improvement,
      runtimeMs,
    };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    console.error('[VALIDATION ENGINE] weekly aggregation error', error.message);
    return { ok: false, row: null, previousLearningScore: 0, improvement: 0, runtimeMs, error: error.message };
  }
}

module.exports = {
  runValidationTests,
  runWeeklyValidationAggregation,
};
