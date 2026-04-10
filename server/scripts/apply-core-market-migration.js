const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/create_core_market_tables.sql'), 'utf8');
  await pool.query(sql);

  const result = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('market_quotes','daily_ohlc','intraday_ohlc','market_metrics') ORDER BY table_name"
  );

  console.log(JSON.stringify({
    ok: true,
    tables: result.rows.map((row) => row.table_name),
  }, null, 2));

  await pool.end();
}

main().catch((error) => {
  console.error('MIGRATION_FAIL', error.message);
  process.exit(1);
});
