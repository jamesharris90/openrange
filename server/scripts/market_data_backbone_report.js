const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { pool } = require('../db/pg');

const TABLES = [
  'ticker_universe',
  'intraday_1m',
  'daily_ohlc',
  'news_articles',
  'earnings_events',
  'earnings_transcripts',
  'trade_catalysts',
  'opportunity_stream',
  'strategy_signals',
];

async function tableExists(tableName) {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return Boolean(rows[0]?.exists);
}

async function tableCount(tableName) {
  const exists = await tableExists(tableName);
  if (!exists) {
    return { exists: false, count: 0 };
  }

  const { rows } = await pool.query(`SELECT COUNT(*)::bigint AS count FROM ${tableName}`);
  return {
    exists: true,
    count: Number(rows[0]?.count || 0),
  };
}

async function run() {
  const counts = {};
  for (const tableName of TABLES) {
    counts[tableName] = await tableCount(tableName);
  }

  const emptyOrMissing = TABLES.filter((tableName) => {
    const record = counts[tableName];
    return !record.exists || Number(record.count) === 0;
  });

  const report = {
    generated_at: new Date().toISOString(),
    fully_operational: emptyOrMissing.length === 0,
    empty_or_missing_tables: emptyOrMissing,
    counts,
  };

  console.log(JSON.stringify(report, null, 2));
}

run()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error('MARKET_DATA_BACKBONE_REPORT_ERROR', error.message);
    try {
      await pool.end();
    } catch (_error) {
      // no-op
    }
    process.exit(1);
  });
