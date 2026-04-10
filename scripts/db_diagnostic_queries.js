'use strict';
require('dotenv').config({ path: '/Users/jamesharris/Server/server/.env' });
const pool = require('../server/db/pool');

async function run() {
  const queries = [
    {
      id: 1,
      label: "signals created in last 24h",
      sql: `SELECT COUNT(*) AS n FROM signals WHERE created_at > NOW() - INTERVAL '24 hours'`,
    },
    {
      id: 2,
      label: "signal_log rows in last 24h",
      sql: `SELECT COUNT(*) AS n FROM signal_log WHERE timestamp > NOW() - INTERVAL '24 hours'`,
    },
    {
      id: 3,
      label: "signal_outcomes: total + evaluated",
      sql: `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE outcome IS NOT NULL) AS evaluated FROM signal_outcomes`,
    },
    {
      id: 4,
      label: "signal_performance_daily row count",
      sql: `SELECT COUNT(*) AS n FROM signal_performance_daily`,
    },
    {
      id: 5,
      label: "market_quotes updated in last 2h",
      sql: `SELECT COUNT(*) AS n FROM market_quotes WHERE updated_at > NOW() - INTERVAL '2 hours'`,
    },
    {
      id: 6,
      label: "intraday_1m rows in last 3h",
      sql: `SELECT COUNT(*) AS n FROM intraday_1m WHERE "timestamp" > NOW() - INTERVAL '3 hours'`,
    },
    {
      id: 7,
      label: "trade_setups updated in last 24h",
      sql: `SELECT COUNT(*) AS n FROM trade_setups WHERE updated_at > NOW() - INTERVAL '24 hours'`,
    },
    {
      id: 8,
      label: "strategy_signals created in last 24h",
      sql: `SELECT COUNT(*) AS n FROM strategy_signals WHERE created_at > NOW() - INTERVAL '24 hours'`,
    },
    {
      id: 9,
      label: "signals: MAX(created_at)",
      sql: `SELECT MAX(created_at) AS last_ts FROM signals`,
    },
    {
      id: 10,
      label: "signal_log: MAX(timestamp)",
      sql: `SELECT MAX("timestamp") AS last_ts FROM signal_log`,
    },
    {
      id: 11,
      label: "signal_outcomes: MAX(created_at)",
      sql: `SELECT MAX(created_at) AS last_ts FROM signal_outcomes`,
    },
    {
      id: 12,
      label: "dummy (global.systemBlocked check)",
      sql: `SELECT 1 AS dummy`,
      postLog: () => {
        console.log(`  -> global.systemBlocked = ${typeof global.systemBlocked !== 'undefined' ? global.systemBlocked : '(not set in this process)'}`);
      },
    },
    {
      id: 13,
      label: "market_quotes: total count + MAX(updated_at)",
      sql: `SELECT COUNT(*) AS n, MAX(updated_at) AS last FROM market_quotes`,
    },
    {
      id: 14,
      label: "signal_log columns",
      sql: `SELECT column_name FROM information_schema.columns WHERE table_name = 'signal_log' AND table_schema = 'public' ORDER BY ordinal_position`,
    },
    {
      id: 15,
      label: "signal_outcomes columns",
      sql: `SELECT column_name FROM information_schema.columns WHERE table_name = 'signal_outcomes' AND table_schema = 'public' ORDER BY ordinal_position`,
    },
  ];

  console.log('='.repeat(60));
  console.log('DB DIAGNOSTIC — ' + new Date().toISOString());
  console.log('='.repeat(60));
  console.log('DATABASE_URL host:', process.env.DATABASE_URL ? process.env.DATABASE_URL.split('@')[1] : '(not set)');
  console.log('');

  for (const q of queries) {
    console.log(`--- Q${q.id}: ${q.label}`);
    try {
      const result = await pool.query(q.sql);
      if (q.id === 14 || q.id === 15) {
        // Column lists — print as array
        const cols = result.rows.map(r => r.column_name);
        console.log(`  columns (${cols.length}): [${cols.join(', ')}]`);
      } else {
        console.log('  rows:', JSON.stringify(result.rows));
      }
      if (q.postLog) q.postLog();
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }
    console.log('');
  }

  client.release();
  await pool.end();
  console.log('='.repeat(60));
  console.log('Done.');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
