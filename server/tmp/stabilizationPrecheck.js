const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL && !process.env.DB_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const { Pool } = require('pg');

const REQUIRED_TABLES = {
  ticker_universe: ['symbol'],
  data_coverage_status: ['symbol', 'status', 'last_checked'],
  market_quotes: ['symbol', 'price', 'updated_at'],
  market_metrics: ['symbol', 'price'],
  daily_ohlc: ['symbol', 'date', 'close'],
  news_articles: ['symbol', 'published_at', 'headline'],
  earnings_events: ['symbol', 'report_date'],
  earnings_history: ['symbol', 'report_date'],
};

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DB_URL,
    ssl: false,
  });

  try {
    const output = {};

    for (const [table, columns] of Object.entries(REQUIRED_TABLES)) {
      const existsResult = await pool.query('SELECT to_regclass($1::text) AS name', [`public.${table}`]);
      const exists = Boolean(existsResult.rows?.[0]?.name);
      const columnResult = exists
        ? await pool.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = $1`,
            [table]
          )
        : { rows: [] };
      const countResult = exists
        ? await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`)
        : { rows: [{ count: 0 }] };
      const columnSet = new Set((columnResult.rows || []).map((row) => row.column_name));

      output[table] = {
        exists,
        row_count: Number(countResult.rows?.[0]?.count || 0),
        columns_ok: columns.every((column) => columnSet.has(column)),
        missing_columns: columns.filter((column) => !columnSet.has(column)),
      };
    }

    console.log(JSON.stringify({ ok: true, checked_at: new Date().toISOString(), tables: output }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, checked_at: new Date().toISOString() }, null, 2));
  process.exit(1);
});