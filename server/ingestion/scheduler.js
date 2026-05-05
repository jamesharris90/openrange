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
const { runIngest: runInsiderTradesIngestion } = require('./fmp_insider_trades_ingest');
const { runIngest: runInstitutional13fIngestion } = require('./fmp_institutional_13f_ingest');
const { runIngest: runActivistFilingsIngestion } = require('./fmp_activist_filings_ingest');
const { runIngest: runSenateHouseIngestion } = require('./fmp_senate_house_ingest');
const { runIngest: runFomcCalendarIngestion } = require('./calendar/fomc_ingest');
const { runIngest: runFredEconomicIngestion } = require('./calendar/fred_economic_ingest');
const { runIngest: runFmpIpoCalendarIngestion } = require('./calendar/fmp_ipo_ingest');
const { runIngest: runFmpSplitsCalendarIngestion } = require('./calendar/fmp_splits_ingest');
const { runIngest: runClinicalTrialsIngestion } = require('./calendar/clinical_trials_ingest');
const { runIngest: runOpenFdaIngestion } = require('./calendar/openfda_ingest');
const { runIngest: runFvapElectionsIngestion } = require('./calendar/fvap_elections_ingest');
const { runIngest: runStaticCalendarLoaders } = require('./calendar/load_static_calendars');
const { buildMorningUniverse, cleanupTrackedUniverse } = require('../services/trackedUniverseService');
const { refreshIpoCalendar } = require('../routes/ipoCalendar');
const { runNarrativeEngine } = require('../services/mcpNarrativeEngine');
const { runBaselineEngine } = require('../engines/baselineEngine');
const { runNewsEnrichmentEngine } = require('../services/newsEnrichmentEngine');
const { runSignalEvaluation, refreshPerformanceCache } = require('../services/signalEvaluationEngine');
const { runRegimeCapture } = require('../services/marketRegimeEngine');
const { runCatalystBackfill } = require('../engines/catalystBackfillEngine');
const { runNightlyIncrementalBacktest } = require('../backtester/engine');
const { runComputeSmartMoneyScores } = require('../jobs/computeSmartMoneyScores');
const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');

const isRailwayRuntime = Boolean(
  process.env.RAILWAY_PROJECT_ID
  || process.env.RAILWAY_ENVIRONMENT_ID
  || process.env.RAILWAY_SERVICE_ID
);
const startupInitialDelayMs = Number(process.env.STARTUP_JOB_INITIAL_DELAY_MS || (isRailwayRuntime ? 30000 : 0));
const startupStaggerMs = Number(process.env.STARTUP_JOB_STAGGER_MS || (isRailwayRuntime ? 15000 : 0));
const scheduledStartupGraceMs = Number(process.env.SCHEDULED_JOB_STARTUP_GRACE_MS || (isRailwayRuntime ? 300000 : 0));
const RAILWAY_STARTUP_DISABLED_LOCK_KEYS = new Set([
  'daily_ohlc',
  'stock_news',
  'analyst_enrichment',
  'earnings_transcripts',
  'company_profiles',
  'ticker_universe',
  'news_enrichment',
  'catalyst_backfill',
]);
const STARTUP_GRACE_LOCK_KEYS = new Set([
  'daily_ohlc',
  'news_articles',
  'stock_news',
  'news_enrichment',
  'catalyst_backfill',
]);

function readBooleanEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return defaultValue;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

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
let schedulerStartedAt = 0;
const inFlightJobs = new Set();
const JOB_SCHEDULES = {
  intraday_1m: '*/1 * * * *',
  live_quotes: '*/5 * * * *',
  news_articles: '0 6 * * *',
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
  congressional_trades_latest: '15 6 * * 1-5',
  congressional_trades_backfill: '15 6 * * 1',
  fred_economic_calendar: '30 5 * * 1-5',
  fmp_ipo_calendar_events: '0 6 * * 1-5',
  fmp_splits_calendar: '0 6 * * 1-5',
  fomc_calendar: '0 6 * * 1',
  clinical_trials_calendar: '0 6 * * 1',
  static_calendar_loaders: '0 6 * * 1',
  openfda_calendar: '0 7 * * 1',
  fvap_elections_calendar: '0 8 * * 1',
  insider_trades: '30 6 * * 1-5',
  institutional_13f: '0 6 * * 1',
  activist_filings: '45 6 * * 1-5',
  smart_money_scores: '0 7 * * 1-5',
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
    if (Number(options.startupGraceMs || 0) > 0) {
      const elapsedMs = Date.now() - schedulerStartedAt;
      if (elapsedMs >= 0 && elapsedMs < Number(options.startupGraceMs)) {
        logger.info('scheduler job skipped during startup grace window', {
          job: name,
          lockKey,
          elapsedMs,
          startupGraceMs: Number(options.startupGraceMs),
        });
        return;
      }
    }

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

function getScheduledJobOptions(lockKey) {
  if (isRailwayRuntime && STARTUP_GRACE_LOCK_KEYS.has(lockKey) && scheduledStartupGraceMs > 0) {
    return { startupGraceMs: scheduledStartupGraceMs };
  }

  return {};
}

function shouldRunStartupJob(lockKey) {
  if (!isRailwayRuntime) {
    return true;
  }

  const envName = `ENABLE_${String(lockKey || '').trim().toUpperCase()}_STARTUP`;
  const defaultValue = !RAILWAY_STARTUP_DISABLED_LOCK_KEYS.has(lockKey);
  return readBooleanEnv(envName, defaultValue);
}

function startIngestionScheduler() {
  if (started) return;
  started = true;
  schedulerStartedAt = Date.now();

  cron.schedule(JOB_SCHEDULES.intraday_1m, safeRun('intraday_1m', runIntradayIngestion, getScheduledJobOptions('intraday_1m')));
  cron.schedule(JOB_SCHEDULES.live_quotes, safeRun('live_quotes', runLiveQuotesIngestion, getScheduledJobOptions('live_quotes')));
  cron.schedule(JOB_SCHEDULES.news_articles, safeRun('news_articles', runNewsIngestion, getScheduledJobOptions('news_articles')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.stock_news, safeRun('stock_news', runStockNewsIngestion, getScheduledJobOptions('stock_news')));
  cron.schedule(JOB_SCHEDULES.tracked_universe_cleanup, safeRun('tracked_universe_cleanup', cleanupTrackedUniverse, getScheduledJobOptions('tracked_universe_cleanup')));
  cron.schedule(JOB_SCHEDULES.build_morning_universe, safeRun('build_morning_universe', buildMorningUniverse, getScheduledJobOptions('build_morning_universe')));
  cron.schedule(JOB_SCHEDULES.daily_ohlc, safeRun('daily_ohlc', runPricesIngestion, getScheduledJobOptions('daily_ohlc')));
  cron.schedule(JOB_SCHEDULES.daily_ohlc_premarket, safeRun('daily_ohlc_premarket', runPricesIngestion, { lockKey: 'daily_ohlc', ...getScheduledJobOptions('daily_ohlc') }));
  cron.schedule(JOB_SCHEDULES.earnings_events, safeRun('earnings_events', runEarningsIngestion, getScheduledJobOptions('earnings_events')));
  cron.schedule(JOB_SCHEDULES.analyst_enrichment, safeRun('analyst_enrichment', runAnalystEnrichmentIngestion, getScheduledJobOptions('analyst_enrichment')));
  cron.schedule(JOB_SCHEDULES.ipo_calendar, safeRun('ipo_calendar', () => refreshIpoCalendar(4), getScheduledJobOptions('ipo_calendar')));
  cron.schedule(JOB_SCHEDULES.earnings_actuals, safeRun('earnings_actuals', runEarningsActuals, getScheduledJobOptions('earnings_actuals')));
  cron.schedule(JOB_SCHEDULES.earnings_transcripts, safeRun('earnings_transcripts', runTranscriptsIngestion, getScheduledJobOptions('earnings_transcripts')));
  cron.schedule(JOB_SCHEDULES.company_profiles, safeRun('company_profiles', runProfilesIngestion, getScheduledJobOptions('company_profiles')));
  cron.schedule(JOB_SCHEDULES.ticker_universe, safeRun('ticker_universe', runUniverseIngestion, getScheduledJobOptions('ticker_universe')));
  cron.schedule(JOB_SCHEDULES.congressional_trades_latest, safeRun('congressional_trades_latest', () => runSenateHouseIngestion(), getScheduledJobOptions('congressional_trades_latest')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.congressional_trades_backfill, safeRun('congressional_trades_backfill', () => runSenateHouseIngestion({ includeBackfill: true, skipLatest: true }), getScheduledJobOptions('congressional_trades_backfill')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.fred_economic_calendar, safeRun('fred_economic_calendar', runFredEconomicIngestion, getScheduledJobOptions('fred_economic_calendar')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.fmp_ipo_calendar_events, safeRun('fmp_ipo_calendar_events', runFmpIpoCalendarIngestion, getScheduledJobOptions('fmp_ipo_calendar_events')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.fmp_splits_calendar, safeRun('fmp_splits_calendar', runFmpSplitsCalendarIngestion, getScheduledJobOptions('fmp_splits_calendar')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.fomc_calendar, safeRun('fomc_calendar', runFomcCalendarIngestion, getScheduledJobOptions('fomc_calendar')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.clinical_trials_calendar, safeRun('clinical_trials_calendar', runClinicalTrialsIngestion, getScheduledJobOptions('clinical_trials_calendar')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.static_calendar_loaders, safeRun('static_calendar_loaders', runStaticCalendarLoaders, getScheduledJobOptions('static_calendar_loaders')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.openfda_calendar, safeRun('openfda_calendar', runOpenFdaIngestion, getScheduledJobOptions('openfda_calendar')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.fvap_elections_calendar, safeRun('fvap_elections_calendar', runFvapElectionsIngestion, getScheduledJobOptions('fvap_elections_calendar')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.insider_trades, safeRun('insider_trades', runInsiderTradesIngestion, getScheduledJobOptions('insider_trades')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.institutional_13f, safeRun('institutional_13f', runInstitutional13fIngestion, getScheduledJobOptions('institutional_13f')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.activist_filings, safeRun('activist_filings', runActivistFilingsIngestion, getScheduledJobOptions('activist_filings')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.smart_money_scores, safeRun('smart_money_scores', runComputeSmartMoneyScores, getScheduledJobOptions('smart_money_scores')), { timezone: 'Europe/London' });
  cron.schedule(JOB_SCHEDULES.narrative_engine, safeRun('narrative_engine', runNarrativeEngine, getScheduledJobOptions('narrative_engine')));
  cron.schedule(JOB_SCHEDULES.regime_capture, safeRun('regime_capture', runRegimeCapture, getScheduledJobOptions('regime_capture')));
  cron.schedule(JOB_SCHEDULES.news_enrichment, safeRun('news_enrichment', runNewsEnrichmentEngine, getScheduledJobOptions('news_enrichment')));
  cron.schedule(JOB_SCHEDULES.catalyst_backfill, safeRun('catalyst_backfill', () => runCatalystBackfill({ batchSize: 250, maxBatches: 4 }), getScheduledJobOptions('catalyst_backfill')));
  cron.schedule(JOB_SCHEDULES.signal_evaluation, safeRun('signal_evaluation', runSignalEvaluation, getScheduledJobOptions('signal_evaluation')));
  cron.schedule(JOB_SCHEDULES.signal_bridge, safeRun('signal_bridge', bridgeStrategySignals, getScheduledJobOptions('signal_bridge')));
  cron.schedule(JOB_SCHEDULES.baseline_cache, safeRun('baseline_cache', runBaselineEngine, getScheduledJobOptions('baseline_cache')));
  cron.schedule(JOB_SCHEDULES.perf_cache_refresh, safeRun('perf_cache_refresh', refreshPerformanceCache, getScheduledJobOptions('perf_cache_refresh')));
  cron.schedule(JOB_SCHEDULES.nightly_strategy_backtest, safeRun('nightly_strategy_backtest', runNightlyIncrementalBacktest, getScheduledJobOptions('nightly_strategy_backtest')));

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
      if (!shouldRunStartupJob(lockKey)) {
        logger.info('[SCHEDULER] startup job skipped by deployment policy', {
          job: name,
          lockKey,
        });
        continue;
      }

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
