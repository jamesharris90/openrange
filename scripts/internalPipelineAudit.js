#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../server/.env'), override: true });
const pool = require('../server/db/pool');

async function main() {
  const ts = new Date().toISOString();

  const universe = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM tradable_universe
     WHERE source = 'real'
       AND COALESCE(updated_at, NOW() - INTERVAL '365 days') > NOW() - INTERVAL '60 minutes'`
  );

  const metrics = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM market_metrics
     WHERE source = 'real'
       AND COALESCE(updated_at, NOW() - INTERVAL '365 days') > NOW() - INTERVAL '60 minutes'`
  );

  const opportunities = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM opportunity_stream
     WHERE source = 'real'
       AND event_type = 'internal_scanner'
       AND COALESCE(updated_at, created_at, NOW() - INTERVAL '365 days') > NOW() - INTERVAL '60 minutes'`
  );

  const missingWhyHow = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM opportunity_stream
     WHERE source = 'real'
       AND event_type = 'internal_scanner'
       AND (COALESCE(why, '') = '' OR COALESCE(how, '') = '')`
  );

  const nonReal = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM opportunity_stream
     WHERE event_type = 'internal_scanner'
       AND COALESCE(source, '') <> 'real'`
  );

  const report = {
    timestamp: ts,
    checks: {
      tradable_universe_gt_100: Number(universe.rows[0]?.c || 0) > 100,
      market_metrics_gt_50: Number(metrics.rows[0]?.c || 0) > 50,
      opportunity_stream_gt_5: Number(opportunities.rows[0]?.c || 0) > 5,
      all_trades_have_why_how: Number(missingWhyHow.rows[0]?.c || 0) === 0,
      all_source_real: Number(nonReal.rows[0]?.c || 0) === 0,
    },
    counts: {
      tradable_universe: Number(universe.rows[0]?.c || 0),
      market_metrics: Number(metrics.rows[0]?.c || 0),
      opportunity_stream: Number(opportunities.rows[0]?.c || 0),
      missing_why_how: Number(missingWhyHow.rows[0]?.c || 0),
      non_real_source_rows: Number(nonReal.rows[0]?.c || 0),
    },
  };

  report.pass = Object.values(report.checks).every(Boolean);

  const logsDir = path.resolve(__dirname, '../logs');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(logsDir, 'internal_pipeline_audit.json'), JSON.stringify(report, null, 2));

  await pool.end();

  if (report.pass) {
    console.log('INTERNAL SCANNER ACTIVE — SYSTEM PRODUCING REAL TRADEABLE DATA');
  } else {
    console.log('SCANNER FAILED — INVESTIGATE DATA PIPELINE');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`SCANNER FAILED — INVESTIGATE DATA PIPELINE (${err.message})`);
  process.exit(1);
});
