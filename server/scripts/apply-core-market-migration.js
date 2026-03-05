const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15000,
  });

  await client.connect();

  const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/create_core_market_tables.sql'), 'utf8');
  await client.query(sql);

  const result = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('market_quotes','daily_ohlc','intraday_ohlc','market_metrics') ORDER BY table_name"
  );

  console.log(JSON.stringify({
    ok: true,
    tables: result.rows.map((row) => row.table_name),
  }, null, 2));

  await client.end();
}

main().catch((error) => {
  console.error('MIGRATION_FAIL', error.message);
  process.exit(1);
});
