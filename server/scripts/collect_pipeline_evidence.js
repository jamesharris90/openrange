#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function pickLatestTimestamp(queryRunner, table) {
  const candidates = ['updated_at', 'timestamp', 'date', 'created_at', 'detected_at', 'published_at'];
  for (const col of candidates) {
    try {
      const res = await queryRunner.query(`SELECT MAX(${col}) AS ts FROM ${table}`);
      if (res.rows[0] && res.rows[0].ts) {
        return { column: col, value: res.rows[0].ts };
      }
    } catch {
      // ignore missing columns
    }
  }
  return { column: null, value: null };
}

async function main() {
  const tables = [
    'market_quotes',
    'intraday_1m',
    'daily_ohlc',
    'trade_setups',
    'strategy_signals',
    'trade_catalysts',
    'catalyst_signals',
    'news_catalysts',
    'catalyst_intelligence',
    'catalyst_reactions',
    'opportunities',
  ];

  const out = {};
  for (const table of tables) {
    const countRes = await pool.query(`SELECT COUNT(*)::bigint AS c FROM ${table}`);
    const latest = await pickLatestTimestamp(pool, table);
    out[table] = {
      row_count: Number(countRes.rows[0].c || 0),
      latest_timestamp_column: latest.column,
      latest_timestamp: latest.value,
    };
  }

  const coverageRes = await pool.query(
    "SELECT symbol, COUNT(*)::int AS c, MAX(timestamp) AS ts FROM intraday_1m WHERE symbol IN ('AAPL','SPY','QQQ','IWM','NVDA','MSFT') GROUP BY symbol ORDER BY symbol"
  );
  out.intraday_symbol_coverage = coverageRes.rows;

  console.log(JSON.stringify(out, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
