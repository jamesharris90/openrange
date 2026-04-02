const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const screenerRoute = require('./routes/screener');
const researchRoute = require('./routes/research');
const newsRoute = require('./routes/news');
const earningsRoute = require('./routes/earnings');
const { runYahooNewsIngest } = require('./ingestion/yahooNewsIngest');
const { runNewsBackfill } = require('./ingestion/newsBackfill');

let yahooSchedulerStarted = false;
let newsBackfillSchedulerStarted = false;

function ensureYahooNewsScheduler() {
  if (yahooSchedulerStarted) {
    return;
  }

  yahooSchedulerStarted = true;
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runYahooNewsIngest();
    } catch (error) {
      console.warn('[YAHOO_NEWS_INGEST] scheduled run failed', { error: error.message });
    }
  });

  console.log('[YAHOO_NEWS_INGEST] scheduler active (every 15 minutes)');
}

function ensureNewsBackfillScheduler() {
  if (newsBackfillSchedulerStarted) {
    return;
  }

  newsBackfillSchedulerStarted = true;
  cron.schedule('0 */6 * * *', async () => {
    console.log('[NEWS_BACKFILL] started');
    try {
      await runNewsBackfill();
    } catch (error) {
      console.warn('[NEWS_BACKFILL] scheduled run failed', { error: error.message });
    }
  });

  console.log('[NEWS_BACKFILL] scheduler active (every 6 hours)');
}

function createV2App() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  console.log('🚫 LEGACY SYSTEM DISABLED — V2 MODE ACTIVE');
  ensureYahooNewsScheduler();
  ensureNewsBackfillScheduler();

  app.use('/api/v2/screener', screenerRoute);
  app.use('/api/v2/research', researchRoute);
  app.use('/api/v2/news', newsRoute);
  app.use('/api/v2/earnings', earningsRoute);

  return app;
}

module.exports = {
  createV2App,
};