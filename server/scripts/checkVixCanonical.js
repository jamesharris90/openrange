require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const pool = require('../db/pool');

async function main() {
  const q1 = await pool.query("SELECT symbol, price, updated_at FROM market_quotes WHERE symbol IN ('VIX','^VIX') ORDER BY updated_at DESC LIMIT 5;");
  const q2 = await pool.query("SELECT symbol, timestamp, close FROM intraday_1m WHERE symbol IN ('VIX','^VIX') ORDER BY timestamp DESC LIMIT 10;");
  const q3 = await pool.query("SELECT DISTINCT symbol FROM market_quotes WHERE symbol ILIKE '%VIX%' OR symbol ILIKE '%^VIX%' ORDER BY symbol;");
  const q4 = await pool.query("SELECT DISTINCT symbol FROM intraday_1m WHERE symbol ILIKE '%VIX%' OR symbol ILIKE '%^VIX%' ORDER BY symbol;");

  console.log('--- market_quotes VIX/^VIX ---');
  console.log(JSON.stringify(q1.rows, null, 2));
  console.log('--- intraday_1m VIX/^VIX ---');
  console.log(JSON.stringify(q2.rows, null, 2));
  console.log('--- market_quotes distinct like VIX ---');
  console.log(JSON.stringify(q3.rows, null, 2));
  console.log('--- intraday_1m distinct like VIX ---');
  console.log(JSON.stringify(q4.rows, null, 2));

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
