#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const dryRunPath = path.resolve(__dirname, '../logs/fmp_dry_run_pipeline.json');

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateContractRow(row) {
  const errors = [];
  if (typeof row.symbol !== 'string' || row.symbol.trim().length === 0) errors.push('symbol');
  if (!isFiniteNumber(row.price)) errors.push('price');
  if (!isFiniteNumber(row.change_percent)) errors.push('change_percent');
  if (!isFiniteNumber(row.volume) || row.volume < 0) errors.push('volume');
  if (!isFiniteNumber(row.news_count) || row.news_count < 0) errors.push('news_count');
  if (!isFiniteNumber(row.earnings_count) || row.earnings_count < 0) errors.push('earnings_count');
  return errors;
}

function main() {
  if (!fs.existsSync(dryRunPath)) {
    throw new Error('Missing logs/fmp_dry_run_pipeline.json. Run dry-run first.');
  }

  const dryRun = JSON.parse(fs.readFileSync(dryRunPath, 'utf8'));
  const rows = dryRun?.samples?.contracts || [];

  const violations = [];
  rows.forEach((row, index) => {
    const failedFields = validateContractRow(row);
    if (failedFields.length > 0) {
      violations.push({ index, symbol: row?.symbol || null, failed_fields: failedFields, row });
    }
  });

  const report = {
    generated_at: new Date().toISOString(),
    phase: 'fmp_contract_validation',
    source_file: 'logs/fmp_dry_run_pipeline.json',
    inspected_rows: rows.length,
    violations,
    null_or_nan_count: violations.length,
    pass: Boolean(dryRun?.pass) && rows.length > 0 && violations.length === 0
  };

  fs.mkdirSync(path.resolve(__dirname, '../logs'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../logs/fmp_contract_validation.json'), JSON.stringify(report, null, 2));

  console.log('contract validation written: logs/fmp_contract_validation.json');
  if (!report.pass) process.exit(1);
}

try {
  main();
} catch (err) {
  fs.mkdirSync(path.resolve(__dirname, '../logs'), { recursive: true });
  fs.writeFileSync(
    path.resolve(__dirname, '../logs/fmp_contract_validation.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), phase: 'fmp_contract_validation', pass: false, fatal_error: err.message }, null, 2)
  );
  console.error(err.message);
  process.exit(1);
}
