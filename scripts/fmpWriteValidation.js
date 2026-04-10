#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../server/.env'), override: true });
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), override: false });

const pool = require('../server/db/pool');

const dryRunPath = path.resolve(__dirname, '../logs/fmp_dry_run_pipeline.json');
const contractPath = path.resolve(__dirname, '../logs/fmp_contract_validation.json');

function toNumeric(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  if (!fs.existsSync(dryRunPath)) throw new Error('Missing dry run log');
  if (!fs.existsSync(contractPath)) throw new Error('Missing contract validation log');

  const dryRun = JSON.parse(fs.readFileSync(dryRunPath, 'utf8'));
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

  if (!dryRun.pass) throw new Error('Dry-run did not pass');
  if (!contract.pass) throw new Error('Contract validation did not pass');

  const source = (dryRun.samples?.top_movers || []).slice(0, 50);
  if (!source.length) throw new Error('No rows available for capped write validation');

  const started = Date.now();
  let writesTradable = 0;
  let writesMetrics = 0;

  for (const row of source) {
    const symbol = String(row.symbol || '').trim().toUpperCase();
    if (!symbol) continue;

    await pool.query(
      `INSERT INTO tradable_universe (symbol, price, change_percent, volume, source, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (symbol)
       DO UPDATE SET
         price = EXCLUDED.price,
         change_percent = EXCLUDED.change_percent,
         volume = EXCLUDED.volume,
         source = EXCLUDED.source,
         updated_at = NOW()`,
      [symbol, toNumeric(row.price), toNumeric(row.change_percent), toNumeric(row.volume), 'fmp_write_validation']
    );
    writesTradable += 1;

    await pool.query(
      `INSERT INTO market_metrics (symbol, price, change_percent, volume, previous_close, source, updated_at)
       VALUES ($1, $2, $3, $4, NULL, $5, NOW())
       ON CONFLICT (symbol)
       DO UPDATE SET
         price = EXCLUDED.price,
         change_percent = EXCLUDED.change_percent,
         volume = EXCLUDED.volume,
         source = EXCLUDED.source,
         updated_at = NOW()`,
      [symbol, toNumeric(row.price), toNumeric(row.change_percent), toNumeric(row.volume), 'fmp_write_validation']
    );
    writesMetrics += 1;
  }

  const verifyTradable = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM tradable_universe
     WHERE source = 'fmp_write_validation'`
  );

  const verifyMetrics = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM market_metrics
     WHERE source = 'fmp_write_validation'`
  );

  const report = {
    generated_at: new Date().toISOString(),
    phase: 'fmp_write_validation',
    max_rows_allowed: 50,
    rows_attempted: source.length,
    tables_written: ['tradable_universe', 'market_metrics'],
    write_counts: {
      tradable_universe_upserts: writesTradable,
      market_metrics_upserts: writesMetrics
    },
    verification: {
      tradable_universe_rows_with_validation_source: verifyTradable.rows[0]?.c || 0,
      market_metrics_rows_with_validation_source: verifyMetrics.rows[0]?.c || 0
    },
    duration_ms: Date.now() - started,
    pass: writesTradable > 0 && writesMetrics > 0
  };

  fs.mkdirSync(path.resolve(__dirname, '../logs'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../logs/fmp_write_validation.json'), JSON.stringify(report, null, 2));

  console.log('write validation written: logs/fmp_write_validation.json');
  if (!report.pass) process.exit(1);
}

main()
  .catch((err) => {
    fs.mkdirSync(path.resolve(__dirname, '../logs'), { recursive: true });
    fs.writeFileSync(
      path.resolve(__dirname, '../logs/fmp_write_validation.json'),
      JSON.stringify({ generated_at: new Date().toISOString(), phase: 'fmp_write_validation', pass: false, fatal_error: err.message }, null, 2)
    );
    console.error(err.message);
    process.exit(1);
  })
  .finally(async () => {
    try { await pool.end(); } catch (_e) {}
  });
