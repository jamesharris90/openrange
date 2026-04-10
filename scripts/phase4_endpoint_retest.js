const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(process.cwd(), 'server/.env') });

async function main() {
  const base = process.env.RETEST_BASE_URL || 'http://localhost:3002';
  const headers = {};
  if (process.env.PROXY_API_KEY) {
    headers['x-api-key'] = process.env.PROXY_API_KEY;
  }

  const endpoints = [
    '/api/screener',
    '/api/intelligence/decision/SPY',
    '/api/intelligence/top-opportunities?mode=live',
    '/api/market/overview',
    '/api/earnings',
  ];

  const results = [];
  for (const endpoint of endpoints) {
    const started = Date.now();
    try {
      const response = await fetch(base + endpoint, { headers });
      const text = await response.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      results.push({
        endpoint,
        status: response.status,
        ok: response.status === 200,
        duration_ms: Date.now() - started,
        success_field: body && Object.prototype.hasOwnProperty.call(body, 'success') ? body.success : null,
        preview: text.slice(0, 220),
      });
    } catch (error) {
      results.push({
        endpoint,
        status: 0,
        ok: false,
        duration_ms: Date.now() - started,
        error: error.message,
      });
    }
  }

  const endpointOut = {
    generated_at: new Date().toISOString(),
    base_url: base,
    results,
    passed: results.every((r) => r.ok),
  };

  fs.mkdirSync('logs', { recursive: true });
  fs.writeFileSync('logs/endpoint_validation.json', JSON.stringify(endpointOut, null, 2));

  let contract = { passed: false, summary: {} };
  try {
    contract = JSON.parse(fs.readFileSync('backend_contract_fix.json', 'utf8'));
  } catch {
    // keep defaults
  }

  const report = {
    generated_at: new Date().toISOString(),
    phase0_precheck_path: 'logs/precheck_validation.json',
    backend_contract_path: 'backend_contract_fix.json',
    endpoint_validation_path: 'logs/endpoint_validation.json',
    summary: {
      live_mode: Boolean(contract.summary?.live_mode),
      recent_mode: Boolean(contract.summary?.recent_mode),
      research_mode: Boolean(contract.summary?.research_mode),
      contract_integrity: Boolean(contract.summary?.contract_integrity),
      data_availability: Boolean(contract.summary?.data_availability),
      endpoint_retest_pass: Boolean(endpointOut.passed),
    },
    status: contract.passed && endpointOut.passed
      ? 'BUILD VALIDATED - SAFE TO DEPLOY'
      : 'BUILD FAILED - FIX REQUIRED',
  };

  fs.writeFileSync('logs/build_validation_report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
