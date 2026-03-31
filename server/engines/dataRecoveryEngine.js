'use strict';

/**
 * Data Recovery Engine
 *
 * Runs every 2 minutes when global.systemBlocked is true due to
 * 'data_pipeline_empty'. Attempts to re-seed core data tables by
 * calling the existing ingestion functions directly.
 *
 * Does NOT modify strategy logic, scoring, or signal generation.
 * Only restores the raw data layer (quotes, intraday, daily_ohlc).
 */

const { checkDataPipelineHealth } = require('../guards/systemGuard');

let recoveryInFlight = false;
let recoveryAttempts = 0;

async function runDataRecoveryEngine() {
  // Only run when pipeline is actually blocked due to empty or missing data
  const blockReason = global.systemBlockedReason;
  if (!global.systemBlocked ||
      (blockReason !== 'data_pipeline_empty' && blockReason !== 'daily_data_missing')) {
    return;
  }

  if (recoveryInFlight) {
    console.log('[RECOVERY] previous run still in flight — skipping');
    return;
  }

  recoveryInFlight = true;
  recoveryAttempts += 1;
  const startedAt = Date.now();

  console.log('[RECOVERY] pipeline empty — attempting restore', {
    attempt: recoveryAttempts,
    pipelineHealth: global.pipelineHealth || {},
  });

  try {
    // 1. Trigger intraday ingestion (most critical — fills intraday_1m and market_quotes)
    try {
      const { runIntradayIngestion } = require('../ingestion/fmp_intraday_ingest');
      await runIntradayIngestion();
      console.log('[RECOVERY] intraday ingestion triggered');
    } catch (err) {
      console.warn('[RECOVERY] intraday ingestion failed:', err.message);
    }

    // 2. Trigger daily price ingestion (fills daily_ohlc)
    try {
      const { runPricesIngestion } = require('../ingestion/fmp_prices_ingest');
      await runPricesIngestion();
      console.log('[RECOVERY] daily prices ingestion triggered');
    } catch (err) {
      console.warn('[RECOVERY] daily prices ingestion failed:', err.message);
    }

    // 3. Trigger market metrics refresh (fills market_quotes freshness)
    try {
      const { ingestMarketQuotesRefresh } = require('./fmpMarketIngestion');
      await ingestMarketQuotesRefresh();
      console.log('[RECOVERY] market metrics ingestion triggered');
    } catch (err) {
      console.warn('[RECOVERY] market metrics ingestion failed (non-critical):', err.message);
    }

    // 4. Re-check pipeline health after ingestion attempts
    const restored = await checkDataPipelineHealth();
    const elapsed = Date.now() - startedAt;

    if (restored) {
      recoveryAttempts = 0;
      console.log('[RECOVERY] pipeline restored successfully', { elapsedMs: elapsed });
    } else {
      console.warn('[RECOVERY] pipeline still unhealthy after ingestion attempts', {
        attempt: recoveryAttempts,
        pipelineHealth: global.pipelineHealth || {},
        elapsedMs: elapsed,
      });

      // After 10 consecutive failed recovery attempts, log critical alert
      if (recoveryAttempts >= 10) {
        console.error('[RECOVERY] CRITICAL: 10+ failed recovery attempts — manual intervention required', {
          pipelineHealth: global.pipelineHealth || {},
        });
      }
    }
  } catch (err) {
    console.error('[RECOVERY] unexpected error:', err.message);
  } finally {
    recoveryInFlight = false;
  }
}

module.exports = { runDataRecoveryEngine };
