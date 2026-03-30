const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const { pool } = require('../db/pg');
const { runValidation } = require('./buildValidator');

function printResult(entry) {
  const prefix = entry.ok ? 'PASS' : 'FAIL';
  console.log(`[${prefix}] ${entry.type} ${entry.name}`, entry.detail);
}

async function main() {
  // Skip endpoint connectivity checks when running in pre-commit hook context
  // (no server is running during git commit). Set INCLUDE_ENDPOINT_CHECKS=true to enable.
  const includeEndpointChecks = process.env.INCLUDE_ENDPOINT_CHECKS === 'true';
  const validation = await runValidation({ includeEndpointChecks });

  console.log('[BUILD_VALIDATION] summary', {
    status: validation.status,
    checks: validation.checks,
    failures: validation.failures,
    timestamp: validation.timestamp,
  });

  validation.results.forEach(printResult);

  if (validation.status !== 'PASS') {
    console.error('BUILD VALIDATION FAILED');
    process.exitCode = 1;
    return;
  }

  console.log('BUILD VALIDATION PASSED');
}

main()
  .catch((error) => {
    console.error('[BUILD_VALIDATION] fatal', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });