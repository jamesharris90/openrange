const express = require('express');
const { queryWithTimeout } = require('../db/pg');

const router = express.Router();

router.get('/watchdog', async (_req, res) => {
  try {
    const [watchdogResult, calibrationResult, registryResult, outcomesResult] = await Promise.all([
      queryWithTimeout(
        `SELECT * FROM platform_watchdog_status LIMIT 1`,
        [],
        { timeoutMs: 5000, maxRetries: 0, label: 'api.system.watchdog' }
      ),
      queryWithTimeout(
        `SELECT
           COUNT(*)                                                    AS total_logged,
           COUNT(*) FILTER (WHERE success IS NOT NULL)                 AS evaluated,
           COUNT(*) FILTER (WHERE success IS NULL)                     AS pending_evaluation,
           MAX(entry_time)                                             AS last_signal_at,
           EXTRACT(EPOCH FROM (NOW() - MAX(entry_time)))::INT          AS seconds_since_last_signal,
           ROUND(
             100.0 * COUNT(*) FILTER (WHERE success = TRUE)
             / NULLIF(COUNT(*) FILTER (WHERE success IS NOT NULL), 0),
             2
           )                                                           AS win_rate_pct
         FROM signal_calibration_log`,
        [],
        { timeoutMs: 5000, maxRetries: 0, label: 'api.system.watchdog.calibration' }
      ),
      queryWithTimeout(
        `SELECT
           COUNT(*)                                                                AS total_registry,
           COUNT(*) FILTER (WHERE source = 'replay')                              AS replay_count,
           COUNT(*) FILTER (WHERE source = 'live')                                AS live_count,
           MAX(entry_time)                                                         AS last_entry,
           EXTRACT(EPOCH FROM (NOW() - MAX(entry_time) FILTER (WHERE source = 'replay')))::INT
                                                                                  AS seconds_since_last_replay
         FROM signal_registry`,
        [],
        { timeoutMs: 5000, maxRetries: 0, label: 'api.system.watchdog.registry' }
      ),
      queryWithTimeout(
        `SELECT
           COUNT(*)                                                    AS total_outcomes,
           MAX(evaluated_at)                                           AS last_evaluated_at,
           EXTRACT(EPOCH FROM (NOW() - MAX(evaluated_at)))::INT        AS seconds_since_last_outcome
         FROM signal_outcomes`,
        [],
        { timeoutMs: 5000, maxRetries: 0, label: 'api.system.watchdog.outcomes' }
      ),
    ]);

    const calibration = calibrationResult?.rows?.[0] || null;
    const registry    = registryResult?.rows?.[0]    || null;
    const outcomes    = outcomesResult?.rows?.[0]    || null;

    const secsSinceLastSignal  = calibration?.seconds_since_last_signal  != null ? Number(calibration.seconds_since_last_signal)  : null;
    const secsSinceLastOutcome = outcomes?.seconds_since_last_outcome     != null ? Number(outcomes.seconds_since_last_outcome)     : null;
    const secsSinceLastReplay  = registry?.seconds_since_last_replay      != null ? Number(registry.seconds_since_last_replay)      : null;

    // ── Alert conditions ──────────────────────────────────────────────
    const alerts = [];

    if (secsSinceLastSignal !== null && secsSinceLastSignal > 7200) {
      alerts.push('NO_CALIBRATION_SIGNALS_2H');
    }
    if (
      calibration?.total_logged > 0 &&
      calibration?.evaluated === 0 &&
      calibration?.pending_evaluation > 10
    ) {
      alerts.push('OUTCOMES_NOT_UPDATING');
    }
    // Warn if outcome engine has not produced a result in 4 hours
    if (secsSinceLastOutcome !== null && secsSinceLastOutcome > 14400) {
      alerts.push('NO_OUTCOMES_4H');
    }
    // Warn if replay has never run or is stale (> 25 hours)
    if (Number(registry?.replay_count) === 0) {
      alerts.push('REPLAY_NEVER_RUN');
    } else if (secsSinceLastReplay !== null && secsSinceLastReplay > 90000) {
      alerts.push('REPLAY_STALE');
    }

    return res.json({
      ok: true,
      alerts,
      watchdog: watchdogResult?.rows?.[0] || null,
      calibration: calibration ? {
        total_logged             : Number(calibration.total_logged),
        evaluated                : Number(calibration.evaluated),
        pending_evaluation       : Number(calibration.pending_evaluation),
        last_signal_at           : calibration.last_signal_at || null,
        seconds_since_last_signal: secsSinceLastSignal,
        win_rate_pct             : calibration.win_rate_pct != null ? Number(calibration.win_rate_pct) : null,
      } : null,
      signal_registry: registry ? {
        total_registry            : Number(registry.total_registry),
        replay_count              : Number(registry.replay_count),
        live_count                : Number(registry.live_count),
        last_entry                : registry.last_entry || null,
        seconds_since_last_replay : secsSinceLastReplay,
      } : null,
      signal_outcomes: outcomes ? {
        total_outcomes             : Number(outcomes.total_outcomes),
        last_evaluated_at          : outcomes.last_evaluated_at || null,
        seconds_since_last_outcome : secsSinceLastOutcome,
      } : null,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Failed to load watchdog status',
      detail: error.message,
      watchdog: null,
      calibration: null,
      signal_registry: null,
      signal_outcomes: null,
      alerts: ['WATCHDOG_QUERY_ERROR'],
    });
  }
});

module.exports = router;
