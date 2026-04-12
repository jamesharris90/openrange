const cron = require('node-cron');
const { runIntradayIngestion } = require('./fmp_intraday_ingest');
const { runNewsIngestion } = require('./fmp_news_ingest');
const { runStockNewsIngestion } = require('./fmp_stock_news_ingest');
const { runAll: runEarningsActuals } = require('./fmp_earnings_actuals_ingest');
const { runPricesIngestion } = require('./fmp_prices_ingest');
const { runLiveQuotesIngestion } = require('./fmp_live_quotes_ingest');
const { runEarningsIngestion } = require('./fmp_earnings_ingest');
const { runAnalystEnrichmentIngestion } = require('./fmp_analyst_enrichment_ingest');
const { runTranscriptsIngestion } = require('./fmp_transcripts_ingest');
const { runProfilesIngestion } = require('./fmp_profiles_ingest');
const { runUniverseIngestion } = require('./fmp_universe_ingest');
const { buildMorningUniverse, cleanupTrackedUniverse } = require('../services/trackedUniverseService');
const { refreshIpoCalendar } = require('../routes/ipoCalendar');
const { runNarrativeEngine } = require('../services/mcpNarrativeEngine');
const { runBaselineEngine } = require('../engines/baselineEngine');
const { runNewsEnrichmentEngine } = require('../services/newsEnrichmentEngine');
const { runSignalEvaluation, refreshPerformanceCache } = require('../services/signalEvaluationEngine');
const { runRegimeCapture } = require('../services/marketRegimeEngine');
const { runCatalystBackfill } = require('../engines/catalystBackfillEngine');
const { runNightlyIncrementalBacktest } = require('../backtester/engine');
const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');

const isRailwayRuntime = Boolean(
  process.env.RAILWAY_PROJECT_ID
  || process.env.RAILWAY_ENVIRONMENT_ID
  || process.env.RAILWAY_SERVICE_ID
);
const startupInitialDelayMs = Number(process.env.STARTUP_JOB_INITIAL_DELAY_MS || (isRailwayRuntime ? 30000 : 0));
const startupStaggerMs = Number(process.env.STARTUP_JOB_STAGGER_MS || (isRailwayRuntime ? 15000 : 0));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bridgeStrategySignals() {
  const result = await queryWithTimeout(
    `INSERT INTO signals (id, symbol, signal_type, score, confidence, created_at)
     SELECT gen_random_uuid(), ss.symbol, ss.strategy, ss.score, ss.probability, ss.created_at
     FROM strategy_signals ss
     WHERE ss.created_at > NOW() - INTERVAL '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM signals s
         WHERE s.symbol = ss.symbol
           AND ABS(EXTRACT(EPOCH FROM (s.created_at - ss.created_at))) < 60
       )
     ON CONFLICT DO NOTHING`,
    [],
    { timeoutMs: 15000, label: 'bridge_strategy_signals', maxRetries: 0 }
  );
  return { inserted: result.rowCount || 0 };
}

let started = false;
const inFlightJobs = new Set();
const JOB_SCHEDULES = {
  intraday_1m: '*/1 * * * *',
  live_quotes: '*/5 * * * *',
  news_articles: '*/15 * * * *',
  stock_news: '*/15 * * * *',
  tracked_universe_cleanup: '0 * * * *',
  build_morning_universe: '0 8 * * 1-5',
  daily_ohlc: '35 21,22 * * 1-5',
  daily_ohlc_premarket: '10 8 * * 1-5',
  earnings_events: '0 */6 * * *',
  analyst_enrichment: '30 */6 * * *',
  ipo_calendar: '0 6 * * 1-5',
  earnings_actuals: '0 */4 * * *',
  earnings_transcripts: '12 0 * * *',
  company_profiles: '15 0 * * *',
  ticker_universe: '20 0 * * *',
  narrative_engine: '*/5 * * * *',
  regime_capture: '*/5 * * * *',
  news_enrichment: '*/10 * * * *',
  catalyst_backfill: '*/15 * * * *',
  signal_evaluation: '*/10 * * * *',
  signal_bridge: '*/15 * * * *',
  baseline_cache: '*/30 * * * *',
  perf_cache_refresh: '*/30 * * * *',
  nightly_strategy_backtest: '30 21 * * 1-5',
};

function safeRun(name, fn, options = {}) {
  const lockKey = options.lockKey || name;
  return async () => {
    if (inFlightJobs.has(lockKey)) {
      logger.warn('Skipping ingestion run; previous run still in flight', { job: name, lockKey });
      return;
    }

    inFlightJobs.add(lockKey);
    const startedAt = Date.now();
    logger.info('scheduler job start', { job: name, lockKey });
    try {
      const result = await fn();
      logger.info('scheduler job success', {
        job: name,
        lockKey,
        durationMs: Date.now() - startedAt,
        inserted: result?.inserted ?? 0,
      });
    } catch (err) {
      logger.error('scheduler job failure', {
        job: name,
        lockKey,
        durationMs: Date.now() - startedAt,
        error: err.message,
      });
    } finally {
      inFlightJobs.delete(lockKey);
    }
  };
}

