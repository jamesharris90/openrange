const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { pool } = require('../db/pg');

const required = [
  'daily_ohlc',
  'intraday_1m',
  'market_metrics',
  'trade_setups',
  'trade_catalysts',
  'opportunity_stream',
  'market_narratives',
  'ticker_universe'
];

const migrationFiles = [
  path.resolve(__dirname, '..', 'migrations', 'create_opportunity_stream.sql'),
  path.resolve(__dirname, '..', 'migrations', 'create_market_narratives.sql')
];

async function listPublicTables() {
  const result = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  return result.rows.map((r) => r.table_name);
}

async function run() {
  const before = await listPublicTables();
  const beforeSet = new Set(before);
  const missingBefore = required.filter((t) => !beforeSet.has(t));

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(file, 'utf8');
    await pool.query(sql);
  }

  const after = await listPublicTables();
  const afterSet = new Set(after);
  const missingAfter = required.filter((t) => !afterSet.has(t));

  const counts = {};
  for (const tableName of ['opportunity_stream', 'market_narratives']) {
    if (afterSet.has(tableName)) {
      const c = await pool.query(`SELECT COUNT(*)::int AS count FROM ${tableName}`);
      counts[tableName] = c.rows[0]?.count ?? 0;
    } else {
      counts[tableName] = null;
    }
  }

  console.log(JSON.stringify({
    missing_before: missingBefore,
    missing_after: missingAfter,
    required_verified: missingAfter.length === 0,
    row_counts: counts,
    table_name_query_result: after
  }, null, 2));
}

run()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error('DB_STABILIZE_ERROR', error.message);
    try { await pool.end(); } catch {}
    process.exit(1);
  });
