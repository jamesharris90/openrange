#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const requiredLogs = [
  'logs/db_schema_truth.json',
  'logs/fmp_stable_validation.json',
  'logs/fmp_field_mapping_validation.json',
  'logs/fmp_dry_run_pipeline.json',
  'logs/fmp_contract_validation.json',
  'logs/fmp_write_validation.json'
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', filePath), 'utf8'));
}

function main() {
  const missing = requiredLogs.filter((p) => !fs.existsSync(path.resolve(__dirname, '..', p)));
  if (missing.length) {
    console.log('BUILD FAILED - FIX REQUIRED');
    console.log(`Missing artifacts: ${missing.join(', ')}`);
    process.exit(1);
  }

  const statuses = requiredLogs.map((p) => {
    const payload = readJson(p);
    return { file: p, pass: payload.pass === true };
  });

  const allPass = statuses.every((s) => s.pass);
  const report = {
    generated_at: new Date().toISOString(),
    phase: 'fmp_foundation_final_gate',
    statuses,
    pass: allPass
  };

  fs.mkdirSync(path.resolve(__dirname, '../logs'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../logs/build_validation_report.json'), JSON.stringify(report, null, 2));

  if (allPass) {
    console.log('BUILD VALIDATED - SAFE TO DEPLOY');
    process.exit(0);
  }

  console.log('BUILD FAILED - FIX REQUIRED');
  process.exit(1);
}

main();
