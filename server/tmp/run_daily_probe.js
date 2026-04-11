require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { runPricesIngestion } = require('../ingestion/fmp_prices_ingest');

runPricesIngestion(['AAPL'], { fromDate: '2026-04-09' })
  .then((result) => {
    console.log('[PROBE RESULT]', JSON.stringify(result));
    process.exit(0);
  })
  .catch((error) => {
    console.error('[PROBE ERROR]', error.stack || error.message);
    process.exit(1);
  });
