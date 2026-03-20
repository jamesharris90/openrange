const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { resolveDatabaseUrl } = require('../db/connectionConfig');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const { dbUrl } = resolveDatabaseUrl();
  const client = new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes('supabase') ? { rejectUnauthorized: false } : false,
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