function startIngestionScheduler() {
  if (started) return;
  started = true;

  cron.schedule(JOB_SCHEDULES.intraday_1m, safeRun('intraday_1m', runIntradayIngestion));
  cron.schedule(JOB_SCHEDULES.live_quotes, safeRun('live_quotes', runLiveQuotesIngestion));
  cron.schedule(JOB_SCHEDULES.news_articles, safeRun('news_articles', runNewsIngestion));
  cron.schedule(JOB_SCHEDULES.stock_news, safeRun('stock_news', runStockNewsIngestion));
  cron.schedule(JOB_SCHEDULES.tracked_universe_cleanup, safeRun('tracked_universe_cleanup', cleanupTrackedUniverse));
  cron.schedule(JOB_SCHEDULES.build_morning_universe, safeRun('build_morning_universe', buildMorningUniverse));
  cron.schedule(JOB_SCHEDULES.daily_ohlc, safeRun('daily_ohlc', runPricesIngestion));
  cron.schedule(JOB_SCHEDULES.daily_ohlc_premarket, safeRun('daily_ohlc_premarket', runPricesIngestion, { lockKey: 'daily_ohlc' }));
  cron.schedule(JOB_SCHEDULES.earnings_events, safeRun('earnings_events', runEarningsIngestion));
  cron.schedule(JOB_SCHEDULES.analyst_enrichment, safeRun('analyst_enrichment', runAnalystEnrichmentIngestion));
  cron.schedule(JOB_SCHEDULES.ipo_calendar, safeRun('ipo_calendar', () => refreshIpoCalendar(4)));
  cron.schedule(JOB_SCHEDULES.earnings_actuals, safeRun('earnings_actuals', runEarningsActuals));
  cron.schedule(JOB_SCHEDULES.earnings_transcripts, safeRun('earnings_transcripts', runTranscriptsIngestion));
  cron.schedule(JOB_SCHEDULES.company_profiles, safeRun('company_profiles', runProfilesIngestion));
  cron.schedule(JOB_SCHEDULES.ticker_universe, safeRun('ticker_universe', runUniverseIngestion));
  cron.schedule(JOB_SCHEDULES.narrative_engine, safeRun('narrative_engine', runNarrativeEngine));
  cron.schedule(JOB_SCHEDULES.regime_capture, safeRun('regime_capture', runRegimeCapture));
  cron.schedule(JOB_SCHEDULES.news_enrichment, safeRun('news_enrichment', runNewsEnrichmentEngine));
  cron.schedule(JOB_SCHEDULES.catalyst_backfill, safeRun('catalyst_backfill', () => runCatalystBackfill({ batchSize: 250, maxBatches: 4 })));
  cron.schedule(JOB_SCHEDULES.signal_evaluation, safeRun('signal_evaluation', runSignalEvaluation));
  cron.schedule(JOB_SCHEDULES.signal_bridge, safeRun('signal_bridge', bridgeStrategySignals));
  cron.schedule(JOB_SCHEDULES.baseline_cache, safeRun('baseline_cache', runBaselineEngine));
  cron.schedule(JOB_SCHEDULES.perf_cache_refresh, safeRun('perf_cache_refresh', refreshPerformanceCache));
  cron.schedule(JOB_SCHEDULES.nightly_strategy_backtest, safeRun('nightly_strategy_backtest', runNightlyIncrementalBacktest));

  logger.info('[SCHEDULER] Started. Jobs: ' + JSON.stringify(JOB_SCHEDULES));
  logger.info('[SCHEDULER STARTED] ingestion scheduler active', {
    schedules: JOB_SCHEDULES,
  });

  void (async () => {
    const startupJobs = [
      ['live_quotes_startup', 'live_quotes', runLiveQuotesIngestion],
      ['daily_ohlc_startup', 'daily_ohlc', runPricesIngestion],
      ['earnings_events_startup', 'earnings_events', runEarningsIngestion],
      ['earnings_actuals_startup', 'earnings_actuals', runEarningsActuals],
      ['intraday_1m_startup', 'intraday_1m', runIntradayIngestion],
      ['stock_news_startup', 'stock_news', runStockNewsIngestion],
      ['ipo_calendar_startup', 'ipo_calendar', () => refreshIpoCalendar(4)],
      ['analyst_enrichment_startup', 'analyst_enrichment', runAnalystEnrichmentIngestion],
      ['earnings_transcripts_startup', 'earnings_transcripts', runTranscriptsIngestion],
      ['ticker_universe_startup', 'ticker_universe', runUniverseIngestion],
      ['baseline_cache_startup', 'baseline_cache', runBaselineEngine],
      ['news_enrichment_startup', 'news_enrichment', runNewsEnrichmentEngine],
      ['catalyst_backfill_startup', 'catalyst_backfill', () => runCatalystBackfill({ batchSize: 250, maxBatches: 4 })],
      ['signal_evaluation_startup', 'signal_evaluation', runSignalEvaluation],
      ['perf_cache_startup', 'perf_cache_refresh', refreshPerformanceCache],
      ['regime_capture_startup', 'regime_capture', runRegimeCapture],
    ];

    if (startupInitialDelayMs > 0) {
      logger.info('[SCHEDULER] delaying startup ingestion jobs', {
        initialDelayMs: startupInitialDelayMs,
        staggerMs: startupStaggerMs,
      });
      await sleep(startupInitialDelayMs);
    }

    for (const [name, lockKey, fn] of startupJobs) {
      await safeRun(name, fn, { lockKey })();
      if (startupStaggerMs > 0) {
        await sleep(startupStaggerMs);
      }
    }
  })();
}

module.exports = {
  startIngestionScheduler,
  getIngestionSchedulerState: () => ({
    started,
    inFlightJobs: Array.from(inFlightJobs),
  }),
};
