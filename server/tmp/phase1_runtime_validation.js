const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const { queryWithTimeout } = require('../db/pg');
const { runUniverseIngestion } = require('../ingestion/fmp_universe_ingest');
const { runIntradayIngestion } = require('../ingestion/fmp_intraday_ingest');
const { runPricesIngestion } = require('../ingestion/fmp_prices_ingest');
const { runSignalEvaluation } = require('../services/signalEvaluationEngine');
const { runBacktestEvaluationCycle } = require('../services/backtestScheduler');
const { runTradeOutcomeCycle } = require('../services/tradeOutcomeScheduler');
const { runCatalystBackfill } = require('../engines/catalystBackfillEngine');
const OUTPUT_PATH = process.env.PHASE1_RUNTIME_OUTPUT_PATH || path.resolve(__dirname, '../../logs/build_validation_report.json');

async function fetchOne(sql, label, timeoutMs = 12000) {
  const { rows } = await queryWithTimeout(sql, [], {
    timeoutMs,
    label,
    maxRetries: 0,
  });
  return rows?.[0] || null;
}

async function auditState() {
  const [dailyOhlcvExists, tickerUniverse, dailyOhlc, dailyOhlcv, intraday, catalystSignals, tradeOutcomes, backtestSignals, pendingOpportunities] = await Promise.all([
    fetchOne(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'daily_ohlcv'
       ) AS exists`,
      'phase1.audit.daily_ohlcv_exists'
    ),
    fetchOne(
      `SELECT COUNT(*)::bigint AS count, MAX(last_updated) AS latest_update
       FROM ticker_universe`,
      'phase1.audit.ticker_universe'
    ),
    fetchOne(
      `SELECT COUNT(*)::bigint AS count, MAX(date) AS max_date
       FROM daily_ohlc`,
      'phase1.audit.daily_ohlc',
      30000
    ),
    fetchOne(
      `SELECT COUNT(*)::bigint AS count, MAX(date) AS max_date
       FROM daily_ohlcv`,
      'phase1.audit.daily_ohlcv',
      30000
    ),
    fetchOne(
      `SELECT COUNT(*)::bigint AS count, MAX(timestamp) AS latest_bar
       FROM intraday_1m`,
      'phase1.audit.intraday_1m',
      30000
    ),
    fetchOne(
      `SELECT COUNT(*)::bigint AS count, MAX(created_at) AS latest_created_at
       FROM catalyst_signals`,
      'phase1.audit.catalyst_signals'
    ),
    fetchOne(
      `SELECT COUNT(*)::bigint AS count, MAX(evaluated_at) AS latest_evaluated_at
       FROM trade_outcomes`,
      'phase1.audit.trade_outcomes'
    ),
    fetchOne(
      `SELECT COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE evaluated = false)::bigint AS pending,
              COUNT(*) FILTER (WHERE evaluated = true)::bigint AS evaluated
       FROM backtest_signals`,
      'phase1.audit.backtest_signals'
    ),
    fetchOne(
      `SELECT COUNT(*)::bigint AS count
       FROM opportunities
       WHERE signal_ids IS NOT NULL
         AND array_length(signal_ids, 1) > 0
         AND created_at <= NOW() - INTERVAL '15 minutes'
         AND COALESCE(entry, 0) > 0`,
      'phase1.audit.pending_opportunities'
    ),
  ]);

  return {
    daily_ohlcv_exists: Boolean(dailyOhlcvExists?.exists),
    ticker_universe: tickerUniverse,
    daily_ohlc: dailyOhlc,
    daily_ohlcv: dailyOhlcv,
    intraday_1m: intraday,
    catalyst_signals: catalystSignals,
    trade_outcomes: tradeOutcomes,
    backtest_signals: backtestSignals,
    pending_opportunities: pendingOpportunities,
  };
}

async function main() {
  const result = {
    started_at: new Date().toISOString(),
    precheck: await auditState(),
    jobs: {},
  };

  const jobRunners = {
    ticker_universe: () => runUniverseIngestion(),
    intraday_1m: () => runIntradayIngestion(),
    daily_ohlc_smoke: () => runPricesIngestion(['AAPL', 'SPY', 'QQQ']),
    catalyst_backfill: () => runCatalystBackfill({ batchSize: 100, maxBatches: 1 }),
    signal_evaluation: () => runSignalEvaluation(),
    backtest_evaluation: () => runBacktestEvaluationCycle('phase1_runtime_validation'),
    trade_outcomes: () => runTradeOutcomeCycle('phase1_runtime_validation'),
  };

  for (const [name, runner] of Object.entries(jobRunners)) {
    const startedAt = Date.now();
    try {
      result.jobs[name] = {
        ok: true,
        result: await runner(),
        runtime_ms: Date.now() - startedAt,
      };
    } catch (error) {
      result.jobs[name] = {
        ok: false,
        error: error.message,
        runtime_ms: Date.now() - startedAt,
      };
    }
  }

  result.postcheck = await auditState();
  result.finished_at = new Date().toISOString();
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.error(`[phase1_runtime_validation] wrote ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});