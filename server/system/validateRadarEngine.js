'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const fs = require('fs');
const http = require('http');
const { queryWithTimeout } = require('../db/pg');

function logStatus(key, ok) {
  console.log(`${key}: ${ok ? 'OK' : 'FAIL'}`);
  return ok;
}

async function checkApiRoute(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ ok: json?.ok === true, body: json });
        } catch (_) {
          resolve({ ok: false, body: null });
        }
      });
    });
    req.on('error', () => resolve({ ok: false, body: null }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, body: null }); });
  });
}

async function main() {
  const results = {};

  // 1 — Radar views exist
  let viewsOk = false;
  try {
    const { rows } = await queryWithTimeout(
      `SELECT table_name
         FROM information_schema.views
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [['radar_stocks_in_play', 'radar_momentum', 'radar_news', 'radar_a_setups', 'radar_market_summary']],
      { timeoutMs: 7000, label: 'validate_radar.views', maxRetries: 0 }
    );
    viewsOk = rows.length === 5;
  } catch (_) {
    viewsOk = false;
  }
  results.RADAR_VIEWS = logStatus('RADAR_VIEWS', viewsOk);

  // 2 — Engine file exists
  const engineFile = path.resolve(__dirname, '../engines/radarEngine.js');
  const engineExists = fs.existsSync(engineFile);
  const engineContent = engineExists ? fs.readFileSync(engineFile, 'utf8') : '';
  const fetchFnPresent = engineContent.includes('fetchRadarData');
  results.RADAR_ENGINE = logStatus('RADAR_ENGINE', engineExists && fetchFnPresent);

  // 3 — API route responds
  const port = process.env.PORT || 3000;
  const apiResult = await checkApiRoute(`http://localhost:${port}/api/radar/today`);
  results.API_ROUTE = logStatus('API_ROUTE', apiResult.ok);

  // 4 — Views return rows (at least one view has data, or views are queryable)
  let queriesOk = false;
  try {
    const checks = await Promise.all([
      queryWithTimeout('SELECT COUNT(*) AS n FROM radar_stocks_in_play', [], { timeoutMs: 7000, label: 'validate_radar.sip', maxRetries: 0 }),
      queryWithTimeout('SELECT COUNT(*) AS n FROM radar_momentum', [], { timeoutMs: 7000, label: 'validate_radar.mom', maxRetries: 0 }),
      queryWithTimeout('SELECT COUNT(*) AS n FROM radar_news', [], { timeoutMs: 7000, label: 'validate_radar.news', maxRetries: 0 }),
      queryWithTimeout('SELECT COUNT(*) AS n FROM radar_a_setups', [], { timeoutMs: 7000, label: 'validate_radar.setups', maxRetries: 0 }),
    ]);
    // Pass if all views are queryable (even if 0 rows)
    queriesOk = checks.every((r) => r?.rows?.[0] !== undefined);
  } catch (_) {
    queriesOk = false;
  }
  results.RADAR_QUERIES = logStatus('RADAR_QUERIES', queriesOk);

  // 5 — Diagnostics include RADAR_GENERATED_AT
  const platformHealthFile = path.resolve(__dirname, './platformHealthExtended.js');
  const platformContent = fs.existsSync(platformHealthFile)
    ? fs.readFileSync(platformHealthFile, 'utf8')
    : '';
  const diagnosticsOk = platformContent.includes('RADAR_GENERATED_AT');
  results.DIAGNOSTICS = logStatus('DIAGNOSTICS', diagnosticsOk);

  const allPassed = Object.values(results).every(Boolean);
  process.exitCode = allPassed ? 0 : 1;
}

main().catch((err) => {
  console.error('[VALIDATE_RADAR] Fatal error:', err.message);
  process.exitCode = 1;
});
