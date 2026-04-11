require('dotenv').config();

const { queryWithTimeout } = require('../db/pg');
const { runIntradayIngestion } = require('./fmp_intraday_ingest');
const { runNewsIngestion } = require('./fmp_news_ingest');
const { runPricesIngestion } = require('./fmp_prices_ingest');
const { runEarningsIngestion } = require('./fmp_earnings_ingest');
const { runProfilesIngestion } = require('./fmp_profiles_ingest');
const logger = require('../utils/logger');

const JOB_TABLE_CHECKS = {
  intraday: [
    { table: 'intraday_1m', timestampColumn: 'timestamp', maxLagMinutes: 60 },
  ],
  news: [
    { table: 'news_articles', timestampColumn: 'published_at', maxLagMinutes: 60 * 24 * 3 },
  ],
  prices: [
    { table: 'daily_ohlc', timestampColumn: 'date', maxLagMinutes: 60 * 24 * 7 },
  ],
  earnings: [
    { table: 'earnings_events', timestampColumn: 'updated_at', maxLagMinutes: 60 * 24 * 7 },
  ],
  profiles: [
    { table: 'company_profiles', timestampColumn: 'updated_at', maxLagMinutes: 60 * 24 * 30 },
  ],
};

function isSafeIdentifier(value) {
  return /^[a-z_][a-z0-9_]*$/i.test(String(value || ''));
}

async function verifyTableHealth({ table, timestampColumn, maxLagMinutes }) {
  if (!isSafeIdentifier(table) || !isSafeIdentifier(timestampColumn)) {
    return {
      table,
      ok: false,
      error: 'invalid_identifier',
    };
  }

  const result = await queryWithTimeout(
    `SELECT COUNT(*)::int AS row_count, MAX(${timestampColumn})::text AS latest_timestamp FROM ${table}`,
    [],
    {
      timeoutMs: 10000,
      label: `ingest.verify.${table}`,
      maxRetries: 0,
    }
  ).catch((error) => ({ rows: [], error }));

  if (result.error) {
    logger.error('ingestion verification failed', {
      table,
      error: result.error.message,
    });
    return {
      table,
      ok: false,
      error: result.error.message,
    };
  }

  const row = result.rows?.[0] || {};
  const rowCount = Number(row.row_count || 0);
  const latestTimestamp = row.latest_timestamp || null;
  const parsed = latestTimestamp ? Date.parse(latestTimestamp) : NaN;
  const lagMinutes = Number.isFinite(parsed)
    ? Math.max(0, Math.round((Date.now() - parsed) / 60000))
    : null;
  const stale = rowCount === 0 || (lagMinutes != null && lagMinutes > maxLagMinutes);

  if (stale) {
    logger.error('ingestion verification stale', {
      table,
      row_count: rowCount,
      latest_timestamp: latestTimestamp,
      lag_minutes: lagMinutes,
      max_lag_minutes: maxLagMinutes,
    });
  }

  return {
    table,
    ok: !stale,
    row_count: rowCount,
    latest_timestamp: latestTimestamp,
    lag_minutes: lagMinutes,
    max_lag_minutes: maxLagMinutes,
  };
}

async function verifyJobHealth(jobName) {
  const checks = JOB_TABLE_CHECKS[jobName] || [];
  if (checks.length === 0) {
    return [];
  }

  const results = [];
  for (const check of checks) {
    results.push(await verifyTableHealth(check));
  }
  return results;
}

async function runAllIngestions() {
  const jobs = [
    ['intraday', runIntradayIngestion],
    ['news', runNewsIngestion],
    ['prices', runPricesIngestion],
    ['earnings', runEarningsIngestion],
    ['profiles', runProfilesIngestion],
  ];

  const results = [];

  for (const [name, job] of jobs) {
    try {
      const result = await job();
      const verification = await verifyJobHealth(name);
      results.push({ job: name, ok: true, verification, ...result });
    } catch (err) {
      logger.error('run_all_ingest job failed', { job: name, error: err.message });
      results.push({ job: name, ok: false, error: err.message });
    }
  }

  logger.info('run_all_ingest complete', { results });
  return results;
}

if (require.main === module) {
  runAllIngestions()
    .then((results) => {
      console.log(JSON.stringify(results, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('run_all_ingest fatal error:', err);
      process.exit(1);
    });
}

module.exports = {
  runAllIngestions,
};
