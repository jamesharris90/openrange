#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../server/.env'), override: true });
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), override: false });

const { queryWithTimeout } = require('../server/db/pg');
const pool = require('../server/db/pool');
const { loadAndValidateTruth } = require('../server/engines/_truthGuard');

async function runAudit() {
  loadAndValidateTruth({
    requiredTables: {
      opportunity_stream: ['id', 'symbol', 'event_type', 'source', 'trade_class', 'why', 'how', 'updated_at'],
      trade_setups: ['symbol', 'setup', 'score', 'updated_at'],
    },
    requiredMappings: ['batch-quote', 'stock-news', 'earnings-calendar'],
  });

  const [opportunityCountQ, setupCountQ, extendedRatioQ, whyHowQ, sourceIntegrityQ] = await Promise.all([
    queryWithTimeout(
      `SELECT COUNT(*)::int AS c
       FROM opportunity_stream
       WHERE source = 'real'
         AND event_type = 'signal_quality_engine'
         AND updated_at > NOW() - INTERVAL '30 minutes'`,
      [],
      { timeoutMs: 7000, label: 'audit.signal.opportunity_count', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT COUNT(*)::int AS c
       FROM trade_setups
       WHERE updated_at > NOW() - INTERVAL '30 minutes'`,
      [],
      { timeoutMs: 7000, label: 'audit.signal.trade_setup_count', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT
         COALESCE(SUM(CASE WHEN trade_class = 'EXTENDED' THEN 1 ELSE 0 END), 0)::numeric AS extended_count,
         COUNT(*)::numeric AS total_count
       FROM opportunity_stream
       WHERE source = 'real'
         AND event_type = 'signal_quality_engine'
         AND updated_at > NOW() - INTERVAL '30 minutes'`,
      [],
      { timeoutMs: 7000, label: 'audit.signal.extended_ratio', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT COUNT(*)::int AS missing
       FROM opportunity_stream
       WHERE source = 'real'
         AND event_type = 'signal_quality_engine'
         AND updated_at > NOW() - INTERVAL '30 minutes'
         AND (COALESCE(why, '') = '' OR COALESCE(how, '') = '')`,
      [],
      { timeoutMs: 7000, label: 'audit.signal.why_how', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT COUNT(*)::int AS mismatched
       FROM trade_setups ts
       LEFT JOIN opportunity_stream os
         ON os.symbol = ts.symbol
        AND os.event_type = 'signal_quality_engine'
        AND os.updated_at > NOW() - INTERVAL '30 minutes'
       WHERE ts.updated_at > NOW() - INTERVAL '30 minutes'
         AND COALESCE(os.source, '') <> 'real'`,
      [],
      { timeoutMs: 7000, label: 'audit.signal.source_integrity', maxRetries: 0 }
    ),
  ]);

  const opportunityCount = Number(opportunityCountQ.rows[0]?.c || 0);
  const tradeSetupsCount = Number(setupCountQ.rows[0]?.c || 0);
  const extendedCount = Number(extendedRatioQ.rows[0]?.extended_count || 0);
  const totalCount = Number(extendedRatioQ.rows[0]?.total_count || 0);
  const extendedRatio = totalCount > 0 ? extendedCount / totalCount : 0;
  const missingWhyHow = Number(whyHowQ.rows[0]?.missing || 0);
  const sourceMismatched = Number(sourceIntegrityQ.rows[0]?.mismatched || 0);

  const checks = {
    opportunity_stream_count_gt_5: opportunityCount > 5,
    trade_setups_count_gt_5: tradeSetupsCount > 5,
    no_extended_domination: extendedRatio <= 0.5,
    all_have_why_how: missingWhyHow === 0,
    all_trades_source_real: sourceMismatched === 0,
  };

  const pass = Object.values(checks).every(Boolean);

  const report = {
    generated_at: new Date().toISOString(),
    phase: 'signal_quality_audit',
    metrics: {
      opportunity_stream_count: opportunityCount,
      trade_setups_count: tradeSetupsCount,
      extended_count: extendedCount,
      total_count: totalCount,
      extended_ratio: extendedRatio,
      missing_why_how: missingWhyHow,
      source_mismatched: sourceMismatched,
    },
    checks,
    pass,
  };

  fs.mkdirSync(path.resolve(__dirname, '../logs'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../logs/signal_quality_audit.json'), JSON.stringify(report, null, 2));

  if (!pass) {
    console.log('SIGNAL ENGINE FAILED — DO NOT PROCEED');
    process.exit(1);
  }

  console.log('SIGNAL ENGINE LIVE — HIGH QUALITY TRADEABLE OUTPUT');
}

runAudit()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    fs.mkdirSync(path.resolve(__dirname, '../logs'), { recursive: true });
    fs.writeFileSync(
      path.resolve(__dirname, '../logs/signal_quality_audit.json'),
      JSON.stringify({ generated_at: new Date().toISOString(), phase: 'signal_quality_audit', pass: false, fatal_error: err.message }, null, 2)
    );
    console.log('SIGNAL ENGINE FAILED — DO NOT PROCEED');
    try {
      await pool.end();
    } catch (_err) {
      // no-op
    }
    process.exit(1);
  });
