const cron = require('node-cron');
const { runIntradayIngestion } = require('./fmp_intraday_ingest');
const { runNewsIngestion } = require('./fmp_news_ingest');
const { runStockNewsIngestion } = require('./fmp_stock_news_ingest');
const { runAll: runEarningsActuals } = require('./fmp_earnings_actuals_ingest');
const { runPricesIngestion } = require('./fmp_prices_ingest');
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
const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');

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

function safeRun(name, fn) {
  return async () => {
    if (inFlightJobs.has(name)) {
      logger.warn('Skipping ingestion run; previous run still in flight', { job: name });
      return;
    }

    inFlightJobs.add(name);
    const startedAt = Date.now();
    logger.info('scheduler job start', { job: name });
    try {
      const result = await fn();
      logger.info('scheduler job success', {
        job: name,
        durationMs: Date.now() - startedAt,
        inserted: result?.inserted ?? 0,
      });
    } catch (err) {
      logger.error('scheduler job failure', {
        job: name,
        durationMs: Date.now() - startedAt,
        error: err.message,
      });
    } finally {
      inFlightJobs.delete(name);
    }
  };
}

function startIngestionScheduler() {
  if (started) return;
  started = true;

  cron.schedule('*/1 * * * *',   safeRun('intraday_1m',           runIntradayIngestion));
  cron.schedule('*/15 * * * *',  safeRun('news_articles',          runNewsIngestion));
  cron.schedule('*/15 * * * *',  safeRun('stock_news',             runStockNewsIngestion));
  cron.schedule('0 * * * *',     safeRun('tracked_universe_cleanup', cleanupTrackedUniverse));
  cron.schedule('0 8 * * 1-5',   safeRun('build_morning_universe', buildMorningUniverse));
  cron.schedule('5 0 * * *',     safeRun('daily_ohlc',             runPricesIngestion));
  cron.schedule('0 */6 * * *',   safeRun('earnings_events',        runEarningsIngestion));
  cron.schedule('30 */6 * * *',  safeRun('analyst_enrichment',     runAnalystEnrichmentIngestion));
  cron.schedule('0 6 * * 1-5',   safeRun('ipo_calendar',           () => refreshIpoCalendar(4)));
  cron.schedule('0 */4 * * *',   safeRun('earnings_actuals',       runEarningsActuals));
  cron.schedule('12 0 * * *',    safeRun('earnings_transcripts',   runTranscriptsIngestion));
  cron.schedule('15 0 * * *',    safeRun('company_profiles',       runProfilesIngestion));
  cron.schedule('20 0 * * *',    safeRun('ticker_universe',        runUniverseIngestion));
  cron.schedule('*/5 * * * *',   safeRun('narrative_engine',       runNarrativeEngine));
  cron.schedule('*/5 * * * *',   safeRun('regime_capture',         runRegimeCapture));
  cron.schedule('*/10 * * * *',  safeRun('news_enrichment',        runNewsEnrichmentEngine));
  cron.schedule('*/10 * * * *',  safeRun('signal_evaluation',      runSignalEvaluation));
  cron.schedule('*/15 * * * *',  safeRun('signal_bridge',          bridgeStrategySignals));
  cron.schedule('*/30 * * * *',  safeRun('baseline_cache',         runBaselineEngine));
  cron.schedule('*/30 * * * *',  safeRun('perf_cache_refresh',     refreshPerformanceCache));

  logger.info('[SCHEDULER STARTED] ingestion scheduler active', {
    schedules: {
      intraday:               '*/1 * * * *',
      news:                   '*/15 * * * *',
      stockNews:              '*/15 * * * *',
      trackedUniverseCleanup: '0 * * * *',
      buildMorningUniverse:   '0 8 * * 1-5',
      prices:                 '5 0 * * *',
      earnings:               '0 */6 * * *',
      analystEnrichment:      '30 */6 * * *',
      ipoCalendar:            '0 6 * * 1-5',
      earningsActuals:        '0 */4 * * *',
      transcripts:            '12 0 * * *',
      profiles:               '15 0 * * *',
      universe:               '20 0 * * *',
      narrativeEngine:        '*/5 * * * *',
      regimeCapture:          '*/5 * * * *',
      newsEnrichment:         '*/10 * * * *',
      signalEvaluation:       '*/10 * * * *',
      baselineCache:          '*/30 * * * *',
      perfCacheRefresh:       '*/30 * * * *',
    },
  });

  // Startup runs — fire immediately to fill gaps from any prior downtime
  safeRun('earnings_events_startup',      runEarningsIngestion)();
  safeRun('earnings_actuals_startup',     runEarningsActuals)();
  safeRun('stock_news_startup',           runStockNewsIngestion)();
  safeRun('ipo_calendar_startup',         () => refreshIpoCalendar(4))();
  safeRun('analyst_enrichment_startup',   runAnalystEnrichmentIngestion)();
  safeRun('earnings_transcripts_startup', runTranscriptsIngestion)();
  safeRun('ticker_universe_startup',      runUniverseIngestion)();
  safeRun('baseline_cache_startup',       runBaselineEngine)();
  safeRun('news_enrichment_startup',      runNewsEnrichmentEngine)();
  safeRun('perf_cache_startup',           refreshPerformanceCache)();
  safeRun('regime_capture_startup',       runRegimeCapture)();
}

module.exports = {
  startIngestionScheduler,
  getIngestionSchedulerState: () => ({
    started,
    inFlightJobs: Array.from(inFlightJobs),
  }),
};
