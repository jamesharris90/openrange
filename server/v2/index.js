const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const screenerRoute = require('./routes/screener');
const newsRoute = require('./routes/news');
const earningsRoute = require('./routes/earnings');
const { runYahooNewsIngest } = require('./ingestion/yahooNewsIngest');

let yahooSchedulerStarted = false;

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

function createV2App() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  console.log('🚫 LEGACY SYSTEM DISABLED — V2 MODE ACTIVE');
  ensureYahooNewsScheduler();

  app.use('/api/v2/screener', screenerRoute);
  app.use('/api/v2/news', newsRoute);
  app.use('/api/v2/earnings', earningsRoute);

  return app;
}

module.exports = {
  createV2App,
};