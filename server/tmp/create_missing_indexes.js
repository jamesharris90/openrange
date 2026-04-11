const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 0,
    query_timeout: 0,
    connectionTimeoutMillis: 10000,
  });

  await client.connect();

  const statements = [
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticker_universe_symbol ON ticker_universe(symbol)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_metrics_symbol ON market_metrics(symbol)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_ohlc_date_symbol ON daily_ohlc(date, symbol)',
  ];

  for (const sql of statements) {
    const startedAt = Date.now();
    await client.query(sql);
    console.log(JSON.stringify({ sql, ms: Date.now() - startedAt }));
  }

  await client.end();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});