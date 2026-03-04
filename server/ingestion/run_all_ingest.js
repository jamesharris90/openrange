require('dotenv').config();

const { runIntradayIngestion } = require('./fmp_intraday_ingest');
const { runNewsIngestion } = require('./fmp_news_ingest');
const { runPricesIngestion } = require('./fmp_prices_ingest');
const { runEarningsIngestion } = require('./fmp_earnings_ingest');
const { runProfilesIngestion } = require('./fmp_profiles_ingest');
const logger = require('../utils/logger');

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
      results.push({ job: name, ok: true, ...result });
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
