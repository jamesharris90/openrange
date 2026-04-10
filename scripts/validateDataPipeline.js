#!/usr/bin/env node
/**
 * validateDataPipeline.js
 * Validates the market data pipeline is healthy and serving real data.
 * Usage: node scripts/validateDataPipeline.js [--base-url http://localhost:3001]
 */

const http = require('http');
const https = require('https');

const BASE_URL = (() => {
  const idx = process.argv.indexOf('--base-url');
  return idx !== -1 ? process.argv[idx + 1] : (process.env.API_BASE_URL || 'http://localhost:3001');
})();

function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: null, raw: body }); }
      });
    }).on('error', reject);
  });
}

function pass(msg) { console.log('  ✔', msg); }
function fail(msg) { console.error('  ✗', msg); }

async function run() {
  let exitCode = 0;
  console.log(`\nValidating data pipeline: ${BASE_URL}\n`);

  // 1 — Data health
  console.log('[ 1 ] /api/system/data-health');
  try {
    const { status, data } = await get(`${BASE_URL}/api/system/data-health`);
    if (status !== 200 || !data?.success) {
      fail(`HTTP ${status} — ${data?.error ?? 'unexpected response'}`);
      exitCode = 1;
    } else {
      const mq = data.market_quotes;
      const statusColor = mq.status === 'healthy' ? '✔' : '⚠';
      console.log(`  ${statusColor} market_quotes: ${mq.row_count} rows, status=${mq.status}, last_update=${mq.last_update}`);
      if (mq.row_count === 0) {
        fail('row_count is 0 — ingestion has not written any data');
        exitCode = 1;
      } else {
        pass(`Row count: ${mq.row_count}`);
      }
      if (mq.status === 'empty') {
        fail('Status is empty — database has no market quotes');
        exitCode = 1;
      } else if (mq.status === 'stale') {
        console.warn('  ⚠ Status is stale — data may be outdated');
      } else {
        pass(`Data health: ${mq.status}`);
      }
    }
  } catch (err) {
    fail(`Request failed: ${err.message}`);
    exitCode = 1;
  }

  // 2 — NVDA quote
  console.log('\n[ 2 ] /api/market/quotes?symbols=NVDA');
  try {
    const { status, data } = await get(`${BASE_URL}/api/market/quotes?symbols=NVDA`);
    if (status !== 200 || !data?.success) {
      fail(`HTTP ${status} — ${data?.error ?? 'unexpected response'}`);
      exitCode = 1;
    } else if (!data.data || data.data.length === 0) {
      fail('No quote data returned for NVDA');
      exitCode = 1;
    } else {
      const q = data.data[0];
      pass(`NVDA price: $${q.price}`);
      pass(`NVDA change_percent: ${q.change_percent}%`);
      pass(`NVDA volume: ${q.volume}`);
    }
  } catch (err) {
    fail(`Request failed: ${err.message}`);
    exitCode = 1;
  }

  console.log(exitCode === 0 ? '\n✔ Pipeline validation PASSED\n' : '\n✗ Pipeline validation FAILED\n');
  process.exit(exitCode);
}

run().catch((err) => {
  console.error('Validation script error:', err.message);
  process.exit(1);
});
