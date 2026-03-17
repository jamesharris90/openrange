const cron = require('node-cron');
const { runIntradayIngestion } = require('./fmp_intraday_ingest');
const { runNewsIngestion } = require('./fmp_news_ingest');
const { runPricesIngestion } = require('./fmp_prices_ingest');
const { runEarningsIngestion } = require('./fmp_earnings_ingest');
const { runTranscriptsIngestion } = require('./fmp_transcripts_ingest');
const { runProfilesIngestion } = require('./fmp_profiles_ingest');
const { runUniverseIngestion } = require('./fmp_universe_ingest');
const { buildMorningUniverse, cleanupTrackedUniverse } = require('../services/trackedUniverseService');
const logger = require('../utils/logger');

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

  cron.schedule('*/1 * * * *', safeRun('intraday_1m', runIntradayIngestion));
  cron.schedule('*/15 * * * *', safeRun('news_articles', runNewsIngestion));
  cron.schedule('0 * * * *', safeRun('tracked_universe_cleanup', cleanupTrackedUniverse));
  cron.schedule('0 8 * * 1-5', safeRun('build_morning_universe', buildMorningUniverse));
  cron.schedule('5 0 * * *', safeRun('daily_ohlc', runPricesIngestion));
  cron.schedule('10 0 * * *', safeRun('earnings_events', runEarningsIngestion));
  cron.schedule('12 0 * * *', safeRun('earnings_transcripts', runTranscriptsIngestion));
  cron.schedule('15 0 * * *', safeRun('company_profiles', runProfilesIngestion));
  cron.schedule('20 0 * * *', safeRun('ticker_universe', runUniverseIngestion));

  logger.info('ingestion scheduler started', {
    schedules: {
      intraday: '*/1 * * * *',
      news: '*/15 * * * *',
      trackedUniverseCleanup: '0 * * * *',
      buildMorningUniverse: '0 8 * * 1-5',
      prices: '5 0 * * *',
      earnings: '10 0 * * *',
      transcripts: '12 0 * * *',
      profiles: '15 0 * * *',
      universe: '20 0 * * *',
    },
  });
}

module.exports = {
  startIngestionScheduler,
  getIngestionSchedulerState: () => ({
    started,
    inFlightJobs: Array.from(inFlightJobs),
  }),
};
