const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const cron = require('node-cron');
const { currentSession, nextSession } = require('../beacon-v0/outcomes/tradingCalendar');
const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');
const { runPremarketCatalystModel } = require('./modelRunner');

let started = false;

function toEtDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isUsTradingDay(date = new Date()) {
  const current = currentSession(date);
  if (current) {
    return true;
  }

  try {
    const next = nextSession(date);
    return Boolean(next && toEtDateString(next.open) === toEtDateString(date));
  } catch (_error) {
    return false;
  }
}

async function runIfTradingDay(label) {
  const now = new Date();
  if (!isUsTradingDay(now)) {
    logger.info('premarket catalyst cron skipped on non-trading day', {
      event: 'premarket_catalyst.skipped_non_trading_day',
      label,
      timestamp: now.toISOString(),
    });
    return {
      skipped: true,
      reason: 'non_trading_day',
      label,
    };
  }

  logger.info('premarket catalyst cron run started', {
    event: 'premarket_catalyst.run_started',
    label,
    timestamp: now.toISOString(),
  });

  try {
    const result = await runPremarketCatalystModel({});
    logger.info('premarket catalyst cron run complete', {
      event: 'premarket_catalyst.run_complete',
      label,
      ...result,
    });
    return result;
  } catch (error) {
    logger.error('premarket catalyst cron run failed', {
      event: 'premarket_catalyst.run_failed',
      label,
      error: error.message,
    });
    throw error;
  }
}

function registerPremarketCatalystCron() {
  if (started) {
    return;
  }

  started = true;

  cron.schedule('30 13 * * 1-5', () => {
    void runIfTradingDay('1330_uk');
  }, {
    timezone: 'Europe/London',
  });

  cron.schedule('0 14 * * 1-5', () => {
    void runIfTradingDay('1400_uk');
  }, {
    timezone: 'Europe/London',
  });

  logger.info('premarket catalyst cron registered', {
    event: 'premarket_catalyst.cron_registered',
    timezone: 'Europe/London',
    schedules: ['30 13 * * 1-5', '0 14 * * 1-5'],
  });
}

async function resolveSmokeTestAsOf() {
  const latestRunResult = await queryWithTimeout(
    `SELECT MAX(generated_at) AS latest
     FROM premarket_picks`,
    [],
    { timeoutMs: 10000, label: 'premarket_catalyst.smoke.latest_run', maxRetries: 0 },
  );

  const latestRun = latestRunResult.rows?.[0]?.latest;
  if (latestRun) {
    return new Date(latestRun).toISOString();
  }

  const intradayFallbackResult = await queryWithTimeout(
    `SELECT MAX(timestamp) AS latest
     FROM intraday_1m
     WHERE session = 'PREMARKET'`,
    [],
    { timeoutMs: 60000, label: 'premarket_catalyst.smoke.latest_premarket', maxRetries: 0 },
  );

  const latest = intradayFallbackResult.rows?.[0]?.latest;
  if (!latest) {
    return undefined;
  }

  return new Date(latest).toISOString();
}

module.exports = {
  registerPremarketCatalystCron,
  runIfTradingDay,
  isUsTradingDay,
};

if (require.main === module) {
  (async () => {
    const asOf = await resolveSmokeTestAsOf();
    const result = await runPremarketCatalystModel({ dryRun: true, ...(asOf ? { asOf } : {}) });
    console.log(JSON.stringify(result, null, 2));
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}