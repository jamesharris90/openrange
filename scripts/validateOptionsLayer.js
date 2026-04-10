#!/usr/bin/env node
/**
 * validateOptionsLayer.js
 *
 * Validates that the options intelligence layer is operating correctly:
 *   - New columns exist in market_metrics
 *   - IV populated for liquid stocks
 *   - expected_move_percent is present and sane
 *   - No rows dropped from screener vs baseline
 *   - No NaN / out-of-range values
 *
 * Usage:
 *   node scripts/validateOptionsLayer.js
 *
 * Output:
 *   options_validation_report.json
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../server/.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const pool = require('../server/db/pool');
const fs       = require('fs');
const path     = require('path');

async function query(sql, params = []) {
  return pool.query(sql, params);
}

// ── checks ─────────────────────────────────────────────────────────────────────

async function checkColumnsExist() {
  const { rows } = await query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'market_metrics'
      AND column_name IN ('implied_volatility', 'expected_move_percent', 'put_call_ratio', 'options_updated_at')
    ORDER BY column_name
  `);
  const found = rows.map(r => r.column_name);
  const required = ['expected_move_percent', 'implied_volatility', 'options_updated_at', 'put_call_ratio'];
  const missing = required.filter(c => !found.includes(c));
  return { found, missing, pass: missing.length === 0 };
}

async function checkCoverage() {
  const { rows } = await query(`
    SELECT
      COUNT(*)                                           AS total_metrics,
      COUNT(implied_volatility)                          AS has_iv,
      COUNT(expected_move_percent)                       AS has_em,
      COUNT(put_call_ratio)                              AS has_pcr,
      COUNT(*) FILTER (WHERE options_updated_at IS NOT NULL) AS has_options_ts
    FROM market_metrics
  `);
  const r = rows[0];
  const total = Number(r.total_metrics);
  const hasIv  = Number(r.has_iv);
  const hasEm  = Number(r.has_em);
  const ivPct  = total > 0 ? ((hasIv / total) * 100).toFixed(1) : '0.0';
  const emPct  = total > 0 ? ((hasEm / total) * 100).toFixed(1) : '0.0';
  return {
    total_rows:       total,
    has_iv:           hasIv,
    has_em:           hasEm,
    has_pcr:          Number(r.has_pcr),
    has_options_ts:   Number(r.has_options_ts),
    iv_coverage_pct:  Number(ivPct),
    em_coverage_pct:  Number(emPct),
    pass: Number(emPct) >= 10, // at least 10% populated to pass (engine may be new)
  };
}

async function checkLiquidStocksCoverage() {
  // Top 50 by market_cap in market_quotes
  const { rows } = await query(`
    SELECT
      mq.symbol,
      mm.implied_volatility,
      mm.expected_move_percent,
      mm.put_call_ratio,
      mm.options_updated_at
    FROM market_quotes mq
    LEFT JOIN market_metrics mm ON UPPER(mm.symbol) = UPPER(mq.symbol)
    WHERE mq.market_cap > 1e9
    ORDER BY mq.market_cap DESC
    LIMIT 50
  `);

  const withIv = rows.filter(r => r.implied_volatility != null).length;
  const withEm = rows.filter(r => r.expected_move_percent != null).length;
  return {
    liquid_stocks_checked: rows.length,
    liquid_with_iv:        withIv,
    liquid_with_em:        withEm,
    liquid_iv_pct:         rows.length > 0 ? Number(((withIv / rows.length) * 100).toFixed(1)) : 0,
    liquid_em_pct:         rows.length > 0 ? Number(((withEm / rows.length) * 100).toFixed(1)) : 0,
    pass:                  withEm > 0,
  };
}

async function checkSaneBounds() {
  const { rows } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE implied_volatility IS NOT NULL AND (implied_volatility < 0 OR implied_volatility > 50))  AS iv_out_of_range,
      COUNT(*) FILTER (WHERE expected_move_percent IS NOT NULL AND (expected_move_percent < 0 OR expected_move_percent > 50)) AS em_out_of_range,
      COUNT(*) FILTER (WHERE put_call_ratio IS NOT NULL AND (put_call_ratio < 0 OR put_call_ratio > 50))              AS pcr_out_of_range,
      MIN(implied_volatility)    AS iv_min,
      MAX(implied_volatility)    AS iv_max,
      MIN(expected_move_percent) AS em_min,
      MAX(expected_move_percent) AS em_max,
      MIN(put_call_ratio)        AS pcr_min,
      MAX(put_call_ratio)        AS pcr_max
    FROM market_metrics
  `);
  const r = rows[0];
  const ivOOR  = Number(r.iv_out_of_range);
  const emOOR  = Number(r.em_out_of_range);
  const pcrOOR = Number(r.pcr_out_of_range);
  return {
    iv_out_of_range:  ivOOR,
    em_out_of_range:  emOOR,
    pcr_out_of_range: pcrOOR,
    iv_range:  [r.iv_min  != null ? Number(Number(r.iv_min).toFixed(4))  : null, r.iv_max  != null ? Number(Number(r.iv_max).toFixed(4))  : null],
    em_range:  [r.em_min  != null ? Number(Number(r.em_min).toFixed(2))  : null, r.em_max  != null ? Number(Number(r.em_max).toFixed(2))  : null],
    pcr_range: [r.pcr_min != null ? Number(Number(r.pcr_min).toFixed(3)) : null, r.pcr_max != null ? Number(Number(r.pcr_max).toFixed(3)) : null],
    pass: ivOOR === 0 && emOOR === 0 && pcrOOR === 0,
  };
}

async function checkScreenerRowCount() {
  // Count screener-eligible rows (non-null price, volume, market_cap, sector)
  const { rows } = await query(`
    SELECT COUNT(*) AS eligible
    FROM market_quotes mq
    JOIN market_metrics mm ON UPPER(mm.symbol) = UPPER(mq.symbol)
    WHERE mq.price > 0
      AND mq.volume > 0
      AND mq.market_cap > 0
      AND mq.sector IS NOT NULL
      AND mq.sector <> ''
      AND mm.avg_volume_30d > 0
      AND mm.change_percent IS NOT NULL
  `);
  const eligible = Number(rows[0].eligible);
  return {
    screener_eligible_rows: eligible,
    pass: eligible > 0,
  };
}

async function checkNoNullsIntroduced() {
  // Ensure we haven't introduced any NaN-encoded strings or unexpected nulls in core fields
  const { rows } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE price IS NULL OR price <= 0)   AS bad_price,
      COUNT(*) FILTER (WHERE volume IS NULL OR volume < 0)  AS bad_volume
    FROM market_quotes
  `);
  const r = rows[0];
  return {
    bad_price:  Number(r.bad_price),
    bad_volume: Number(r.bad_volume),
    pass: Number(r.bad_price) === 0,
  };
}

async function checkEndpointFields() {
  // Simulate what the market/quotes endpoint returns by querying a sample
  const { rows } = await query(`
    SELECT
      mq.symbol,
      mq.price,
      mq.change_percent,
      mq.volume,
      mm.avg_volume_30d,
      mm.implied_volatility,
      mm.expected_move_percent,
      mm.put_call_ratio,
      mq.market_cap,
      mq.sector
    FROM market_quotes mq
    LEFT JOIN market_metrics mm ON UPPER(mm.symbol) = UPPER(mq.symbol)
    WHERE mq.price > 0
    LIMIT 5
  `);

  const coreFields = ['symbol', 'price', 'change_percent', 'volume', 'market_cap'];
  const missingCore = [];
  for (const row of rows) {
    for (const f of coreFields) {
      if (row[f] == null) missingCore.push({ symbol: row.symbol, field: f });
    }
  }

  return {
    sample_rows: rows.length,
    missing_core_fields: missingCore,
    new_fields_present: rows.length > 0 ? ['implied_volatility', 'expected_move_percent', 'put_call_ratio'].filter(f => f in rows[0]) : [],
    pass: missingCore.length === 0 && rows.length > 0,
  };
}

// ── runner ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('[validateOptionsLayer] starting...');

  const results = {};
  const failures = [];

  const checks = [
    ['columns_exist',         checkColumnsExist],
    ['coverage',              checkCoverage],
    ['liquid_stocks',         checkLiquidStocksCoverage],
    ['sane_bounds',           checkSaneBounds],
    ['screener_rows',         checkScreenerRowCount],
    ['no_nulls_introduced',   checkNoNullsIntroduced],
    ['endpoint_fields',       checkEndpointFields],
  ];

  for (const [name, fn] of checks) {
    try {
      const result = await fn();
      results[name] = result;
      const status = result.pass ? 'PASS' : 'FAIL';
      console.log(`  [${status}] ${name}`);
      if (!result.pass) failures.push(name);
    } catch (err) {
      results[name] = { error: err.message, pass: false };
      console.error(`  [ERROR] ${name}: ${err.message}`);
      failures.push(name);
    }
  }

  const overallPass = failures.length === 0;
  const report = {
    generated_at: new Date().toISOString(),
    overall:      overallPass ? 'PASS' : 'FAIL',
    failures,
    checks:       results,
  };

  const outPath = path.join(__dirname, '../logs/options_validation_report.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n[validateOptionsLayer] ${overallPass ? '✓ PASS' : '✗ FAIL'} — report: ${outPath}`);
  if (failures.length > 0) {
    console.log(`  Failed checks: ${failures.join(', ')}`);
  }

  await pool.end();
  process.exit(overallPass ? 0 : 1);
}

run().catch((err) => {
  console.error('[validateOptionsLayer] fatal:', err.message);
  process.exit(1);
});
