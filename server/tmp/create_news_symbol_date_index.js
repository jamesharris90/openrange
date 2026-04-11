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
  const startedAt = Date.now();
  await client.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_news_symbol_date ON news_articles(symbol, published_date DESC)');
  console.log(JSON.stringify({ index: 'idx_news_symbol_date', ms: Date.now() - startedAt }));
  await client.end();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});