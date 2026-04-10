const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3001';

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function run() {
  const report = {
    generated_at: new Date().toISOString(),
    base_url: BASE_URL,
    run_all: {
      status: null,
      ok: false,
      body_preview: null,
      error: null,
    },
    checks: [],
    pass: false,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(`${BASE_URL}/api/cron/run-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const body = await response.text();
    report.run_all.status = response.status;
    report.run_all.ok = response.ok;
    report.run_all.body_preview = body.slice(0, 400);
  } catch (error) {
    report.run_all.error = String(error?.message || error);
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));

  const endpoints = [
    '/api/stocks-in-play',
    '/api/intelligence/top-opportunities?limit=5',
  ];

  for (const endpoint of endpoints) {
    const check = {
      endpoint,
      status: 0,
      count: 0,
      response_source: null,
      sample_sources: [],
      has_required_fields: false,
      fallback_used: false,
      pass: false,
      error: null,
    };

    try {
      const response = await fetch(`${BASE_URL}${endpoint}`);
      const payload = await response.json().catch(() => null);
      const rows = asArray(payload);
      const sample = rows.slice(0, 5);

      check.status = response.status;
      check.count = rows.length;
      check.response_source = payload?.source || null;
      check.fallback_used = Boolean(payload?.fallback_used) || String(payload?.source || '').toLowerCase() === 'fallback';
      check.sample_sources = sample.map((row) => String(row?.source || ''));
      check.has_required_fields = sample.length > 0
        ? sample.every((row) => Boolean(row?.symbol) && Boolean(row?.why || row?.why_moving) && Boolean(row?.how || row?.how_to_trade))
        : false;

      if (endpoint === '/api/stocks-in-play') {
        const rowSourcesReal = sample.every((row) => String(row?.source || '').toLowerCase() === 'real');
        check.pass = check.status === 200
          && check.count > 0
          && String(check.response_source || '').toLowerCase() === 'real'
          && rowSourcesReal
          && check.has_required_fields
          && !check.fallback_used;
      } else {
        check.pass = check.status === 200 && check.count > 0;
      }
    } catch (error) {
      check.error = String(error?.message || error);
    }

    report.checks.push(check);
  }

  report.pass = report.checks.every((check) => check.pass);

  const outPath = path.resolve(__dirname, '../logs/stocks_in_play_post_fix_validation.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`validation report -> ${outPath}`);
  console.log(report.pass ? 'PASS' : 'FAIL');
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
