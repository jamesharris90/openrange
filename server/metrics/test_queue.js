require('dotenv').config();

const { queueSymbol } = require('./queue_symbol');
const { calculateMarketMetrics } = require('./calc_market_metrics');
const { pool } = require('../db/pg');

async function testQueueFlow() {
  await pool.query('DELETE FROM symbol_queue');

  const sample = await pool.query(
    `SELECT symbol
     FROM market_metrics
     ORDER BY last_updated DESC NULLS LAST
     LIMIT 1`
  );

  const symbol = sample.rows[0]?.symbol;
  if (!symbol) {
    throw new Error('No symbol available in market_metrics to test queue flow');
  }

  await queueSymbol(symbol, 'queue_test');

  const result = await calculateMarketMetrics({ mode: 'queue' });

  const confirm = await pool.query(
    `SELECT symbol, last_updated
     FROM market_metrics
     WHERE symbol = $1`,
    [symbol]
  );

  return {
    queued_symbol: symbol,
    metrics_run: result,
    queue_size_after: (await pool.query('SELECT COUNT(*)::int AS c FROM symbol_queue')).rows[0].c,
    metric_row: confirm.rows[0] || null,
  };
}

if (require.main === module) {
  testQueueFlow()
    .then((out) => {
      console.log(JSON.stringify(out, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('test_queue failed:', err.message);
      process.exit(1);
    });
}

module.exports = {
  testQueueFlow,
};
