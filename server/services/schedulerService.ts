// @ts-nocheck
const cron = require('node-cron');
const { refreshDirectoryData, getCommonStocks } = require('./directoryServiceV1.ts');
const { refreshUniverse } = require('./universeBuilderV4.ts');
const { refreshAverageVolumes } = require('./volumeMetricsService.ts');
const { updateDailyOhlc, updateNewsEvents, updateEarningsEvents, updateGlobalNewsEvents } = require('./candleUpdateService.ts');
const { refreshNewsForSymbols } = require('./newsEngineV3');

async function refreshDirectoryJob() {
  await refreshDirectoryData();
  console.log('Scheduler: Directory Refreshed');
}

async function refreshQuotesJob() {
  await refreshUniverse();
  console.log('Scheduler: Quotes Refreshed');
}

async function refreshVolumeJob(limit = null) {
  const common = await getCommonStocks();
  const symbolsAll = common.map((row) => row.symbol).filter(Boolean);
  const symbols = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? symbolsAll.slice(0, Number(limit))
    : symbolsAll;
  await refreshAverageVolumes(symbols);
  console.log('Scheduler: Volume Cache Refreshed');
}

function runSafe(jobName, fn) {
  return async () => {
    try {
      await fn();
    } catch (error) {
      console.error(`[schedulerService] ${jobName} failed`, {
        message: error?.message,
      });
    }
  };
}

async function refreshDailyOhlcJob() {
  const common = await getCommonStocks();
  const symbols = common.map((row) => row.symbol).filter(Boolean);
  await updateDailyOhlc(symbols, 3);
  console.log(`Scheduler: Daily OHLC updated for ${symbols.length} symbols`);
}

async function refreshNewsJob() {
  const common = await getCommonStocks();
  // News events (simple store for chart events / cockpit feed) — top 500 symbols
  const symbols = common.map((row) => row.symbol).filter(Boolean).slice(0, 500);
  await updateNewsEvents(symbols, 25);
  console.log('Scheduler: News events updated');
}

async function refreshNewsArticlesJob() {
  const common = await getCommonStocks();
  // Scored news articles for News Scanner page — top 500 symbols
  const symbols = common.map((row) => row.symbol).filter(Boolean).slice(0, 500);
  await refreshNewsForSymbols(symbols, 10);
  console.log('Scheduler: News articles refreshed');
}

async function refreshEarningsJob() {
  const common = await getCommonStocks();
  const symbols = common.map((row) => row.symbol).filter(Boolean);
  // 90-day lookback + 90-day forward window (covers past results + upcoming events)
  await updateEarningsEvents(symbols, 90, 90);
  console.log(`Scheduler: Earnings events updated for ${symbols.length} universe symbols`);
}

function startSchedulerService() {
  cron.schedule('0 4 * * *', runSafe('directory-refresh', refreshDirectoryJob), { timezone: 'Europe/London' });
  cron.schedule('0 7 * * *', runSafe('quotes-refresh', refreshQuotesJob), { timezone: 'Europe/London' });
  cron.schedule('0 0 * * *', runSafe('volume-refresh', refreshVolumeJob), { timezone: 'Europe/London' });

  // After US market close (9:30 PM UK Mon–Fri): update daily candles for full universe
  cron.schedule('30 21 * * 1-5', runSafe('daily-ohlc-update', refreshDailyOhlcJob), { timezone: 'Europe/London' });

  // Global news feed (FMP stock-latest + general-latest, no symbol filter) — every 15 min all day
  cron.schedule('*/15 * * * *', runSafe('global-news-update', updateGlobalNewsEvents), { timezone: 'Europe/London' });

  // Scored news articles for News Scanner — during trading window (1:30 PM – 9:30 PM UK)
  cron.schedule('*/15 13-21 * * 1-5', runSafe('news-articles-update', refreshNewsArticlesJob), { timezone: 'Europe/London' });

  // Earnings calendar refresh — daily at 10 PM UK (after US close + full settlement)
  cron.schedule('0 22 * * 1-5', runSafe('earnings-update', refreshEarningsJob), { timezone: 'Europe/London' });

  runSafe('directory-refresh-bootstrap', refreshDirectoryJob)();
  runSafe('quotes-refresh-bootstrap', refreshQuotesJob)();
  runSafe('volume-refresh-bootstrap', () => refreshVolumeJob(25))();
  // Bootstrap global news feed immediately on startup
  runSafe('global-news-bootstrap', updateGlobalNewsEvents)();
  // Populate scored news_articles on startup
  runSafe('news-articles-bootstrap', refreshNewsArticlesJob)();
}

module.exports = {
  startSchedulerService,
};
